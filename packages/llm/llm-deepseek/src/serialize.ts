/*
 * ================================ 文件注释 ================================
 * 【文件职责】把 harness 消息序列化为 DeepSeek chat-completions 请求：纯文本
 * 请求保留字符串形式的 user 内容；图片路径把持久附件解析为有序的 file-id 或
 * 内联 part；工具结果图片跟随其纯文本 tool 消息之后、以独立 user 消息呈现。
 * 【技术维度】两条序列化路径共用 requestWithMessages 组装公共字段：纯文本
 * （serializeMessages/serializeRequest）与图片能力（serializeMessagesWithImages/
 * serializeRequestWithImages，需解析附件并做超限卸载）；推理强度在
 * resolveThinking 中与 thinking 开关配对校验。
 * 【产品维度】DeepSeek 要求工具结果以 role:'tool' 消息呈现、thinking 模式有
 * 特殊字段；序列化层把 harness 的通用消息模型无损翻译成 provider 方言，保证
 * 多模态与工具调用在线上正确表达。
 * 【逻辑维度】类型（默认值/图片表示/位置）→ 推理配对解析 → 文本/图片辅助 →
 * 纯文本序列化 → 图片序列化 → 公共请求组装。
 * 【关键边界】图片内容只允许在 user 角色消息里；空工具输出线上仍要占位文本
 * （'(no output)'）；省略可选字段而非发 null，让 provider 默认值生效。
 * 【新手阅读建议】先读 serializeMessages（纯文本路径），再读
 * serializeMessagesWithImages 理解"工具结果图片合并进后续 user 消息"的规则。
 * ==========================================================================
 */

/**
 * Serialize harness messages into DeepSeek chat completions. Text-only
 * requests retain string user content; the image path resolves durable
 * attachments into ordered file-id or inline parts. Tool-result images follow their
 * string-only tool messages in a separate user message.
 * @module dsh-llm-deepseek/serialize
 */

import { contentHasImage, LlmError, offloadRequestImagesWithPolicy, requestImageHandleText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import type {
  WireImageContentPart,
  WireMessage,
  WireRequest,
  WireTextContentPart,
  WireTool,
  WireUserContentPart,
} from './types.ts'

/** Adapter-level request defaults (from plugin config). */
/*
 * （中文）适配器级请求默认值（来自插件配置）：thinking 模式与默认推理强度。
 */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'low' | 'high' | 'max' | undefined
}

// 中文：解析后的 thinking/effort 组合（off 不出现在线上推理强度里）。
interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Provider representation for every retained image in one request. */
/*
 * （中文）一次请求中每张保留图片的 provider 表示方式：file（解析成可复用的
 * DeepSeek 文件 id）或 base64（内联）。
 */
export type ImageRequestRepresentation =
  | {
    kind: 'file'
    /** Resolve a retained request version to a reusable DeepSeek file id. */
    // 中文：把保留的请求版本解析成可复用的 DeepSeek 文件 id。
    resolveFileId: (
      version: RequestImageAttachment,
      block: Extract<ContentBlock, { type: 'image' }>,
      location: ImageWireLocation,
    ) => Promise<string>
  }
  | { kind: 'base64' }

/** Dependencies required only when the request contains image input. */
/*
 * （中文）仅在请求含图片输入时才需要的依赖。
 */
export interface ImageSerializationOptions {
  /** One representation used for every retained image in this request. */
  // 中文：本次请求中所有保留图片共用的表示方式。
  representation: ImageRequestRepresentation
  /** Request versions prepared for the conservatively retained normalized attachments, keyed by attachment id. */
  // 中文：为"保守保留的规范化附件"准备好的请求版本，按附件 id 索引。
  requestImages: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>
  /** Positive bound on accumulated represented image bytes. */
  // 中文：累计表示后图片字节的正上限。
  maxRequestImageBytes: number
  /** Maximum represented images in one request. */
  // 中文：一次请求可表示的图片数量上限。
  maxImagesPerRequest?: number
  /** Represented-byte removal step applied after the request exceeds its byte bound. */
  // 中文：请求超过字节上限后的表示字节移除步长。
  byteQuantum?: number
  /** Image-count removal step applied after the request exceeds its count bound. */
  // 中文：请求超过数量上限后的数量移除步长。
  countQuantum?: number
}

/** Durable message and image ordinal used in provider diagnostics. */
/*
 * （中文）provider 诊断用的持久消息序号与图片序号（用于报错定位）。
 */
export interface ImageWireLocation {
  message: number
  image: number
}

// 中文：工具结果图片合入后续 user 消息时的引导文本。
const TOOL_RESULT_IMAGE_TEXT = 'Attached image(s) from tool result:'

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
// 中文：在解析 DeepSeek 线上推理强度字段前，先校验适配器自有的强度值（只
// 允许 off/low/high/max，其余抛 UNSUPPORTED_REASONING_EFFORT）。
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'low' | 'high' | 'max' {
  if (effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'low' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair without exposing `off` as a wire effort. */
// 中文：解析一对合法的 thinking/effort：off 不当作线上推理强度出现（映射为
// thinking 禁用）；会话标题辅助调用强制禁用思考；部署禁用思考时其他强度一律
// 拒绝。
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'low' || effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
// 中文：把一条消息的文本块拼接成字符串（用于 user/工具结果内容）。
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
// 中文：在任何"文本展平"路径静默抹掉图片之前，拒绝核心图片内容（含图片就抛
// UNSUPPORTED_CONTENT）。
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The DeepSeek chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Reject roles whose DeepSeek history format cannot carry image input. */
// 中文：拒绝 DeepSeek 历史格式无法承载图片输入的角色：图片只允许出现在 user
// 角色消息里。
function assertSupportedImageRoles(messages: readonly Message[]): void {
  for (const message of messages) {
    if (message.role !== 'user' && contentHasImage(message.content)) {
      throw new LlmError(
        `The DeepSeek chat-completions adapter cannot represent image content in a ${message.role} message.`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
}

/** Describe the exact request preview and its model-callable coordinate system. */
// 中文：描述精确请求预览及其"模型可调用的坐标系"（请求图片句柄文本，供模型
// 引用图片；前面已有内容时补换行）。
function imageHandle(
  version: RequestImageAttachment,
  precededByContent: boolean,
): WireTextContentPart {
  return {
    type: 'text',
    text: `${precededByContent ? '\n' : ''}${requestImageHandleText(version)}`,
  }
}

/** Resolve one durable image into its descriptor and transient DeepSeek image part. */
// 中文：把一张持久图片解析成"描述文本 + 临时 DeepSeek 图片 part"；file 表示
// 走文件 id 解析，base64 表示走内联 data URL。
async function imageParts(
  block: Extract<ContentBlock, { type: 'image' }>,
  images: ImageSerializationOptions,
  location: ImageWireLocation,
  precededByContent: boolean,
): Promise<[WireTextContentPart, WireImageContentPart]> {
  const version = images.requestImages.get(block.attachment.attachmentId)
  if (version === undefined) {
    throw new LlmError(
      `DeepSeek request image ${block.attachment.attachmentId} was not prepared.`,
      'INVALID_REQUEST',
    )
  }
  const image: WireImageContentPart = images.representation.kind === 'file'
    ? { type: 'file', file_id: await images.representation.resolveFileId(version, block, location) }
    : {
      type: 'image_url',
      image_url: { url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` },
    }
  return [imageHandle(version, precededByContent), image]
}

/** Convert user or nested tool-result blocks into ordered wire parts. */
// 中文：把 user 或嵌套 tool-result 的内容块转换为有序线上 part（文本/图片；
// 其他可扩展块不在 DeepSeek user 输入词汇里，直接跳过）。
async function contentParts(
  blocks: readonly ContentBlock[],
  images: ImageSerializationOptions,
  message: number,
  nextImage: { value: number },
): Promise<WireUserContentPart[]> {
  const parts: WireUserContentPart[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) parts.push({ type: 'text', text: block.text })
        break
      case 'image':
        nextImage.value += 1
        parts.push(...await imageParts(block, images, { message, image: nextImage.value }, parts.length > 0))
        break
      case 'tool-result':
        parts.push(...await contentParts(block.content, images, message, nextImage))
        break
      default:
        // Other merge-extensible blocks are not DeepSeek user-input vocabulary.
        // 中文：其他可合并扩展块不属于 DeepSeek user 输入词汇。
        break
    }
  }
  return parts
}

/** Keep text-only user messages on the compact string wire form. */
// 中文：纯文本 user 消息保持紧凑的字符串线上形态；一旦出现非文本 part 就
// 返回完整 part 数组。
function userContent(parts: readonly WireUserContentPart[]): string | WireUserContentPart[] {
  const text: string[] = []
  for (const part of parts) {
    if (part.type !== 'text') return [...parts]
    text.push(part.text)
  }
  return text.join('')
}

/** Serialize one assistant message (text + reasoning + tool calls). */
// 中文：序列化一条助手消息（文本 + 推理 + 工具调用）。
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    // 中文：无文本轮次发送 ""——绝不 null。纯工具调用轮次：官方示例原样回放
    // message.content（即 ""），某些网关直接拒绝 null。仅推理轮次（模型可完全
    // 在推理通道作答，如 v4-flash 的问候语）：线上 API 会以 400 拒绝
    // null-content 且无 tool_calls 的助手消息（"content or tool_calls must
    // be set"）；由于该消息持久存在于会话日志，这里的 null 会毁掉该会话之后
    // 的每一轮。
    content: text,
    // CoT passback on every reasoning-carrying turn. The official rule
    // (guides/thinking_mode.mdx) requires it on tool-call turns and ignores it
    // elsewhere; a gateway re-encoding the conversation for another vendor
    // recovers that turn's upstream thinking signature by hashing this exact
    // text, which a tool-call-free turn carries nowhere else.
    // 中文：每个携带推理的轮次都回传思维链（CoT）。官方规则要求工具调用轮次
    // 必须带它、其他场合忽略；为其他厂商转码的网关通过哈希这段精确文本来恢复
    // 该轮的上游思考签名——无工具调用的轮次在其他任何地方都不携带它。
    ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/*
 * （中文）序列化对话。tool-result 块变成独立的 {role: 'tool'} 消息；harness
 * 把每个工具结果放在独立的 user 角色消息里，因此混合的 user 消息先贡献其
 * 文本，其工具结果再作为独立线上消息跟在后面。
 * @param messages harness 对话，按顺序。
 * @returns 线上消息；顺序保持，每个工具结果展开为自己的条目。
 */
/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but DeepSeek wants them as role:'tool' messages.
    // 中文：harness 词汇里工具结果放在 user 消息里，但 DeepSeek 要求它们
    // 是 role:'tool' 的消息。
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        // 中文：空工具输出在线上仍需要一点内容（否则某些网关报错）。
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/*
 * （中文）在解析持久附件后序列化具备图片能力的历史。连续的工具结果保持
 * 字符串 tool 消息，并共享一条紧随其后、包含它们图片的 user 消息。
 * @param messages 请求大小卸载后的临时请求历史。
 * @param images 准备好的请求版本、一种 provider 表示方式及其预算。
 * @returns 有序的 DeepSeek 线上消息。
 */
/**
 * Serialize image-capable history after resolving durable attachments.
 * Consecutive tool results keep string `tool` messages and share one following
 * user message containing their images.
 * @param messages - transient request history after request-size offloading.
 * @param images - prepared request versions, one provider representation, and its budget.
 * @returns ordered DeepSeek wire messages.
 */
export async function serializeMessagesWithImages(
  messages: readonly Message[],
  images: ImageSerializationOptions,
): Promise<WireMessage[]> {
  assertSupportedImageRoles(messages)
  const wire: WireMessage[] = []
  // 中文：待合并的"工具结果图片"part；遇下一条非工具结果消息前冲刷为一条
  // 带引导文本的 user 消息。
  let pendingToolImages: WireImageContentPart[] = []
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return
    wire.push({
      role: 'user',
      content: [{ type: 'text', text: TOOL_RESULT_IMAGE_TEXT }, ...pendingToolImages],
    })
    pendingToolImages = []
  }

  for (const [messageIndex, message] of messages.entries()) {
    const nextImage = { value: 0 }
    if (message.role === 'system') {
      flushToolImages()
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      flushToolImages()
      wire.push(serializeAssistant(message))
      continue
    }

    const regular = message.content.filter(block => block.type !== 'tool-result')
    const toolResults = message.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => (
      block.type === 'tool-result'
    ))
    const content = userContent(await contentParts(regular, images, messageIndex + 1, nextImage))
    // 中文：有普通内容（或无工具结果）时先冲刷挂起图片，再发 user 消息。
    if (content.length > 0 || toolResults.length === 0) {
      flushToolImages()
      wire.push({
        role: 'user',
        content,
      })
    }
    // 中文：工具结果：文本进 tool 消息，图片进 pendingToolImages 待合并。
    for (const result of toolResults) {
      const parts = await contentParts(result.content, images, messageIndex + 1, nextImage)
      const imageParts = parts.filter((part): part is WireImageContentPart => part.type !== 'text')
      const text = parts.filter(part => part.type === 'text').map(part => part.text).join('')
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: text || '(no output)',
      })
      pendingToolImages.push(...imageParts)
    }
  }
  flushToolImages()
  return wire
}

/** Assemble request fields shared by text-only and image-capable conversion. */
// 中文：组装纯文本与图片能力两条路径共用的请求字段（工具、思考、采样参数；
// 未提供的一律省略，让 provider 默认值生效）。
function requestWithMessages(
  options: GenerateOptions,
  messages: WireMessage[],
  defaults: RequestDefaults,
): WireRequest {
  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  const resolvedThinking = resolveThinking(options, defaults)
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

/*
 * （中文）构建完整线上请求。始终流式（stream: true、用量上报开启）；可选
 * 字段省略而非发送 null，让 provider 默认值生效。
 * @param options harness 请求（模型、历史、系统提示、工具、采样）。
 * @param defaults 适配器级思考默认值；undefined 字段不上线。
 * @returns chat-completions 请求体。
 */
/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the chat-completions request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  return requestWithMessages(options, messages, defaults)
}

/*
 * （中文）构建一个具备图片能力的请求，同时把持久字节挡在会话消息之外。
 * 在精确请求版本字节长度已知、provider 序列化之前，超大的最旧图片变成确定性
 * 文本。
 * @param options 包含图片能力 user 内容的 harness 请求。
 * @param images 附件解析器、请求上限与取消。
 * @param defaults 适配器级思考默认值。
 * @returns 完全物化后的 DeepSeek 请求体。
 */
/**
 * Build one image-capable request while keeping durable bytes out of session
 * messages. Oversized oldest images become deterministic text after their
 * exact request-version byte lengths are known and before provider serialization.
 * @param options - harness request containing image-capable user content.
 * @param images - attachment resolver, request bound, and cancellation.
 * @param defaults - adapter-level thinking defaults.
 * @returns the fully materialized DeepSeek request body.
 */
export async function serializeRequestWithImages(
  options: GenerateOptions,
  images: ImageSerializationOptions,
  defaults: RequestDefaults = {},
): Promise<WireRequest> {
  assertSupportedImageRoles(options.messages)
  // 中文：先按精确请求版本字节做超限卸载（file 表示按原始字节、base64 表示
  // 按编码后长度核算），再序列化。
  const requestMessages = offloadRequestImagesWithPolicy(options.messages, {
    representation: images.representation.kind === 'file' ? 'raw' : 'base64',
    byteLength: (ref) => {
      const version = images.requestImages.get(ref.attachmentId)
      if (version === undefined) {
        throw new LlmError(`DeepSeek request image ${ref.attachmentId} was not prepared.`, 'INVALID_REQUEST')
      }
      return version.bytes
    },
    maxBytes: images.maxRequestImageBytes,
    ...images.maxImagesPerRequest === undefined ? {} : { maxImages: images.maxImagesPerRequest },
    ...images.byteQuantum === undefined ? {} : { byteQuantum: images.byteQuantum },
    ...images.countQuantum === undefined ? {} : { countQuantum: images.countQuantum },
  })
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...await serializeMessagesWithImages(requestMessages, images))
  return requestWithMessages(options, messages, defaults)
}
