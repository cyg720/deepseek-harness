/** ACP wire-content admission and projection owned by the ACP adapter. @module */
/*
 * 文件职责：负责 ACP 线协议内容与核心消息内容之间的准入、持久化和双向转换。
 * 技术维度：使用 TypeScript 判别联合、严格 Base64 校验、附件服务和模型能力查询处理富媒体内容。
 * 产品维度：让自动化客户端安全发送文本与图片，并只接收已经提交且可验证的助手输出。
 * 逻辑维度：先验证图片格式与模型路由，再成批保存附件并重建顺序；输出侧重新读取附件后编码为 ACP 内容。
 * 关键边界：只支持四种栅格图片；音频和内嵌资源不准入；任何二进制内容都不能直接进入会话日志或错误信息。
 * 新手阅读建议：先看 AcpContentError 和 decodeImage，再按 admitAcpPrompt 的两遍处理理解原子准入，最后看输出投影。
 */

import type { ContentBlock as AcpContentBlock } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Raster formats shared by ACP image blocks and the core attachment vocabulary. */
/* ACP 图片块与核心附件服务共同支持的栅格媒体类型白名单。 */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
/* 严格 RFC 4648 Base64 正则，不接受空白、URL 安全变体或非规范填充。 */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Content-admission failure category used by the protocol handler. */
/* 协议处理器使用的内容失败类别：请求无效或服务内部故障。 */
export type AcpContentFailureKind = 'invalid' | 'internal'

/** Error with a stable ACP request-failure category and no raw binary payload. */
/* 带稳定 ACP 失败分类且不会泄露原始二进制数据的内容异常。 */
export class AcpContentError extends Error {
  /** Whether the bridge should report invalid params or an internal failure. */
  /* 决定桥接层应报告参数错误还是内部错误。 */
  readonly kind: AcpContentFailureKind

  /**
   * @param message - safe protocol-facing detail without inline binary data.
   * @param kind - request-failure category.
   * @param options - optional causal chain for diagnostics.
   */
  /*
   * 创建带安全消息和稳定分类的内容异常。
   * @param message 可返回协议客户端且不含内联二进制的说明。
   * @param kind 请求失败类别。
   * @param options 可选的原始异常链，供内部诊断使用。
   * @example throw new AcpContentError('empty prompt', 'invalid')
   */
  constructor(message: string, kind: AcpContentFailureKind, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AcpContentError'
    this.kind = kind
  }
}

/** Narrow a wire MIME string to the durable raster vocabulary. */
/*
 * 将线协议 MIME 字符串收窄为附件服务支持的图片类型。
 * @param value 客户端提供的 MIME 字符串。
 * @returns 命中白名单时返回图片类型，否则返回 undefined。
 * @example imageMediaType('image/png')
 */
function imageMediaType(value: string): ImageMediaType | undefined {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType) ? value as ImageMediaType : undefined
}

/** Strictly decode one ACP inline image without accepting base64 aliases. */
/*
 * 严格解码一个 ACP 内联图片块。
 * @param block 已按判别字段收窄的图片块。
 * @returns 可提交给附件服务的字节与媒体类型。
 * @example decodeImage({ type: 'image', data: 'AQ==', mimeType: 'image/png' })
 */
function decodeImage(block: Extract<AcpContentBlock, { type: 'image' }>): SaveImageAttachment {
  // 经过白名单收窄后的图片媒体类型。
  const mediaType = imageMediaType(block.mimeType)
  if (mediaType === undefined) {
    throw new AcpContentError('image mimeType must be image/png, image/jpeg, image/webp, or image/gif', 'invalid')
  }
  if (!CANONICAL_BASE64.test(block.data)) {
    throw new AcpContentError('image data must be canonical base64', 'invalid')
  }
  // 按 Base64 解码的真实图片字节；随后会重新编码确认规范性。
  const data = Buffer.from(block.data, 'base64')
  if (data.toString('base64') !== block.data) {
    throw new AcpContentError('image data must be canonical base64', 'invalid')
  }
  return { data, mediaType }
}

/** Resolve the exact current route and require explicit image input support. */
/*
 * 解析代理当前精确模型路由并确认它明确支持图片输入。
 * @param ctx 可查询 LLM 服务的 Cordis 上下文。
 * @param agent 本次接收提示的代理。
 * @param signal 路由查询的取消信号。
 * @returns 路由存在且支持图片时完成，否则抛出分类异常。
 * @example await assertImageRoute(ctx, agent, signal)
 */
async function assertImageRoute(ctx: Context, agent: Agent, signal: AbortSignal): Promise<void> {
  // 会话最新请求头中可能覆盖代理默认配置的路由。
  const routed = agent.session.requestHeader()?.config
  // 优先采用会话请求头的提供方，否则使用代理默认值。
  const provider = routed?.provider ?? agent.options.provider
  // 优先采用会话请求头的模型，否则使用代理默认值。
  const model = routed?.model ?? agent.options.model
  // 当前上下文挂载的模型目录服务。
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new AcpContentError('the current model route could not be resolved for image input', 'invalid')
  }
  // 精确路由对应的模型能力信息。
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, signal)
  } catch (error: unknown) {
    throw new AcpContentError('the current model route could not be verified for image input', 'internal', { cause: error })
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new AcpContentError(`model "${model}" does not declare image input`, 'invalid')
  }
}

/**
 * Determine whether initialization may truthfully advertise inline image prompts.
 * Unknown service, route, capability, or deployment media support is negative.
 * @param ctx - bridge context carrying optional attachment and model services.
 * @param provider - configured provider route used for newly created sessions.
 * @param model - configured exact model id used for newly created sessions.
 * @returns whether this bridge can admit images at initialization time.
 */
export async function supportsAcpImagePrompts(
  ctx: Context,
  provider: string | undefined,
  model: string | undefined,
): Promise<boolean> {
  // 用于保存和读取图片的附件服务。
  const attachments = ctx.get('attachments')
  // 用于查询模型输入模态的 LLM 服务。
  const llm = ctx.get('llm')
  if (attachments === undefined || llm === undefined || provider === undefined || model === undefined) return false
  if (!attachments.imageLimits.mediaTypes.some(mediaType => IMAGE_MEDIA_TYPES.includes(mediaType))) return false
  try {
    // 初始化路由对应的模型能力信息。
    const info = await llm.resolveModelInfo(provider, model)
    return info.inputModalities?.includes('image') === true
  } catch {
    return false
  }
}

/** Render one baseline resource link into the core's current text vocabulary. */
/*
 * 将基础资源链接渲染为核心当前支持的文本标记。
 * @param block ACP 资源链接块。
 * @returns 保留名称与 URI 的换行文本。
 * @example resourceLinkText({ type: 'resource_link', name: 'a', uri: 'file:///a' })
 */
function resourceLinkText(block: Extract<AcpContentBlock, { type: 'resource_link' }>): string {
  return `\n[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]\n`
}

/**
 * Admit one ACP prompt into ordered durable core content.
 * Every wire block and image is validated before the ordered image batch starts
 * writing; cancellation after a successful content-addressed write may leave an
 * unreachable object but never queues a late user message.
 * @param ctx - bridge context carrying attachment and model services.
 * @param agent - destination agent whose latest exact route controls admission.
 * @param prompt - untrusted ACP prompt blocks in wire order.
 * @param imageEnabled - capability result advertised during initialization.
 * @param signal - admission cancellation signal.
 * @returns core content with durable image references in wire order.
 */
export async function admitAcpPrompt(
  ctx: Context,
  agent: Agent,
  prompt: readonly AcpContentBlock[],
  imageEnabled: boolean,
  signal: AbortSignal,
): Promise<ContentBlock[]> {
  // 首遍验证后待成批持久化的图片输入，顺序与线协议一致。
  const images: SaveImageAttachment[] = []
  for (const block of prompt) {
    switch (block.type) {
      case 'text':
      case 'resource_link':
        break
      case 'image':
        if (!imageEnabled) throw new AcpContentError('inline image prompts were not advertised by this connection', 'invalid')
        images.push(decodeImage(block))
        break
      case 'audio':
        throw new AcpContentError('audio prompt content is not supported', 'invalid')
      case 'resource':
        throw new AcpContentError('embedded resource prompt content is not supported', 'invalid')
      /* v8 ignore next 2 -- ACP ContentBlock is a closed generated union. */
      default:
        throw new AcpContentError('unsupported ACP prompt content', 'invalid')
    }
  }

  // 附件服务返回的持久引用，与 images 使用相同顺序。
  let refs: readonly ImageAttachmentRef[] = []
  if (images.length > 0) {
    // 承担图片原子批量写入的附件服务。
    const attachments = ctx.get('attachments')
    if (attachments === undefined) throw new AcpContentError('no attachment store is mounted', 'invalid')
    await assertImageRoute(ctx, agent, signal)
    signal.throwIfAborted()
    try {
      refs = await attachments.saveImages(images)
    } catch (error: unknown) {
      if (isImageAdmissionError(error)) {
        throw new AcpContentError(error.message, 'invalid', { cause: error })
      }
      throw new AcpContentError('unable to persist the prompt image batch', 'internal', { cause: error })
    }
    signal.throwIfAborted()
  }

  // 第二遍重建出的核心内容块，保留原始线协议顺序。
  const content: ContentBlock[] = []
  // 连续文本与资源链接合并后的待提交文本。
  let pendingText = ''
  // 下一条图片块应消费的持久引用下标。
  let imageIndex = 0
  /**
   * 把非空待处理文本写入结果并清空缓冲区。
   * @returns 无返回值。
   * @example flushText()
   */
  const flushText = (): void => {
    if (pendingText.length === 0) return
    content.push({ type: 'text', text: pendingText })
    pendingText = ''
  }
  for (const block of prompt) {
    switch (block.type) {
      case 'text':
        pendingText += block.text
        break
      case 'resource_link':
        pendingText += resourceLinkText(block)
        break
      case 'image': {
        flushText()
        // 与当前图片块位置对应的持久附件引用。
        const ref = refs[imageIndex++] as ImageAttachmentRef
        content.push({ type: 'image', attachment: ref })
        break
      }
      /* v8 ignore start -- the validation pass above rejects both tags before reconstruction. */
      case 'audio':
      case 'resource':
        break
      /* v8 ignore stop */
      /* v8 ignore next 2 -- validated by the first closed-union switch. */
      default:
        break
    }
  }
  flushText()
  if (!content.some(block => block.type === 'image' || (block.type === 'text' && block.text.trim().length > 0))) {
    throw new AcpContentError('empty prompt', 'invalid')
  }
  return content
}

/**
 * Translate one committed assistant block to ACP wire content.
 * Images are re-read and integrity-verified before inline base64 delivery;
 * unsupported core output blocks stay off the automation wire.
 * @param ctx - bridge context carrying the authoritative attachment store.
 * @param block - committed core assistant block.
 * @returns ACP text/image content, or undefined for non-output blocks.
 */
export async function assistantBlockToAcp(
  ctx: Context,
  block: ContentBlock,
): Promise<AcpContentBlock | undefined> {
  if (block.type === 'text') {
    return block.text.length === 0 ? undefined : { type: 'text', text: block.text }
  }
  if (block.type !== 'image') return undefined
  // 输出图片必须从权威附件存储重新读取，不能信任消息中的附加数据。
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new AcpContentError('cannot deliver assistant image: no attachment store is mounted', 'internal')
  }
  // 经过附件服务存在性与完整性验证的图片记录。
  let stored: Awaited<ReturnType<typeof attachments.readImage>>
  try {
    stored = await attachments.readImage(block.attachment)
  } catch (error: unknown) {
    throw new AcpContentError('cannot deliver assistant image: the attachment is unavailable or corrupt', 'internal', { cause: error })
  }
  return {
    type: 'image',
    data: Buffer.from(stored.data).toString('base64'),
    mimeType: stored.ref.mediaType,
  }
}
