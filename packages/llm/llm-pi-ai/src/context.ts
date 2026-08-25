/**
 * Harness request-history conversion into pi-ai's Context vocabulary.
 *
 * @module dsh-llm-pi-ai/context
 */
/*
 * 文件职责：实现Pi AI LLM的 context.ts 模块。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：解析配置和认证，转换请求，消费流并映射模型事件。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */

import { CallId, contentHasImage, LlmError, offloadRequestImagesWithPolicy, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type {
  AttachmentId,
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { Context as PiContext, ImageContent, Message as PiMessage, TextContent, Tool as PiTool } from '@earendil-works/pi-ai'
import { toPiAssistant } from './replay.ts'
import { DEFAULT_REQUEST_IMAGE_MAX_BYTES, DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET } from './config.ts'

/** Join the text blocks of a harness message. */
/* 中文说明：函数 flattenText 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function flattenText(message: Message): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}


/** Flatten text recursively inside one tool result. */
/* 中文说明：函数 toolResultText 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function toolResultText(blocks: readonly ContentBlock[]): string {
  return blocks.map(block => block.type === 'text'
    ? block.text
    : block.type === 'tool-result' ? toolResultText(block.content) : '').join('')
}

/** Reject image roles that pi-ai cannot replay before request-size offloading can replace them. */
/* 中文说明：函数 assertSupportedImageRoles 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function assertSupportedImageRoles(messages: readonly Message[]): void {
  /** 中文说明：适配器局部值 message，由紧邻初始化决定。 */
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `pi-ai cannot represent an image in an in-history ${message.role} message`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

/** 中文说明：函数 userContent 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function userContent(
  blocks: readonly ContentBlock[],
  requestImages: ReadonlyMap<AttachmentId, RequestImageAttachment>,
): Promise<string | (TextContent | ImageContent)[]> {
  /** 中文说明：适配器局部值 content，由紧邻初始化决定。 */
  const content: (TextContent | ImageContent)[] = []
  /** 中文说明：适配器局部值 block，由紧邻初始化决定。 */
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        /** 中文说明：适配器局部值 version，由紧邻初始化决定。 */
        const version = requestImages.get(block.attachment.attachmentId) as RequestImageAttachment
        content.push({ type: 'text', text: requestImageHandleText(version) })
        content.push({
          type: 'image',
          data: Buffer.from(version.data).toString('base64'),
          mimeType: version.mediaType,
        })
        break
      }
      case 'tool-result':
        {
          /** 中文说明：适配器局部值 nested，由紧邻初始化决定。 */
          const nested = await userContent(block.content, requestImages)
          if (typeof nested === 'string') {
            if (nested.length > 0) content.push({ type: 'text', text: nested })
          } else {
            content.push(...nested)
          }
        }
        break
      default:
        // Other merge-extensible blocks are not user-input vocabulary for pi-ai.
        break
    }
  }
  if (content.every(block => block.type === 'text')) return content.map(block => block.text).join('')
  return content
}

/** 中文说明：函数 collectImageRefs 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function collectImageRefs(
  blocks: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  /** 中文说明：适配器局部值 block，由紧邻初始化决定。 */
  for (const block of blocks) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

/** 中文说明：函数 prepareRequestImages 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function prepareRequestImages(
  messages: readonly Message[],
  attachments: AttachmentStore,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  /** 中文说明：适配器局部值 refs，由紧邻初始化决定。 */
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  /** 中文说明：适配器局部值 message，由紧邻初始化决定。 */
  for (const message of messages) collectImageRefs(message.content, refs)
  /** 中文说明：适配器局部值 orderedRefs，由紧邻初始化决定。 */
  const orderedRefs = [...refs.values()]
  /** 中文说明：适配器局部值 prepared，由紧邻初始化决定。 */
  const prepared = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, policy, signal),
  ))
  /** 中文说明：适配器局部值 versions，由紧邻初始化决定。 */
  const versions = new Map<AttachmentId, RequestImageAttachment>()
  /** 中文说明：适配器局部值 [index，由紧邻初始化决定。 */
  for (const [index, ref] of orderedRefs.entries()) {
    versions.set(ref.attachmentId, prepared[index] as RequestImageAttachment)
  }
  return versions
}

/** 中文说明：函数 toolsOf 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function toolsOf(options: GenerateOptions): PiTool[] | undefined {
  return options.tools?.map(tool => ({
    name: tool.name,
    description: tool.description,
    // ToolSchema.parameters is a JSON Schema object; pi-ai's TSchema
    // (TypeBox) is structurally JSON Schema, so it assigns directly.
    parameters: tool.parameters,
  }))
}

/** Assemble the request-level pi-ai context envelope shared by both conversion paths. */
/* 中文说明：函数 piContext 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function piContext(options: GenerateOptions, messages: PiMessage[]): PiContext {
  /** 中文说明：适配器局部值 tools，由紧邻初始化决定。 */
  const tools = toolsOf(options)
  return {
    ...options.system !== undefined ? { systemPrompt: options.system } : {},
    messages,
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
  }
}

/** 中文说明：函数 textOnlyContext 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function textOnlyContext(options: GenerateOptions, onReplayDegrade?: (reason: string) => void): PiContext {
  /** 中文说明：适配器局部值 toolNames，由紧邻初始化决定。 */
  const toolNames = new Map<CallId, string>()
  /** 中文说明：适配器局部值 messages，由紧邻初始化决定。 */
  const messages: PiMessage[] = []
  /** 中文说明：适配器局部值 message，由紧邻初始化决定。 */
  for (const message of options.messages) {
    if (contentHasImage(message.content)) {
      throw new LlmError('pi-ai image conversion requires the durable attachment service', 'UNSUPPORTED_CONTENT')
    }
    if (message.role === 'system') {
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      /** 中文说明：适配器局部值 assistant，由紧邻初始化决定。 */
      const assistant = toPiAssistant(message, onReplayDegrade)
      /** 中文说明：适配器局部值 block，由紧邻初始化决定。 */
      for (const block of assistant.content) if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      messages.push(assistant)
      continue
    }
    /** 中文说明：适配器局部值 text，由紧邻初始化决定。 */
    const text = flattenText(message)
    /** 中文说明：适配器局部值 results，由紧邻初始化决定。 */
    const results = message.content.filter(block => block.type === 'tool-result')
    if (text.length > 0 || results.length === 0) messages.push({ role: 'user', content: text, timestamp: 0 })
    /** 中文说明：适配器局部值 result，由紧邻初始化决定。 */
    for (const result of results) {
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: [{
          type: 'text',
          text: toolResultText(result.content) || '(no output)',
        }],
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }
  return piContext(options, messages)
}

/**
 * Convert text-only harness history to a synchronous pi-ai Context. Tool
 * result names are recovered from preceding assistant tool calls.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - absent; selects the synchronous conversion.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @returns the pi-ai context; `tools` is omitted when the request declares none.
 */
/*
 * 中文说明：函数 toPiContext 的参数见签名，返回结果供模型流程使用；示例见本文件。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param attachments 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onReplayDegrade 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function toPiContext(
  options: GenerateOptions,
  attachments?: undefined,
  onReplayDegrade?: (reason: string) => void,
): PiContext
/**
 * Convert harness history to a pi-ai Context while resolving durable images.
 * Tool result names are recovered from preceding assistant tool calls. When
 * the accumulated base64 image payload exceeds `maxRequestImageBytes`, the
 * oldest images are replaced by text placeholders until the request fits, so
 * an image-heavy session keeps clearing gateway request-size caps.
 * @param options - the harness request; `options.system` maps to pi-ai's single `systemPrompt` slot.
 * @param attachments - durable byte resolver for image references.
 * @param onReplayDegrade - forwarded to {@link toPiAssistant} for each assistant message.
 * @param maxRequestImageBytes - request-level bound on base64-encoded image payload; omission leaves every image in place.
 * @param requestImagePolicy - route pixel and raw encoded-byte budgets.
 * @returns the asynchronously resolved pi-ai context.
 */
/*
 * 中文说明：函数 toPiContext 的参数见签名，返回结果供模型流程使用；示例见本文件。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param attachments 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param onReplayDegrade 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param maxRequestImageBytes 中文说明：允许的请求图片总字节上限；省略时不按该值裁剪。
 * @param requestImagePolicy 中文说明：当前模型路由采用的图片像素与编码字节策略。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function toPiContext(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
): Promise<PiContext>
/** 中文说明：函数 toPiContext 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
export function toPiContext(
  options: GenerateOptions,
  attachments?: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy?: ImageRequestPolicy,
): PiContext | Promise<PiContext> {
  return attachments === undefined
    ? textOnlyContext(options, onReplayDegrade)
    : toPiContextWithImages(options, attachments, onReplayDegrade, maxRequestImageBytes, requestImagePolicy)
}

/** 中文说明：函数 toPiContextWithImages 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function toPiContextWithImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  onReplayDegrade?: (reason: string) => void,
  maxRequestImageBytes?: number,
  requestImagePolicy: ImageRequestPolicy = {
    maxPixels: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    maxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  },
): Promise<PiContext> {
  assertSupportedImageRoles(options.messages)
  /** 中文说明：适配器局部值 requestMessages，由紧邻初始化决定。 */
  const requestMessages = offloadRequestImagesWithPolicy(options.messages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => Math.min(ref.bytes, requestImagePolicy.maxBytes),
  })
  /** 中文说明：适配器局部值 requestImages，由紧邻初始化决定。 */
  const requestImages = await prepareRequestImages(requestMessages, attachments, requestImagePolicy, options.signal)
  /** 中文说明：适配器局部值 exactMessages，由紧邻初始化决定。 */
  const exactMessages = offloadRequestImagesWithPolicy(requestMessages, {
    representation: 'base64',
    ...maxRequestImageBytes === undefined ? {} : { maxBytes: maxRequestImageBytes },
    byteQuantum: 1,
    byteLength: ref => (requestImages.get(ref.attachmentId) as RequestImageAttachment).bytes,
  })
  /** 中文说明：适配器局部值 toolNames，由紧邻初始化决定。 */
  const toolNames = new Map<CallId, string>()
  /** 中文说明：适配器局部值 messages，由紧邻初始化决定。 */
  const messages: PiMessage[] = []

  /** 中文说明：适配器局部值 message，由紧邻初始化决定。 */
  for (const message of exactMessages) {
    if (message.role === 'system') {
      // pi-ai has a single systemPrompt slot; in-history system messages are
      // folded into user messages to preserve order (rare in practice — the
      // harness sends the system prompt via options.system).
      messages.push({ role: 'user', content: flattenText(message), timestamp: 0 })
      continue
    }
    if (message.role === 'assistant') {
      /** 中文说明：适配器局部值 assistant，由紧邻初始化决定。 */
      const assistant = toPiAssistant(message, onReplayDegrade)
      /** 中文说明：适配器局部值 block，由紧邻初始化决定。 */
      for (const block of assistant.content) {
        if (block.type === 'toolCall') toolNames.set(CallId(block.id), block.name)
      }
      messages.push(assistant)
      continue
    }
    // user role: text + tool results (each result becomes its own message).
    /** 中文说明：适配器局部值 regular，由紧邻初始化决定。 */
    const regular = message.content.filter(block => block.type !== 'tool-result')
    /** 中文说明：适配器局部值 content，由紧邻初始化决定。 */
    const content = await userContent(regular, requestImages)
    /** 中文说明：适配器局部值 results，由紧邻初始化决定。 */
    const results = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    if (content.length > 0 || results.length === 0) {
      messages.push({ role: 'user', content, timestamp: 0 })
    }
    /** 中文说明：适配器局部值 result，由紧邻初始化决定。 */
    for (const result of results) {
      /** 中文说明：适配器局部值 resultContent，由紧邻初始化决定。 */
      const resultContent = await userContent(result.content, requestImages)
      messages.push({
        role: 'toolResult',
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? 'unknown',
        content: typeof resultContent === 'string'
          ? [{ type: 'text', text: resultContent || '(no output)' }]
          : resultContent,
        isError: result.isError ?? false,
        timestamp: 0,
      })
    }
  }

  return piContext(options, messages)
}
