/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现 OpenAI 兼容 DeepSeek Files API 的传输客户端：上传、列出、
 * 检索、删除用户数据文件，并校验每个响应。
 * 【技术维度】直接 fetch + 表单上传（FormData/Blob）；响应字段逐一校验
 * （parseFileObject），无效响应抛 INVALID_RESPONSE；错误体解析为可分类的
 * detail 文本（配额/认证/限流判断的基础）；端点基址统一去掉尾部斜杠。
 * 【产品维度】Files API 是多模态图片（文件 id 表示）的存储后端：上传的文件
 * 带显式过期时间，配额与大小都有 provider 上限，本客户端把 provider 限制
 * 变成显式常量与前置校验。
 * 【逻辑维度】配额/大小常量 → 文件对象与分页类型 → DeepSeekFilesError 与
 * 配额判断 → 响应校验辅助 → DeepSeekFilesClient 类（request/upload/list/
 * retrieve/delete）。
 * 【关键边界】上传大小上限 128 MiB、过期窗口 3600~2592000 秒；list 分页用
 * after/limit/order；delete 响应必须回显 id 且 deleted 为 true。
 * 【新手阅读建议】先看 DeepSeekFilesError 与 isFilesQuotaError（配额恢复的
 * 判定基础），再读 request 看"非 2xx → 解析错误体 → 分类"的统一流程。
 * ==========================================================================
 */

/** OpenAI-compatible DeepSeek Files API transport. @module dsh-llm-deepseek/files-api */

import { attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { DeepSeekFileId } from './file-id.ts'
import type { DeepSeekFileId as DeepSeekFileIdType } from './file-id.ts'

/** Minimum provider-supported file lifetime. */
// 中文：provider 支持的最小文件存活期（秒）。
export const MIN_FILE_EXPIRY_SECONDS = 3_600
/** Maximum provider-supported file lifetime. */
// 中文：provider 支持的最大文件存活期（秒）。
export const MAX_FILE_EXPIRY_SECONDS = 2_592_000
/** Maximum Files API upload size. */
// 中文：Files API 上传大小上限。
export const MAX_FILE_UPLOAD_BYTES = 128 * 1024 * 1024
/** Current per-key file-count quota. */
// 中文：当前每 key 文件数量配额。
export const MAX_STORED_FILE_COUNT = 10_000
/** Current per-key storage quota. */
// 中文：当前每 key 存储配额。
export const MAX_STORED_FILE_BYTES = 25 * 1024 * 1024 * 1024

/** Validated file object returned by the OpenAI-compatible endpoint. */
/*
 * （中文）OpenAI 兼容端点返回的已校验文件对象。
 */
export interface DeepSeekFileObject {
  // 中文：provider 文件标识。
  id: DeepSeekFileIdType
  // 中文：字节数。
  bytes: number
  // 中文：创建时间（Unix 秒）。
  createdAt: number
  // 中文：文件名。
  filename: string
  // 中文：用途（固定 user_data）。
  purpose: 'user_data'
  // 中文：过期时间（可选）。
  expiresAt?: number
}

/** One page returned by `GET /files`. */
/*
 * （中文）GET /files 返回的一页。
 */
export interface DeepSeekFilePage {
  data: DeepSeekFileObject[]
  firstId?: DeepSeekFileIdType
  lastId?: DeepSeekFileIdType
  hasMore: boolean
}

/** Files API operation failure with its HTTP status retained for recovery policy. */
/*
 * （中文）Files API 操作失败，保留 HTTP 状态码供恢复策略使用。
 */
export class DeepSeekFilesError extends LlmError {
  /** Parsed provider detail used only for error classification. */
  // 中文：解析出的 provider 详情，仅供错误分类使用。
  readonly detail: string

  /*
   * （中文）构造：按状态码映射稳定 code（401/403 → AUTH、429 → RATE_LIMIT、
   * 5xx → SERVER、其余 → FILES_API）。
   * @param message 用户可读的 provider 失败信息。
   * @param status Files API 返回的 HTTP 状态码。
   * @param detail 拼接的 provider 错误字段（供分类）。
   */
  /**
   * @param message - user-readable provider failure.
   * @param status - HTTP status returned by the Files API.
   * @param detail - provider error fields joined for classification.
   */
  constructor(message: string, status: number, detail: string) {
    super(message, status === 401 || status === 403
      ? 'AUTH'
      : status === 429
        ? 'RATE_LIMIT'
        : status >= 500
          ? 'SERVER'
          : 'FILES_API', { status })
    this.name = 'DeepSeekFilesError'
    this.detail = detail
  }
}

/*
 * （中文）判断一次上传失败是否报告 provider 的存储或文件数配额。
 * @param error Files API 操作失败。
 * @returns 是否可能通过"清理一次远端 + 重试上传"恢复。
 */
/**
 * Whether an upload failure reports a provider storage or file-count quota.
 * @param error - Files API operation failure.
 * @returns whether one bounded remote cleanup and upload retry may recover.
 */
export function isFilesQuotaError(error: unknown): error is DeepSeekFilesError {
  return error instanceof DeepSeekFilesError
    && /(?:quota|storage|stored files|file count|too many files)/iu.test(error.detail)
}

// 中文：客户端构造选项（端点、key 快照、可选测试传输）。
interface FilesApiOptions {
  baseURL: string
  apiKey: string
  fetch?: typeof fetch
}

// 中文：线上文件对象字段（全部可选，便于校验）。
interface WireFileObject {
  id?: unknown
  object?: unknown
  bytes?: unknown
  created_at?: unknown
  filename?: unknown
  purpose?: unknown
  expires_at?: unknown
}

// 中文：构造"无效响应"错误。
function invalidResponse(operation: string): LlmError {
  return new LlmError(`DeepSeek Files API returned an invalid ${operation} response.`, 'INVALID_RESPONSE')
}

// 中文：校验并解析一个文件对象（id 非空、object 为 'file'、字节/时间戳为
// 非负安全整数、文件名非空、purpose 为 user_data、过期时间合法）。
function parseFileObject(value: unknown, operation: string): DeepSeekFileObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse(operation)
  const wire = value as WireFileObject
  if (typeof wire.id !== 'string' || wire.id.length === 0
    || wire.object !== 'file'
    || !Number.isSafeInteger(wire.bytes) || (wire.bytes as number) < 0
    || !Number.isSafeInteger(wire.created_at) || (wire.created_at as number) < 0
    || typeof wire.filename !== 'string' || wire.filename.length === 0
    || wire.purpose !== 'user_data'
    || (wire.expires_at !== undefined
      && (!Number.isSafeInteger(wire.expires_at) || (wire.expires_at as number) < 0))) {
    throw invalidResponse(operation)
  }
  return {
    id: DeepSeekFileId(wire.id),
    bytes: wire.bytes as number,
    createdAt: wire.created_at as number,
    filename: wire.filename,
    purpose: 'user_data',
    ...wire.expires_at === undefined ? {} : { expiresAt: wire.expires_at as number },
  }
}

// 中文：从错误响应体解析 provider 错误字段（message + 拼接的 detail）。
function providerErrorDetail(value: unknown): { message?: string; detail: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { detail: '' }
  const error = (value as { error?: unknown }).error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return { detail: '' }
  const fields = error as { message?: unknown; type?: unknown; code?: unknown }
  const message = typeof fields.message === 'string' ? fields.message : undefined
  return {
    ...message === undefined ? {} : { message },
    detail: [fields.code, fields.type, fields.message]
      .filter((field): field is string => typeof field === 'string')
      .join(' '),
  }
}

/** Direct client for the OpenAI-compatible `/files` endpoints. */
/*
 * （中文）OpenAI 兼容 /files 端点的直接客户端。
 */
export class DeepSeekFilesClient {
  // 中文：端点基址（去掉尾部斜杠）。
  private readonly baseURL: string
  // 中文：API key 快照。
  private readonly apiKey: string
  // 中文：传输实现。
  private readonly fetchImpl: typeof fetch

  /*
   * （中文）构造。
   * @param options 端点、API key 快照与可选测试传输。
   */
  /**
   * @param options - endpoint, API-key snapshot, and optional test transport.
   */
  constructor(options: FilesApiOptions) {
    this.baseURL = options.baseURL.replace(/\/+$/u, '')
    this.apiKey = options.apiKey
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  // 中文：统一请求：组头（归属头 + Bearer）→ fetch（网络失败归 TRANSPORT）
  // → 非 2xx 解析错误体并抛 DeepSeekFilesError。
  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    let response: Response
    try {
      const headers = new Headers(attributionHeaders())
      headers.set('authorization', `Bearer ${this.apiKey}`)
      response = await this.fetchImpl(`${this.baseURL}${path}`, {
        ...init,
        headers,
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw error
      throw new LlmError(`DeepSeek Files API request to ${this.baseURL} failed`, 'TRANSPORT', { cause: error })
    }
    if (response.ok) return response
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      // A status remains sufficient to report the provider failure.
      // 中文：解析失败时，仅凭状态码也足以报告 provider 失败。
    }
    const { message, detail } = providerErrorDetail(parsed)
    throw new DeepSeekFilesError(
      message ?? `DeepSeek Files API error (HTTP ${response.status})`,
      response.status,
      detail,
    )
  }

  /*
   * （中文）上传一张带显式过期时间的图片。
   * @param input 确定性请求版本字节、媒体类型、文件名、存活期与取消。
   * @returns 已校验的 provider 文件对象（含 expires_at）。
   */
  /**
   * Upload one image with an explicit expiry.
   * @param input - deterministic request-version bytes, media type, filename, lifetime, and cancellation.
   * @returns the validated provider file object, including `expires_at`.
   */
  async upload(input: {
    data: Uint8Array
    mediaType: ImageMediaType
    filename: string
    expiresAfterSeconds: number
    signal?: AbortSignal
  }): Promise<DeepSeekFileObject & { expiresAt: number }> {
    // 中文：前置校验：大小与过期窗口。
    if (input.data.byteLength > MAX_FILE_UPLOAD_BYTES) {
      throw new LlmError('DeepSeek Files API upload exceeds 128 MiB.', 'INVALID_REQUEST')
    }
    if (!Number.isSafeInteger(input.expiresAfterSeconds)
      || input.expiresAfterSeconds < MIN_FILE_EXPIRY_SECONDS
      || input.expiresAfterSeconds > MAX_FILE_EXPIRY_SECONDS) {
      throw new LlmError('DeepSeek file expiry must be between 3600 and 2592000 seconds.', 'INVALID_REQUEST')
    }
    // 中文：multipart 表单：purpose、按创建时间锚定的过期窗口、文件本体。
    const form = new FormData()
    form.set('purpose', 'user_data')
    form.set('expires_after[anchor]', 'created_at')
    form.set('expires_after[seconds]', String(input.expiresAfterSeconds))
    form.set('file', new Blob([Uint8Array.from(input.data).buffer], { type: input.mediaType }), input.filename)
    const response = await this.request('/files', { method: 'POST', body: form }, input.signal)
    const file = parseFileObject(await response.json(), 'upload')
    // 中文：上传响应必须带过期时间。
    if (file.expiresAt === undefined) throw invalidResponse('upload')
    return { ...file, expiresAt: file.expiresAt }
  }

  /*
   * （中文）列出一页升序或降序的 user-data 文件。
   * @param options 分页、排序与取消。
   * @returns 已校验的分页。
   */
  /**
   * List one ascending or descending page of user-data files.
   * @param options - pagination, ordering, and cancellation.
   * @returns the validated page.
   */
  async list(options: {
    after?: DeepSeekFileIdType
    limit?: number
    order?: 'asc' | 'desc'
    signal?: AbortSignal
  } = {}): Promise<DeepSeekFilePage> {
    const query = new URLSearchParams({ purpose: 'user_data' })
    if (options.after !== undefined) query.set('after', options.after)
    if (options.limit !== undefined) query.set('limit', String(options.limit))
    if (options.order !== undefined) query.set('order', options.order)
    const response = await this.request(`/files?${query.toString()}`, { method: 'GET' }, options.signal)
    const value = await response.json() as unknown
    // 中文：校验列表响应结构：object 为 'list'、data 为数组、has_more 为布尔。
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse('list')
    const wire = value as { object?: unknown; data?: unknown; first_id?: unknown; last_id?: unknown; has_more?: unknown }
    if (wire.object !== 'list' || !Array.isArray(wire.data) || typeof wire.has_more !== 'boolean'
      || (wire.first_id !== undefined && typeof wire.first_id !== 'string')
      || (wire.last_id !== undefined && typeof wire.last_id !== 'string')) {
      throw invalidResponse('list')
    }
    return {
      data: wire.data.map(item => parseFileObject(item, 'list')),
      ...typeof wire.first_id === 'string' ? { firstId: DeepSeekFileId(wire.first_id) } : {},
      ...typeof wire.last_id === 'string' ? { lastId: DeepSeekFileId(wire.last_id) } : {},
      hasMore: wire.has_more,
    }
  }

  /*
   * （中文）检索一个文件对象。
   * @param fileId provider 文件标识。
   * @param signal 请求取消。
   * @returns 已校验的文件对象。
   */
  /**
   * Retrieve one file object.
   * @param fileId - provider file identifier.
   * @param signal - request cancellation.
   * @returns the validated file object.
   */
  async retrieve(fileId: DeepSeekFileIdType, signal?: AbortSignal): Promise<DeepSeekFileObject> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: 'GET' }, signal)
    return parseFileObject(await response.json(), 'retrieve')
  }

  /*
   * （中文）删除一个 provider 文件。
   * @param fileId provider 文件标识。
   * @param signal 请求取消。
   */
  /**
   * Delete one provider file.
   * @param fileId - provider file identifier.
   * @param signal - request cancellation.
   */
  async delete(fileId: DeepSeekFileIdType, signal?: AbortSignal): Promise<void> {
    const response = await this.request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, signal)
    const value = await response.json() as unknown
    // 中文：删除响应必须回显 id、object 为 file 且 deleted 为 true。
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse('delete')
    const wire = value as { id?: unknown; object?: unknown; deleted?: unknown }
    if (wire.id !== fileId || wire.object !== 'file' || wire.deleted !== true) throw invalidResponse('delete')
  }
}
