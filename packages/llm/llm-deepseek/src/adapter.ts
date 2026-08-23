/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 DeepSeekAdapter：对 DeepSeek（OpenAI 兼容）chat-completions
 * 端点做 fetch + SSE 流式请求，产出 harness 的 StreamChunk。纯传输层——连接
 * 事实通过"每次操作解析一次的 thunk"注入，令牌通过每请求解析器注入。
 * 【技术维度】每次流式调用解析一次连接快照（连接事实与凭据在本次请求内冻结），
 * 配置变更影响下一个请求而进行中的流不变；用 idleWatchdog 做读空闲超时；
 * 图片请求走 Files API（file 表示）并在失败时回退 base64；非 2xx 响应统一
 * 归类为稳定错误码并携带 retry-after/request-id 事实。
 * 【产品维度】DeepSeek 官方 provider 的完整接入：思考模式、推理强度、工具
 * 调用、多模态图片、用量统计与错误诊断都在这一个类里落地。
 * 【逻辑维度】类型（目录模型/连接事实/构造选项）→ 默认常量 → 辅助函数
 * （图片收集/拒绝诊断/错误码映射）→ DeepSeekAdapter 类（解析/流式/请求）。
 * 【关键边界】目录外的模型按纯文本处理（不声明未验证的图片能力）；文件 id
 * 被 provider 拒绝时先失效映射并重试一次（file → base64）；空闲超时映射为
 * TIMEOUT、调用方取消映射为 ABORTED、其余传输失败映射为 TRANSPORT。
 * 【新手阅读建议】先读 DeepSeekConnectionOptions 与 DeepSeekAdapterOptions，
 * 再读 streamWithConnection（生命周期）与 request（一次线上请求的完整流程）。
 * ==========================================================================
 */

/**
 * `DeepSeekAdapter`: fetch + SSE against a DeepSeek (OpenAI-compatible)
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module dsh-llm-deepseek/adapter
 */

import { attributionHeaders, contentHasImage, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, offloadRequestImagesWithPolicy, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  PreparedAdapterCall,
  LlmResolvedModelInfo,
  ModelModality,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type {
  AttachmentId,
  AttachmentStore,
  ImageAttachmentRef,
  ImageRequestPolicy,
  RequestImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { deadline, idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { serializeRequest, serializeRequestWithImages } from './serialize.ts'
import type { ImageWireLocation, RequestDefaults } from './serialize.ts'
import { DeepSeekFileStore } from './file-store.ts'
import type { DeepSeekFilePolicy } from './file-store.ts'
import type { DeepSeekFileId } from './file-id.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type { WireError, WireRequest } from './types.ts'

/** One optional model entry advertised by the direct-fetch adapter. */
/**
 * （中文）直连 fetch 适配器宣传的一条可选模型条目。
 */
export interface DeepSeekCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  // 中文：配置的端点接受的线上模型 id。
  id: string
  /** Selector label; defaults to {@link id}. */
  // 中文：选择器标签；缺省用 id。
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  // 中文：可选的选择器详情（用于有相似模型变体的部署）。
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  // 中文：已知的请求+响应合并上下文容量；部署元数据不可用时省略。
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link DeepSeekConnectionOptions.maxTokens}. */
  // 中文：该模型的每请求输出上限；省略则回退到配置档的 maxTokens。
  maxTokens?: number
  /** Accepted request modalities; omission is text-only. */
  // 中文：接受的请求模态；省略表示纯文本。
  inputModalities?: ModelModality[]
  /** Total-pixel budget for one deterministic request preview. */
  // 中文：单次确定性请求预览的总像素预算。
  imagePixelBudget?: number
  /** Encoded-byte cap for one deterministic request preview. */
  // 中文：单次确定性请求预览的编码字节上限。
  imageMaxBytes?: number
  /** Provider detail tier; `low` uses the 512-by-512 total-pixel default. */
  // 中文：provider 细节档位；low 使用 512x512 总像素默认值。
  imageDetail?: 'auto' | 'low'
}

/**
 * （中文）一次操作已校验的连接事实。插件里的 resolveAdapterOptions 是产出该
 * 结构的唯一显式解析步骤；适配器信任它并按操作重读，这正是"配置变更无需
 * 重新注册即可影响下一个请求"的原因。
 */
/**
 * Validated connection facts for one operation. The plugin's
 * `resolveAdapterOptions` is the one explicit resolve step producing this
 * shape; the adapter trusts it and re-reads it per operation, which is what
 * makes a configuration change reach the next request without re-registration.
 */
export interface DeepSeekConnectionOptions {
  /** Endpoint base; `/chat/completions` is appended. */
  // 中文：端点基址；请求时追加 /chat/completions。
  baseURL: string
  /**
   * Credential reference of this same resolution, resolved per request.
   * Travelling with the endpoint is the point: a request can never pair one
   * generation's URL with another generation's secret. Configuration carries
   * only this name — a literal key is not a configuration value.
   */
  // 中文：同一次解析的凭据引用，按请求解析。与端点同行是关键：请求永远不会
  // 把某一世代的 URL 与另一世代的密钥配对。配置只携带这个名字——字面 key
  // 不是合法的配置值。
  apiKeyEnv: CredentialRef
  /** Request defaults applied to every call (thinking mode, effort). */
  // 中文：应用到每个调用的请求默认值（思考模式、强度）。
  defaults: RequestDefaults
  /** Default per-request output cap; explicit request values win. */
  // 中文：默认每请求输出上限；请求显式值优先。
  maxTokens: number
  /** Positive context capacity used when the selected model has no exact value. */
  // 中文：所选模型无精确值时的正上下文容量。
  defaultContextWindow: number
  /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
  // 中文：暴露给发现消费者的建议模型；请求本身不受此限制。
  models: readonly DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  // 中文：一次流读取挂起时 provider 的最大空闲时间。
  streamIdleTimeoutMs: number
  /** Maximum accumulated file-referenced image bytes in one request. */
  // 中文：一次请求累计的"文件引用图片"字节上限。
  maxRequestFilesBytes: number
  /** Maximum accumulated base64 image payload after Files API fallback. */
  // 中文：Files API 回退后累计 base64 图片载荷上限。
  maxInlineRequestImageBytes: number
  /** Maximum number of represented images in one request. */
  // 中文：一次请求可表示的图片数量上限。
  maxImagesPerRequest: number
  /** Raw-byte removal step after the file-reference bound is exceeded. */
  // 中文：超过文件引用上限后的原始字节移除步长。
  imageOffloadByteQuantum: number
  /** Base64-byte removal step after the inline fallback bound is exceeded. */
  // 中文：超过内联回退上限后的 base64 字节移除步长。
  inlineImageOffloadByteQuantum: number
  /** Image-count removal step after the count bound is exceeded. */
  // 中文：超过数量上限后的数量移除步长。
  imageOffloadCountQuantum: number
  /** Maximum duration of one request-image Files API resolution. */
  // 中文：单次请求图片的 Files API 解析最大耗时。
  filesApiTimeoutMs: number
  /** Upload expiry, refresh, and quota-recovery policy. */
  // 中文：上传过期、刷新与配额恢复策略。
  filePolicy: DeepSeekFilePolicy
  /** Provider-owned model-request retry policy, already resolved. */
  // 中文：provider 自有的模型请求重试策略，已解析。
  retryPolicy: ResolvedRetryPolicy
}

/** Constructor options for {@link DeepSeekAdapter}: the operation-local resolution hooks the plugin owns. */
/**
 * （中文）DeepSeekAdapter 的构造选项：插件拥有的操作级解析钩子。
 */
export interface DeepSeekAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  // 中文：当前已校验的连接事实；每次操作调用一次。
  options: () => DeepSeekConnectionOptions
  /**
   * Resolve the bearer token for the connection facts of one request. The
   * snapshot is passed in — never re-read — so the key can only ever come
   * from the same resolution as the endpoint it is sent to. Throws `LlmError`
   * `MISSING_CREDENTIAL` when no key is available anywhere.
   */
  // 中文：为某次请求的连接事实解析承载令牌。快照传入——绝不重读——因此密钥
  // 只能与它发往的端点来自同一次解析。任何地方都没有 key 时抛
  // LlmError('MISSING_CREDENTIAL')。
  resolveApiKey: (connection: DeepSeekConnectionOptions) => Promise<string>
  /** Resolve the harness-home anonymous id shared with telemetry and feedback. */
  // 中文：解析与遥测/反馈共享的 harness 主目录匿名 id。
  resolveUserId: () => AnonymousUserId
  /** Resolve the current durable attachment service; absence rejects image input. */
  // 中文：解析当前持久附件服务；缺省则拒绝图片输入。
  resolveAttachments?: () => AttachmentStore | undefined
  /** Resolve the process-wide upload reuse store. */
  // 中文：解析进程级上传复用存储。
  resolveFiles?: () => DeepSeekFileStore
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
// 中文：适配器流读取挂起时的默认最大空闲间隔（5 分钟）。
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default combined request/response context capacity. */
// 中文：默认请求+响应合并上下文容量（100 万 token）。
export const DEFAULT_CONTEXT_WINDOW = 1_000_000
/** Default per-request output-token cap. */
// 中文：默认每请求输出 token 上限。
export const DEFAULT_MAX_TOKENS = 256_000
/** Default bound on accumulated file-referenced image bytes per request. */
// 中文：每请求累计文件引用图片字节的默认上限（128 MiB）。
export const DEFAULT_MAX_REQUEST_FILES_BYTES = 128 * 1024 * 1024
/** Default bound on accumulated base64 image payload after Files API fallback. */
// 中文：Files API 回退后累计 base64 图片载荷的默认上限（20 MiB）。
export const DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
/** Provider request image-count limit. */
// 中文：provider 每请求图片数量上限。
export const DEFAULT_MAX_IMAGES_PER_REQUEST = 600
/** Total-pixel budget matching DeepSeek's normal vision projection. */
// 中文：与 DeepSeek 常规视觉投影匹配的总像素预算。
export const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 640_000
/** Total-pixel budget matching provider low-detail image input. */
// 中文：与 provider 低细节图片输入匹配的总像素预算。
export const DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET = 512 * 512
/** Encoded-byte cap for one deterministic model-request image. */
// 中文：单张确定性模型请求图片的编码字节上限。
export const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024
/** Deterministic raw-byte removal step. */
// 中文：确定性的原始字节移除步长（64 MiB）。
export const DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM = 64 * 1024 * 1024
/** Deterministic base64-byte removal step after Files API fallback. */
// 中文：Files API 回退后的确定性 base64 字节移除步长（10 MiB）。
export const DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM = 10 * 1024 * 1024
/** Deterministic image-count removal step. */
// 中文：确定性的图片数量移除步长。
export const DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM = 20
/** Default explicit lifetime for uploaded images. */
// 中文：上传图片的默认显式存活期（7 天）。
export const DEFAULT_FILE_EXPIRY_SECONDS = 7 * 24 * 60 * 60
/** Default proactive refresh window for indexed file ids. */
// 中文：索引文件 id 的默认主动刷新窗口（1 小时）。
export const DEFAULT_FILE_REFRESH_MARGIN_SECONDS = 60 * 60
/** Default number of oldest harness-owned files removed on quota recovery. */
// 中文：配额恢复时移除的最旧 harness 自有文件数默认值。
export const DEFAULT_FILE_QUOTA_CLEANUP_BATCH = 100
/** Default deadline for resolving one request image through the Files API. */
// 中文：通过 Files API 解析单张请求图片的默认时限（60 秒）。
export const DEFAULT_FILES_API_TIMEOUT_MS = 60_000
// 中文：流空闲超时的内部错误码（供 idleWatchdog 匹配）。
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'
// 中文：Files API 解析超时的内部错误码（供 deadline 匹配）。
const FILES_API_TIMEOUT_CODE = 'DEEPSEEK_FILES_API_TIMEOUT'
// 中文：四个官方推理强度的品牌化 id 与展示名。
const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
  { id: LOW_REASONING_EFFORT, name: 'Low' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: MAX_REASONING_EFFORT, name: 'Max' },
] as const
// 中文：部署禁用思考时只暴露 Off 一个强度。
const OFF_ONLY_REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
] as const

/** Marks a failed file-id resolution that may be retried as an inline request. */
// 中文：标记"文件 id 解析失败、可退化为内联请求"的错误类型（request 里据此
// 决定把表示方式切到 base64 后重试）。
class FileResolutionFailure extends Error {
  constructor(cause: unknown) {
    super('DeepSeek Files API could not resolve a request image.', { cause })
    this.name = 'FileResolutionFailure'
  }
}

// 中文：递归收集内容树（含嵌套 tool-result）里的图片引用。
function collectImageRefs(
  content: readonly ContentBlock[],
  refs: Map<AttachmentId, ImageAttachmentRef>,
): void {
  for (const block of content) {
    if (block.type === 'image') refs.set(block.attachment.attachmentId, block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, refs)
  }
}

/**
 * （中文）解析某条 DeepSeek 模型路由拥有的请求图片预算。
 * @param model 宣传的模型路由及其可选图片覆盖项。
 * @returns 完整的像素与编码字节预算。
 */
/**
 * Resolve the request-image budgets owned by one DeepSeek model route.
 * @param model - Advertised model route and its optional image overrides.
 * @returns Complete pixel and encoded-byte budgets.
 * @internal
 */
export function resolveRequestImagePolicy(model: DeepSeekCatalogModel): ImageRequestPolicy {
  let maxPixels: number
  if (model.imagePixelBudget !== undefined) maxPixels = model.imagePixelBudget
  else if (model.imageDetail === 'low') maxPixels = DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET
  else maxPixels = DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET
  return {
    maxPixels,
    maxBytes: model.imageMaxBytes === undefined
      ? DEFAULT_REQUEST_IMAGE_MAX_BYTES
      : model.imageMaxBytes,
  }
}

// 中文：为请求中的每张图片解析"请求版本"（按附件 id 映射；读取请求图片可能
// 触发规范化/裁剪）。
async function prepareRequestImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  model: DeepSeekCatalogModel,
  signal: AbortSignal,
): Promise<Map<AttachmentId, RequestImageAttachment>> {
  const refs = new Map<AttachmentId, ImageAttachmentRef>()
  for (const message of options.messages) collectImageRefs(message.content, refs)
  const policy = resolveRequestImagePolicy(model)
  const orderedRefs = [...refs.values()]
  const projected = await Promise.all(orderedRefs.map(
    ref => attachments.readImageRequest(ref, policy, signal),
  ))
  return new Map(orderedRefs.map((ref, index) => (
    [ref.attachmentId, projected[index] as RequestImageAttachment]
  )))
}

// 中文：判断 provider 报错是否针对"已被 harness 规范化过的图片字节"（含
// "unsupported/invalid/cannot read/failed to decode...image" 等措辞）。
function providerRejectedNormalizedImage(detail: string): boolean {
  const reasonBeforeImage = /(?:unsupported|invalid|cannot read|failed to (?:decode|process)).{0,40}image/iu
  const imageBeforeReason = /image.{0,40}(?:unsupported|invalid|cannot be decoded)/iu
  return reasonBeforeImage.test(detail) || imageBeforeReason.test(detail)
}

// 中文：一次请求中实际用到的"请求版本 → 文件 id"映射（含诊断位置）。
interface UsedRequestFile {
  version: RequestImageAttachment
  fileId: DeepSeekFileId
  location: ImageWireLocation
}

// 中文：判断 provider 报错是否针对文件 id（过期/不存在/已删除等）。
function providerRejectedFileId(detail: string): boolean {
  const file = /\bfile(?:[_ -]?(?:id|api|not[_ -]?found|deleted|expired))?/iu.test(detail)
  const missing = /(?:expired|not[_ -]?found|deleted|do(?:es)? not exist|not created under (?:this|your) account)/iu.test(detail)
  const invalidId = /(?:invalid.{0,20}file[_ -]?(?:id|api)|file[_ -]?(?:id|api).{0,20}invalid)/iu.test(detail)
  return file && (missing || invalidId)
}

// 中文：判断报错文本是否以"整词"方式点名某个具体文件 id（前后都不是
// 字母/数字/下划线/连字符）。
function detailNamesFileId(detail: string, fileId: DeepSeekFileId): boolean {
  let index = detail.indexOf(fileId)
  while (index >= 0) {
    const before = detail[index - 1]
    const after = detail[index + fileId.length]
    if ((before === undefined || !/[\p{L}\p{N}_-]/u.test(before))
      && (after === undefined || !/[\p{L}\p{N}_-]/u.test(after))) return true
    index = detail.indexOf(fileId, index + 1)
  }
  return false
}

// 中文：选定要失效的映射：报错精确点名了某个文件 id 就只失效它，否则全部
// 视为可疑（先按变体+文件 id 去重）。
function staleMappings(
  files: readonly UsedRequestFile[],
  detail: string,
): UsedRequestFile[] {
  const unique = [...new Map(files.map(file => [`${file.version.variantId}\0${file.fileId}`, file])).values()]
  const exact = unique.filter(file => detailNamesFileId(detail, file.fileId))
  return exact.length > 0 ? exact : unique
}

// 中文：渲染一张规范化图片的诊断事实（名称、消息/图片序号、媒体类型、位深、
// 尺寸）。
function normalizedImageFacts(
  file: { version: RequestImageAttachment; location: ImageWireLocation },
): string {
  const version = file.version
  const name = version.attachment.name ?? version.attachment.attachmentId
  const colour = version.hasAlpha ? 'sRGBA' : 'sRGB'
  return `"${name}" at message ${file.location.message}, image ${file.location.image} `
    + `(${version.mediaType}, 8-bit ${colour}, ${version.width}x${version.height})`
}

// 中文：构造"provider 拒绝规范化图片"的用户可见诊断：能定位到具体文件就点名，
// 否则列出全部候选图片并提示支持的输入格式。
function normalizedImageDiagnostic(
  files: readonly UsedRequestFile[],
  providerMessage: string,
  providerDetail: string,
): string {
  const exact = files.find(file => detailNamesFileId(providerDetail, file.fileId))
  const target = exact ?? (files.length === 1 ? files[0] : undefined)
  if (target !== undefined) {
    return `DeepSeek rejected normalized image ${normalizedImageFacts(target)}: ${providerMessage}. `
      + 'The provider rejected bytes already normalized by the harness; PNG, JPEG, WebP, and GIF remain supported input formats.'
  }
  const candidates = [...new Map(files.map(file => [
    `${file.version.variantId}\0${file.location.message}\0${file.location.image}`,
    file,
  ])).values()]
  return `DeepSeek rejected a normalized request image: ${providerMessage}. Candidate images: `
    + `${candidates.map(normalizedImageFacts).join('; ')}. `
    + 'The provider rejected bytes already normalized by the harness; PNG, JPEG, WebP, and GIF remain supported input formats.'
}

// 中文：把目录模型条目转成 LlmModelInfo（补 name/模态默认值）。
function modelInfo(provider: string, model: DeepSeekCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: model.inputModalities ?? ['text'],
  }
}

// 中文：解析 Retry-After 头：纯数字按秒换算，否则按 HTTP 日期解析；只接受
// 正有限延迟。
function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

// 中文：从响应头读取 provider 请求 id（两个候选头名）。
function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-deepseek-request-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/**
 * （中文）把 HTTP 状态码映射为稳定的 LlmError code。
 * @param status 非 2xx provider 响应的状态码。
 * @param error 解析出的 provider 错误体（可用时）。
 * @returns 规范化后的 harness 错误码。
 */
/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, error?: WireError['error']): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 413) return 'INVALID_REQUEST'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  // 中文：先按错误文本分类（配额耗尽优先于通用 429 限流）。
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * （中文）第一个真正的 LlmAdapter。一个实例服务它注册名下的每个模型名
 * （harness 模型名就是线上模型名）。
 * 同一个稳定信号同时到达首次 fetch 与响应体读取。调用方取消映射为 ABORTED；
 * 配置的每读空闲看门狗映射为 TIMEOUT。
 */
/**
 * The first real `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class DeepSeekAdapter extends LlmAdapter {
  // 中文：进程级上传复用存储（图片文件 id 缓存）。
  private readonly files: DeepSeekFileStore

  constructor(private readonly config: DeepSeekAdapterOptions) {
    super()
    this.files = config.resolveFiles?.() ?? new DeepSeekFileStore()
  }

  // 中文：provider 展示名固定为 DeepSeek。
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'DeepSeek' }
  }

  // 中文：重试策略每次从最新连接事实读取（配置变化无需重注册即生效）。
  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  // 中文：目录模型即建议模型列表。
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)))
  }

  // 中文：精确模型解析：从当前连接事实的目录查找模型能力。
  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.modelInfoFor(this.config.options(), provider, model))
  }

  // 中文：按连接事实组装精确模型元数据：目录命中用其能力，未命中按纯文本处理
  // 并给出默认上下文/输出上限；推理强度列表随部署思考策略（禁用时只留 Off）。
  private modelInfoFor(
    connection: DeepSeekConnectionOptions,
    provider: string,
    model: string,
  ): LlmResolvedModelInfo {
    const configured = connection.models.find(entry => entry.id === model)
    const contextWindow = configured?.contextWindow
      ?? connection.defaultContextWindow
    return {
      // An uncatalogued endpoint is safely treated as text-only. Declaring an
      // unverified image capability would let the host persist input that the
      // endpoint may reject on every later turn.
      // 中文：未收录的端点安全地按纯文本处理。声明未经验证的图片能力会让宿主
      // 持久化"端点可能每一轮都拒绝"的输入。
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      ...connection.defaults.thinking === 'disabled'
        ? {
          reasoning: {
            efforts: OFF_ONLY_REASONING_EFFORTS,
            defaultEffort: OFF_REASONING_EFFORT,
          },
        }
        : {
          reasoning: {
            efforts: REASONING_EFFORTS,
            defaultEffort: connection.defaults.reasoningEffort === 'off'
              ? OFF_REASONING_EFFORT
              : connection.defaults.reasoningEffort === 'low'
                ? LOW_REASONING_EFFORT
                : connection.defaults.reasoningEffort === 'max'
                  ? MAX_REASONING_EFFORT
                  : HIGH_REASONING_EFFORT,
          },
        },
    }
  }

  // 中文：预备调用：把当前连接快照绑进 stream 分发（一次世代）。
  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = this.config.options()
    return Promise.resolve({
      model: this.modelInfoFor(connection, provider, model),
      stream: options => this.streamWithConnection(options, connection),
    })
  }

  // 中文：公开入口：用"当前连接事实"直接流式。
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithConnection(options, this.config.options())
  }

  // 中文：流式主流程：冻结一次连接快照 → 校验图片能力并准备附件 → 解析 key/
  // userId → 挂空闲看门狗 → 迭代 request 产出，异常统一映射为稳定错误码。
  private async * streamWithConnection(
    options: GenerateOptions,
    connection: DeepSeekConnectionOptions,
  ): AsyncIterable<StreamChunk> {
    // One resolution per stream call: connection facts and the credential
    // freeze here and hold for this whole request, so an in-flight stream
    // never observes a configuration change and the next call re-resolves.
    // The key resolves *from this snapshot*, so an endpoint and the secret
    // sent to it can never come from different configuration generations.
    // 中文：每次流式调用解析一次：连接事实与凭据在这里冻结并贯穿整个请求，
    // 因此进行中的流永远不会观察到配置变化，下一次调用再重新解析。密钥从
    // *这个快照* 解析，端点与发往它的密钥永远不可能来自不同配置世代。
    const hasImages = options.messages.some(message => contentHasImage(message.content))
    let attachments: AttachmentStore | undefined
    if (hasImages) {
      const model = connection.models.find(entry => entry.id === options.model)
      // 中文：请求含图但模型未声明图片能力 → 拒绝。
      if (model?.inputModalities?.includes('image') !== true) {
        throw new LlmError(
          `DeepSeek model "${options.model}" does not accept image input.`,
          'UNSUPPORTED_CONTENT',
        )
      }
      attachments = this.config.resolveAttachments?.()
      if (attachments === undefined) {
        throw new LlmError(
          'DeepSeek image conversion requires the durable attachment service.',
          'UNSUPPORTED_CONTENT',
        )
      }
    }
    const apiKey = await this.config.resolveApiKey(connection)
    const userId = this.config.resolveUserId()
    // 中文：合并调用方信号与本地消费方控制器；idleWatchdog 监视读空闲。
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      apiKey,
      userId,
      attachments,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      // 中文：异常归类：空闲超时 → TIMEOUT；调用方取消 → ABORTED；已是
      // LlmError 原样透传；其余视为传输失败。
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `DeepSeek stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('DeepSeek request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError(`DeepSeek API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      // 中文：清理：消费方控制器中止，未正常读完则调用迭代器 return。
      consumer.abort('DeepSeek stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
          // 中文：消费方控制器已负责终止；return 时刻的 abort 不会再增加第二个结果。
        }
      }
    }
  }

  // 中文：一次线上请求的完整流程：组头 → 图片预处理 → 序列化（file 失败
  // 回退 base64）→ fetch → 非 2xx 处理（含文件 id 失效重试）→ translate。
  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: DeepSeekConnectionOptions,
    apiKey: string,
    userId: AnonymousUserId,
    attachments: AttachmentStore | undefined,
    onActivity: () => void,
  ): AsyncIterable<StreamChunk> {
    // 中文：请求头：鉴权、内容类型、SSE 接受、归属头（User-Agent）、匿名用户
    // id，以及可选的会话 id/压缩标记。
    const headers = {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      ...attributionHeaders(),
      'x-deepseek-harness-user-id': String(userId),
      ...options.sessionId !== undefined
        ? { 'x-deepseek-harness-session-id': String(options.sessionId) }
        : {},
      ...options.purpose === 'compaction'
        ? { 'x-deepseek-harness-compact': '1' }
        : {},
    }

    const fileConnection = { baseURL: connection.baseURL, apiKey }
    const model = connection.models.find(entry => entry.id === options.model)
    const policy = model === undefined ? undefined : resolveRequestImagePolicy(model)
    // 中文：先按原始字节做文件引用上限的超限卸载（数量与字节量化步长）。
    const requestMessages = policy === undefined ? options.messages : offloadRequestImagesWithPolicy(options.messages, {
      representation: 'raw',
      maxBytes: connection.maxRequestFilesBytes,
      maxImages: connection.maxImagesPerRequest,
      byteQuantum: connection.imageOffloadByteQuantum,
      countQuantum: connection.imageOffloadCountQuantum,
      byteLength: ref => Math.min(ref.bytes, policy.maxBytes),
    })
    const requestOptions = requestMessages === options.messages ? options : { ...options, messages: [...requestMessages] }
    // 中文：为每张保留图片解析请求版本（规范化后的字节与元数据）。
    const requestImages = attachments === undefined || model === undefined
      ? new Map<AttachmentId, RequestImageAttachment>()
      : await prepareRequestImages(requestOptions, attachments, model, signal)
    // 中文：表示方式从 file 开始；解析失败或 provider 拒绝时切到 base64 重试。
    let representation: 'file' | 'base64' = 'file'
    let fileAttempt = 0
    while (true) {
      const usedFiles: UsedRequestFile[] = []
      let body: WireRequest
      if (attachments === undefined) {
        // 中文：无图路径：纯文本序列化。
        body = serializeRequest(requestOptions, connection.defaults)
      } else if (representation === 'base64') {
        // 中文：base64 路径：内联 data URL，受内联字节上限约束。
        body = await serializeRequestWithImages(requestOptions, {
          representation: { kind: 'base64' },
          requestImages,
          maxRequestImageBytes: connection.maxInlineRequestImageBytes,
          maxImagesPerRequest: connection.maxImagesPerRequest,
          byteQuantum: connection.inlineImageOffloadByteQuantum,
          countQuantum: connection.imageOffloadCountQuantum,
        }, connection.defaults)
      } else {
        // 中文：file 路径：序列化时按需把图片上传为 DeepSeek 文件 id。
        try {
          body = await serializeRequestWithImages(requestOptions, {
            representation: {
              kind: 'file',
              resolveFileId: async (version, _block, location) => {
                using filesDeadline = deadline(signal, connection.filesApiTimeoutMs, FILES_API_TIMEOUT_CODE)
                let resolved: Awaited<ReturnType<DeepSeekFileStore['ensureUploaded']>>
                try {
                  resolved = await this.files.ensureUploaded(
                    version,
                    fileConnection,
                    connection.filePolicy,
                    filesDeadline.signal,
                  )
                } catch (error: unknown) {
                  // 中文：调用方取消时原样抛出；否则包装为可回退错误。
                  if (signal.aborted) throw error
                  throw new FileResolutionFailure(error)
                }
                onActivity()
                usedFiles.push({ version, fileId: resolved.record.fileId, location })
                return resolved.record.fileId
              },
            },
            requestImages,
            maxRequestImageBytes: connection.maxRequestFilesBytes,
            maxImagesPerRequest: connection.maxImagesPerRequest,
            byteQuantum: connection.imageOffloadByteQuantum,
            countQuantum: connection.imageOffloadCountQuantum,
          }, connection.defaults)
        } catch (error: unknown) {
          // 中文：文件解析失败 → 切 base64 重试（无限循环里唯一的降级出口）。
          if (!(error instanceof FileResolutionFailure)) throw error
          representation = 'base64'
          continue
        }
      }
      const payload = JSON.stringify(body)

      // TODO(http): adopt the Cordis HTTP service when shared transport configuration
      // outweighs its additional runtime dependencies.
      // 中文：TODO——当共享传输配置的收益超过其额外运行时依赖时，改用 Cordis
      // HTTP 服务。
      let response: Response
      try {
        response = await fetch(`${connection.baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: payload,
          signal,
        })
      } catch (error: unknown) {
        // 中文：fetch 层失败：取消时透传，否则归为 TRANSPORT。
        if (signal.aborted) throw error
        throw new LlmError(
          `DeepSeek API request to ${connection.baseURL} failed`,
          'TRANSPORT',
          { cause: error },
        )
      }

      if (!response.ok) {
        let message = `DeepSeek API error (HTTP ${response.status})`
        let providerError: WireError['error']
        const rawResponse = await response.text()
        try {
          const parsed = JSON.parse(rawResponse) as WireError
          providerError = parsed.error
          if (providerError?.message) message = providerError.message
        } catch {
          // The HTTP status remains authoritative when a gateway returns malformed JSON.
          // 中文：网关返回畸形 JSON 时，HTTP 状态码仍是权威依据。
        }
        const detail = [providerError?.code, providerError?.type, providerError?.message]
          .filter((field): field is string => typeof field === 'string')
          .join(' ')
        // 中文：provider 拒绝文件 id：失效映射；首次（fileAttempt===0）重试一次。
        const staleFile = usedFiles.length > 0 && providerRejectedFileId(detail)
        if (staleFile) {
          await Promise.all(staleMappings(usedFiles, detail).map(file => (
            this.files.invalidate(file.version, file.fileId, fileConnection)
          )))
          if (fileAttempt === 0) {
            fileAttempt += 1
            continue
          }
        }
        // 中文：400 且针对规范化图片字节时，给出带具体图片事实的诊断消息。
        if (response.status === 400 && usedFiles.length > 0 && providerRejectedNormalizedImage(detail)) {
          message = normalizedImageDiagnostic(usedFiles, message, detail)
        }
        const delay = providerRetryAfterMs(response.headers.get('retry-after'))
        const id = requestId(response.headers)
        throw new LlmError(message, httpErrorCode(response.status, providerError), {
          cause: new Error(rawResponse.length > 0 ? rawResponse : `DeepSeek HTTP ${response.status}`),
          status: response.status,
          ...delay === undefined ? {} : { providerRetryAfterMs: delay },
          ...id === undefined ? {} : { requestId: id },
        })
      }
      if (!response.body) {
        throw new LlmError('DeepSeek API returned no response body', 'EMPTY_RESPONSE')
      }

      // 中文：SSE 解析 + 协议翻译，逐块产出。
      yield* translate(parseSse(response.body, onActivity))
      return
    }
  }
}
