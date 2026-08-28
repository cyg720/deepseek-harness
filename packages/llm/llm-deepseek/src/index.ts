/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-llm-deepseek 包的入口插件：把 DeepSeekAdapter 注册到
 * ctx.llm 的 deepseek-official 路由上，负责把插件配置/用户设置/凭据解析成
 * 每个请求的连接事实（连接信息按请求解析，而非加载时冻结）。
 * 【技术维度】配置经 schemastery schema 校验并兼作 llm-deepseek 设置段形状；
 * 通过 ctx.credentials 凭据缝合层解析 API key；连接事实快照一旦被拒绝就整体
 * 保留上一世代，杜绝"新 key 配旧端点"的组合；重试策略是唯一注册时捕获的
 * 事实，变化时用 replace 原地重注册路由。
 * 【产品维度】DeepSeek 官方入口：改 baseURL、模型目录或 key 后无需重启，
 * 下一个请求即生效；进行中的流保持其开始时的连接事实。
 * 【逻辑维度】再导出 → 常量（NS/环境变量/默认模型）→ Config 接口与 schema
 * → resolveAdapterOptions（配置→连接事实）→ apply（设置段挂接 + 注册）。
 * 【关键边界】请求无 key 时抛 MISSING_CREDENTIAL 而非加载时失败；thinking
 * 禁用时只允许 reasoningEffort 为 off；图片/文件配额、量化步长等成对校验。
 * 【新手阅读建议】先读 Config 接口（含各字段默认值），再读 resolveAdapterOptions
 * 理解"配置如何变成每请求连接事实"，最后读 apply 的注册与设置联动。
 * ==========================================================================
 */

/**
 * Register a {@link DeepSeekAdapter} for the `deepseek-official` provider route on
 * `ctx.llm`, with connection facts resolved per request instead of frozen at
 * load: the plugin layers its `cordis.yml` entry config under the optional
 * `llm-deepseek` user-settings section (`ctx.settings`) and resolves the API
 * key through the optional credential seam (`ctx.credentials`), so a changed
 * base URL, catalog, or key reaches the very next request without restarting
 * anything, while an in-flight stream keeps the facts it started with. The
 * one registration-captured fact — the retry policy — re-registers the route
 * in place when it changes.
 * @module @deepseek-ai/dsh-llm-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ModelModality, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from './adapter.ts'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './adapter.ts'
import {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
} from './request-pricing.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_FILE_EXPIRY_SECONDS,
  DEFAULT_FILE_QUOTA_CLEANUP_BATCH,
  DEFAULT_FILE_REFRESH_MARGIN_SECONDS,
  DEFAULT_FILES_API_TIMEOUT_MS,
  DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM,
  DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM,
  DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DeepSeekAdapter,
} from './adapter.ts'
export type { DeepSeekAdapterOptions, DeepSeekCatalogModel, DeepSeekConnectionOptions } from './adapter.ts'
export {
  DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET,
  DEFAULT_MAX_IMAGES_PER_REQUEST,
  DEFAULT_MAX_REQUEST_FILES_BYTES,
  DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
  deepSeekImageRequestPricing,
  resolveRequestImagePolicy,
} from './request-pricing.ts'
export { deepSeekImageTokens } from './image-tokens.ts'
export { DeepSeekFileStore, MAX_CHAT_IMAGE_BYTES } from './file-store.ts'
export type { DeepSeekFileConnection, DeepSeekFilePolicy, DeepSeekFileReference } from './file-store.ts'
export { DeepSeekFilesClient, MAX_FILE_EXPIRY_SECONDS, MAX_FILE_UPLOAD_BYTES, MAX_STORED_FILE_BYTES, MAX_STORED_FILE_COUNT, MIN_FILE_EXPIRY_SECONDS } from './files-api.ts'
export type { DeepSeekFileObject, DeepSeekFilePage } from './files-api.ts'
export { DeepSeekFileId } from './file-id.ts'
export type { DeepSeekFileId as DeepSeekFileIdType } from './file-id.ts'
export { DeepSeekUploadIndex, deepSeekFileScope } from './upload-index.ts'
export type { DeepSeekUploadRecord } from './upload-index.ts'
export type { RequestDefaults } from './serialize.ts'
export type * from './types.ts'

export const name = 'llm-deepseek'
export const inject = ['llm']

// 中文：本插件拥有的用户设置命名空间（llm-deepseek）。
const NS = settingsNamespace('llm-deepseek')
// 中文：API key 的默认环境变量名（DEEPSEEK_API_KEY）。
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** The single provider route this plugin owns. */
// 中文：本插件拥有的唯一 provider 路由（deepseek-official）。
const PROVIDER = 'deepseek-official'

// 中文：默认建议模型目录：V4 Flash、V4 Pro 与一个带图像能力的视觉实验模型
// （视觉模型带像素预算与字节上限）。
const DEFAULT_MODELS: DeepSeekCatalogModel[] = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4-Flash',
    description: 'Fast, efficient, and economical; suited to focused, routine, or parallel tasks.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek-V4-Flash-Vision-Exp',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: ['text', 'image'],
    imagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    imageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
  },
]

// 中文：本 provider 支持的输入模态词汇表（text、image），用于 schema 校验。
const MODEL_MODALITIES = ['text', 'image'] as const satisfies readonly ModelModality[]

/*
 * （中文）插件配置：由同名 schemastery schema 校验，并兼作 llm-deepseek
 * 设置段的结构。yml 中每个字段都可选：key 缺失时按 Config.apiKeyEnv 在每次
 * 请求时解析（完全没有 key 的请求抛 MISSING_CREDENTIAL，而不是在插件加载时
 * 失败）；省略 thinking 模式使用 provider 默认；省略推理强度解析为 high。
 */
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-deepseek` settings-section shape. Every field is optional in
 * yml: a missing API key resolves through {@link Config.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `DEEPSEEK_API_KEY`. */
  // 中文：每请求解析的凭据引用（环境变量名）；默认 DEEPSEEK_API_KEY。
  apiKeyEnv?: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  // 中文：端点基址；依次回退到可信环境层的 $DEEPSEEK_BASE_URL、再回退公共 API。
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  // 中文：部署级思考策略；disabled 把所有对话请求限制为 off。
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  // 中文：默认推理强度（默认 high）；off 表示每请求关闭思考。
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  // 中文：默认每请求输出上限（默认 256000）；模型自有上限与请求显式值优先。
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  // 中文：所选模型无精确值时的正上下文容量（默认 1000000）。
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash, V4 Pro, and V4 Flash Vision Exp. */
  // 中文：发现消费者看到的建议模型；默认 V4 Flash、V4 Pro 与 V4 Flash Vision Exp。
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  // 中文：一次流读取挂起时 provider 的最大空闲时间（默认五分钟）。
  streamIdleTimeoutMs?: number
  /** Maximum accumulated file-referenced image bytes per chat request (default 128 MiB). */
  // 中文：每个对话请求累计的"文件引用图片"字节上限（默认 128 MiB）。
  maxRequestFilesBytes?: number
  /** Maximum accumulated base64 image payload after Files API fallback (default 20 MiB). */
  // 中文：Files API 回退后累计 base64 图片载荷上限（默认 20 MiB）。
  maxInlineRequestImageBytes?: number
  /** Maximum number of represented images per chat request (default 600). */
  // 中文：每个对话请求可表示的图片数量上限（默认 600）。
  maxImagesPerRequest?: number
  /** Raw-byte removal step after the request exceeds its file bound (default 64 MiB). */
  // 中文：请求超过文件字节上限后的原始字节移除步长（默认 64 MiB）。
  imageOffloadByteQuantum?: number
  /** Base64-byte removal step after inline fallback exceeds its bound (default 10 MiB). */
  // 中文：内联回退超限后的 base64 字节移除步长（默认 10 MiB）。
  inlineImageOffloadByteQuantum?: number
  /** Image-count removal step after the request exceeds its count bound (default 20). */
  // 中文：请求超过图片数量上限后的数量移除步长（默认 20）。
  imageOffloadCountQuantum?: number
  /** Maximum duration of one request-image Files API resolution (default one minute). */
  // 中文：单次请求图片的 Files API 解析最大耗时（默认一分钟）。
  filesApiTimeoutMs?: number
  /** Explicit lifetime assigned to each uploaded image (default seven days). */
  // 中文：分配给每张上传图片的显式存活期（默认七天）。
  fileExpiresAfterSeconds?: number
  /** Remaining lifetime below which an indexed file is replaced (default one hour). */
  // 中文：剩余存活期低于该值时替换已索引文件（默认一小时）。
  fileRefreshMarginSeconds?: number
  /** Oldest harness-owned files deleted before one quota-recovery upload retry (default 100). */
  // 中文：一次配额恢复重试前删除的最旧 harness 自有文件数（默认 100）。
  fileQuotaCleanupBatch?: number
  /** Provider-owned model-request retry policy; omission uses normal mode with five retries. */
  // 中文：provider 自有的模型请求重试策略；省略时用 normal 模式、重试 5 次。
  retryPolicy?: RetryPolicyConfig
}

// 中文：目录模型条目的 schemastery schema（供 Config.models 校验）。
const catalogModel: z<DeepSeekCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
  imagePixelBudget: z.union([z.number().step(1).min(1), 'low']),
  imageMaxBytes: z.number().step(1).min(1),
})

// 中文：插件配置 schema：逐字段校验并补默认，与 Config 接口同名。
export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'low', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestFilesBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_FILES_BYTES),
  maxInlineRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES),
  maxImagesPerRequest: z.number().step(1).min(1).default(DEFAULT_MAX_IMAGES_PER_REQUEST),
  imageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM),
  inlineImageOffloadByteQuantum: z.number().step(1).min(1).default(DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM),
  imageOffloadCountQuantum: z.number().step(1).min(1).default(DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM),
  filesApiTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_FILES_API_TIMEOUT_MS),
  fileExpiresAfterSeconds: z.number().step(1).min(3_600).max(2_592_000).default(DEFAULT_FILE_EXPIRY_SECONDS),
  fileRefreshMarginSeconds: z.number().step(1).min(0).default(DEFAULT_FILE_REFRESH_MARGIN_SECONDS),
  fileQuotaCleanupBatch: z.number().step(1).min(1).max(1_000).default(DEFAULT_FILE_QUOTA_CLEANUP_BATCH),
  retryPolicy: RetryPolicySchema,
})

/** Public API default; the internal endpoint comes from $DEEPSEEK_BASE_URL. */
// 中文：公共 API 默认端点；内部端点来自 $DEEPSEEK_BASE_URL。
export const PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Environment variable naming this provider's endpoint, honored only from trusted layers. */
// 中文：命名本 provider 端点的环境变量；只从可信环境层读取。
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

/*
 * （中文）一次解析的完整请求事实。连接与凭据事实刻意做成同一个值：被拒绝的
 * 解析快照会整体保留上一世代，因此请求永远不可能把过期端点与新 key 配对。
 */
/**
 * One resolution's complete request facts. Connection and credential facts
 * are one value on purpose: a snapshot the resolver rejects keeps the whole
 * previous generation, so a request can never pair a stale endpoint with a
 * newer key.
 */
export type ResolvedDeepSeekOptions = DeepSeekConnectionOptions

/** Resolve, validate, and detach the advisory model catalog. */
// 中文：解析、校验并剥离建议性模型目录：逐条校验字段（非空 id、合法模态、
// 图片限制只允许图像模型声明、id 去重），剥离出干净副本。
function resolveModels(models: readonly DeepSeekCatalogModel[] | undefined): DeepSeekCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (Object.hasOwn(model, 'imageDetail')) {
      throw new Error('llm-deepseek: catalog model imageDetail is no longer supported; use imagePixelBudget')
    }
    if (model.id.length === 0) throw new Error('llm-deepseek: catalog model ids must be non-empty')
    if (model.name !== undefined && model.name.length === 0) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow !== undefined
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-deepseek: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens !== undefined
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-deepseek: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    const inputModalities = model.inputModalities ?? ['text']
    if (inputModalities.length === 0) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" inputModalities must not be empty`)
    }
    if (inputModalities.some(modality => !MODEL_MODALITIES.includes(modality))) {
      throw new Error(
        `llm-deepseek: catalog model "${model.id}" inputModalities must contain only "text" and "image"`,
      )
    }
    if (new Set(inputModalities).size !== inputModalities.length) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" inputModalities must not contain duplicates`)
    }
    const hasImage = inputModalities.includes('image')
    if (!hasImage && (model.imagePixelBudget !== undefined || model.imageMaxBytes !== undefined)) {
      throw new Error(`llm-deepseek: text-only catalog model "${model.id}" cannot declare image request limits`)
    }
    if (model.imagePixelBudget !== undefined
      && model.imagePixelBudget !== 'low'
      && (!Number.isSafeInteger(model.imagePixelBudget) || model.imagePixelBudget <= 0)) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" imagePixelBudget must be "low" or a positive safe integer`)
    }
    if (model.imageMaxBytes !== undefined
      && (!Number.isSafeInteger(model.imageMaxBytes) || model.imageMaxBytes <= 0)) {
      throw new Error(`llm-deepseek: catalog model "${model.id}" imageMaxBytes must be a positive safe integer`)
    }
    if (seen.has(model.id)) throw new Error(`llm-deepseek: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name === undefined ? {} : { name: model.name },
      ...model.description === undefined ? {} : { description: model.description },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      inputModalities: [...inputModalities],
      // 中文：图像模型补默认像素预算（low 细节用低预算）与字节上限。
      ...hasImage
        ? {
          imagePixelBudget: model.imagePixelBudget === 'low'
            ? DEFAULT_LOW_DETAIL_IMAGE_PIXEL_BUDGET
            : model.imagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
          imageMaxBytes: model.imageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
        }
        : {},
    }
  })
}

/*
 * （中文）从原始配置到已验证连接事实的唯一显式解析步骤。编程式构造可能绕过
 * Schemastery 规范化，因此每个默认值与边界都在这里重新判定——加载时（fail
 * loud）与每个设置快照首次使用时都会走这里。
 * @param config 原始插件配置或已解析的设置快照。
 * @param environment 本次运行的环境层；产品 CLI 之外为 undefined。每个层
 *   都可能提供端点：产品信任其启动所在的项目，因此一个 checkout 可以让它的
 *   agent 指向该 checkout 应使用的网关。
 * @returns 已验证的连接事实，加上凭据引用。
 */
/**
 * The one explicit resolve step from raw config to validated connection
 * facts. Programmatic construction may bypass Schemastery normalization, so
 * every default and bound is re-judged here — for the composition entry at
 * load (fail loud) and for each settings snapshot at its first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. Every layer may supply an endpoint: the product trusts the
 * project it is launched in, so a checkout can point its own agent at the
 * gateway that checkout is meant to use.
 * @returns validated connection facts plus the credential reference.
 */
export function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedDeepSeekOptions {
  // 中文：thinking 禁用时只允许推理强度为 off（否则抛错，fail loud）。
  if (config.thinking === 'disabled'
    && config.reasoningEffort !== undefined
    && config.reasoningEffort !== 'off') {
    throw new Error('llm-deepseek: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-deepseek: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-deepseek: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-deepseek: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const maxRequestFilesBytes = config.maxRequestFilesBytes ?? DEFAULT_MAX_REQUEST_FILES_BYTES
  if (!Number.isSafeInteger(maxRequestFilesBytes) || maxRequestFilesBytes <= 0) {
    throw new Error('llm-deepseek: maxRequestFilesBytes must be a positive safe integer')
  }
  const maxInlineRequestImageBytes = config.maxInlineRequestImageBytes ?? DEFAULT_MAX_INLINE_REQUEST_IMAGE_BYTES
  if (!Number.isSafeInteger(maxInlineRequestImageBytes) || maxInlineRequestImageBytes <= 0) {
    throw new Error('llm-deepseek: maxInlineRequestImageBytes must be a positive safe integer')
  }
  const maxImagesPerRequest = config.maxImagesPerRequest ?? DEFAULT_MAX_IMAGES_PER_REQUEST
  if (!Number.isSafeInteger(maxImagesPerRequest) || maxImagesPerRequest <= 0) {
    throw new Error('llm-deepseek: maxImagesPerRequest must be a positive safe integer')
  }
  const imageOffloadByteQuantum = config.imageOffloadByteQuantum ?? DEFAULT_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(imageOffloadByteQuantum) || imageOffloadByteQuantum <= 0) {
    throw new Error('llm-deepseek: imageOffloadByteQuantum must be a positive safe integer')
  }
  // 中文：量化步长不得大于对应上限（否则一步移除就会超额）。
  if (imageOffloadByteQuantum > maxRequestFilesBytes) {
    throw new Error('llm-deepseek: imageOffloadByteQuantum must not exceed maxRequestFilesBytes')
  }
  const inlineImageOffloadByteQuantum = config.inlineImageOffloadByteQuantum
    ?? DEFAULT_INLINE_IMAGE_OFFLOAD_BYTE_QUANTUM
  if (!Number.isSafeInteger(inlineImageOffloadByteQuantum) || inlineImageOffloadByteQuantum <= 0) {
    throw new Error('llm-deepseek: inlineImageOffloadByteQuantum must be a positive safe integer')
  }
  if (inlineImageOffloadByteQuantum > maxInlineRequestImageBytes) {
    throw new Error('llm-deepseek: inlineImageOffloadByteQuantum must not exceed maxInlineRequestImageBytes')
  }
  const imageOffloadCountQuantum = config.imageOffloadCountQuantum ?? DEFAULT_IMAGE_OFFLOAD_COUNT_QUANTUM
  if (!Number.isSafeInteger(imageOffloadCountQuantum) || imageOffloadCountQuantum <= 0) {
    throw new Error('llm-deepseek: imageOffloadCountQuantum must be a positive safe integer')
  }
  if (imageOffloadCountQuantum > maxImagesPerRequest) {
    throw new Error('llm-deepseek: imageOffloadCountQuantum must not exceed maxImagesPerRequest')
  }
  const filesApiTimeoutMs = config.filesApiTimeoutMs ?? DEFAULT_FILES_API_TIMEOUT_MS
  if (!Number.isFinite(filesApiTimeoutMs)
    || filesApiTimeoutMs <= 0
    || filesApiTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-deepseek: filesApiTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const fileExpiresAfterSeconds = config.fileExpiresAfterSeconds ?? DEFAULT_FILE_EXPIRY_SECONDS
  if (!Number.isSafeInteger(fileExpiresAfterSeconds)
    || fileExpiresAfterSeconds < 3_600
    || fileExpiresAfterSeconds > 2_592_000) {
    throw new Error('llm-deepseek: fileExpiresAfterSeconds must be an integer from 3600 through 2592000')
  }
  const fileRefreshMarginSeconds = config.fileRefreshMarginSeconds ?? DEFAULT_FILE_REFRESH_MARGIN_SECONDS
  if (!Number.isSafeInteger(fileRefreshMarginSeconds)
    || fileRefreshMarginSeconds < 0
    || fileRefreshMarginSeconds >= fileExpiresAfterSeconds) {
    throw new Error('llm-deepseek: fileRefreshMarginSeconds must be a non-negative integer below fileExpiresAfterSeconds')
  }
  const fileQuotaCleanupBatch = config.fileQuotaCleanupBatch ?? DEFAULT_FILE_QUOTA_CLEANUP_BATCH
  if (!Number.isSafeInteger(fileQuotaCleanupBatch)
    || fileQuotaCleanupBatch < 1
    || fileQuotaCleanupBatch > 1_000) {
    throw new Error('llm-deepseek: fileQuotaCleanupBatch must be an integer from 1 through 1000')
  }
  return {
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    // 中文：端点优先级：显式配置 > 可信环境层 $DEEPSEEK_BASE_URL > 公共 API。
    baseURL: config.baseURL
      ?? environment?.get(BASE_URL_ENV)?.value
      ?? PUBLIC_BASE_URL,
    defaults: {
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    maxRequestFilesBytes,
    maxInlineRequestImageBytes,
    maxImagesPerRequest,
    imageOffloadByteQuantum,
    inlineImageOffloadByteQuantum,
    imageOffloadCountQuantum,
    filesApiTimeoutMs,
    filePolicy: {
      expiresAfterSeconds: fileExpiresAfterSeconds,
      refreshMarginSeconds: fileRefreshMarginSeconds,
      quotaCleanupBatch: fileQuotaCleanupBatch,
    },
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-deepseek: retryPolicy'),
  }
}

// 中文：插件入口：组合静态配置与动态设置段，按需解析连接事实，注册适配器。
export function apply(ctx: Context, config: Config): void {
  // 中文：设置段挂接后 current 被替换为"读取当前设置快照"的源函数。
  let current: () => Config = () => config
  // 中文：最近一次读取的原始配置（用于缓存判定）。
  let lastRaw: Config | undefined
  // 中文：最近一次成功解析的连接事实（坏快照时继续服务它）。
  let lastGood: ResolvedDeepSeekOptions | undefined
  // 中文：惰性解析：原始配置未变则复用上次结果；快照违反 schema 之外的边界
  // 时保留 lastGood 并记一次错误日志。
  const options = (): ResolvedDeepSeekOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      // 中文：静态组合在任何注册之前就已解析，因此该分支只会看到"活动设置快照
      // 违反 schema 之外边界"的情况：继续服务上次的好事实，并对每个坏快照
      // 报一次错。
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-deepseek: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood
    }
  }
  // 中文：启动时先解析一次，让配置错误在加载期暴露（fail loud）。
  options()

  // 中文：每请求解析 API key：凭据缝合层命中即用；无缝合层时把可信环境层
  // 当作整个凭据平面；都没有则抛 MISSING_CREDENTIAL。
  const resolveApiKey = async (connection: ResolvedDeepSeekOptions): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    // 中文：每个凭据事实都来自调用方的快照，因此被拒绝的设置世代不可能把
    // 它的 key 泄漏到上一个端点上。
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-deepseek', ref)
    } else {
      // Without the seam there is no managed store to rank against, so the
      // environment is the whole credential plane.
      // 中文：没有缝合层就没有可排序的管理存储，此时环境就是整个凭据平面。
      const ambient = launchEnvironmentOf(ctx).get(ref)
      if (ambient !== undefined && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, 'llm-deepseek', ref)
      }
    }
    throw new LlmError(
      `llm-deepseek: no API key for provider route "${PROVIDER}"; store ${ref} through the credentials`
      + ` service (the web Models page writes it), or export ${ref} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  // 中文：进程内匿名用户 id（惰性创建一次并缓存）。
  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()
  const adapter = new DeepSeekAdapter({
    options,
    resolveApiKey,
    resolveUserId,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    prepareExtensions: (request) => {
      const extensions = ctx.get('deepseekLlmApiExtensions')
      return extensions?.prepare(request)
        ?? Promise.resolve({ fields: {}, accept: () => Promise.resolve() })
    },
  })
  // 中文：把 deepseek-official 声明为可配置 provider（设置界面可见）。
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'DeepSeek', settingsNs: NS, settingsPath: [] },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  // 中文：路由效应通过稳定的 ctx 引用绑定到本 apply fiber，即使替换发生在
  // 下面作用域化的设置回调里也成立。
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  // 中文：注册时捕获的重试策略；变化时需重注册路由。
  let registeredPolicy = options().retryPolicy
  // 中文：设置变化回调：重试策略变了就用 replace 原地重注册（同步区段，
  // 观察者看不到"空路由"中间态）。
  const ensureRegistrationFacts = (): void => {
    const policy = options().retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    // 中文：注册表在注册时捕获重试策略，它是"按请求解析无法刷新"的唯一事实。
    // replace 在单个同步注册区段内重读它：改用"销毁再注册"会在两步之间发布
    // 空路由集，观察者会看到 provider 消失又出现。
    registration.replace([PROVIDER])
    registeredPolicy = policy
  }

  // 中文：挂接用户设置段：setSource 让 current 指向设置快照读取器，onChange
  // 在设置变化时刷新注册事实。
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
