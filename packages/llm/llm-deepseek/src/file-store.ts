/**
 * ================================ 文件注释 ================================
 * 【文件职责】实现 DeepSeek Files API 的"上传复用、失效与配额恢复"存储：
 * DeepSeekFileStore 把确定性的请求图片版本映射到可复用的 provider 文件 id。
 * 【技术维度】以"端点+API key"的 SHA-256 摘要作为命名空间，以变体 id（完整
 * 请求变换身份）为键做本地持久化索引（DeepSeekUploadIndex）；并发调用共享
 * 同一次上传（SharedUpload），各自保留独立等待与取消；上传遇配额错误时先
 * 删除最旧的 harness 自有文件（文件名以 dsh- 前缀标识）再重试一次。
 * 【产品维度】同一张图片在多次对话里被反复引用，文件 id 复用避免重复上传、
 * 降低配额消耗；provider 拒绝旧 id 时能精确失效并按需清理，保证多模态对话
 * 长期可用。
 * 【逻辑维度】常量与类型 → 共享上传状态与等待辅助 → 命名/扩展名辅助 →
 * DeepSeekFileStore 类（ensureUploaded/invalidate/release/回收/清空）。
 * 【关键边界】单图上限 32 MiB（MAX_CHAT_IMAGE_BYTES）；上传字节数必须与
 * 提交一致；索引提交失败（他人抢先）时清理重复上传；非 Error 取消原因会被
 * 包装。
 * 【新手阅读建议】先读 ensureUploaded 理解"并发共享 + 索引命中"两条路径，
 * 再看 ensureUploadedOnce 里的配额恢复分支。
 * ==========================================================================
 */

/** DeepSeek Files API upload reuse, invalidation, and quota recovery. @module dsh-llm-deepseek/file-store */

import type { RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DeepSeekFilesClient, isFilesQuotaError } from './files-api.ts'
import type { DeepSeekFileId } from './file-id.ts'
import { deepSeekFileScope, DeepSeekUploadIndex } from './upload-index.ts'
import type { DeepSeekUploadRecord } from './upload-index.ts'

/** DeepSeek chat accepts at most 32 MiB per image even when it is referenced by file id. */
// 中文：DeepSeek chat 即使按文件 id 引用，单张图片也最多接受 32 MiB。
export const MAX_CHAT_IMAGE_BYTES = 32 * 1024 * 1024
// 中文：harness 自有上传文件的文件名前缀（配额恢复时据此识别可删除文件）。
const OWNED_FILE_PREFIX = 'dsh-'

/** Resolved file-store policy from the plugin configuration. */
/**
 * （中文）来自插件配置的文件存储策略（已解析）。
 */
export interface DeepSeekFilePolicy {
  // 中文：上传文件的存活期（秒）。
  expiresAfterSeconds: number
  // 中文：剩余存活期低于该值就不复用映射（提前刷新）。
  refreshMarginSeconds: number
  // 中文：配额恢复时一次删除的最旧自有文件数。
  quotaCleanupBatch: number
}

/** Connection facts needed by file operations. */
// 中文：文件操作所需的连接事实（端点与 API key 快照）。
export interface DeepSeekFileConnection {
  baseURL: string
  apiKey: string
}

/** Result of one file-id resolution. */
/**
 * （中文）一次文件 id 解析的结果：可复用记录 + 是否新上传。
 */
export interface DeepSeekFileReference {
  record: DeepSeekUploadRecord
  uploaded: boolean
}

// 中文：构造选项（可测试的索引/时钟/传输边界）。
interface FileStoreOptions {
  index?: DeepSeekUploadIndex
  now?: () => number
  fetch?: typeof fetch
}

// 中文：一次共享上传：所有等待者共用的 AbortController 与 promise，以及
// 等待者计数（最后一个等待者取消且上传未结算时中止共享传输）。
interface SharedUpload {
  controller: AbortController
  promise: Promise<DeepSeekFileReference>
  settled: boolean
  waiters: number
}

// 中文：把取消信号转成 Error（非 Error 原因包装成带 cause 的 Error）。
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  return reason instanceof Error
    ? reason
    : new Error('DeepSeek file upload cancelled with a non-Error reason.', { cause: reason })
}

// 中文：把上传失败包装成 Error（非 Error 原因包装成带 cause 的 Error）。
function uploadFailure(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('DeepSeek file upload failed with a non-Error reason.', { cause: error })
}

// 中文：等待一次共享上传：登记等待者；调用方取消时释放等待者，若自己是最后
// 一个且上传未结算，则中止共享传输；无信号时只做等待者记账。
function waitForUpload(operation: SharedUpload, signal: AbortSignal | undefined): Promise<DeepSeekFileReference> {
  signal?.throwIfAborted()
  operation.waiters += 1
  let released = false
  const release = (cancelledReason?: Error): void => {
    if (released) return
    released = true
    operation.waiters -= 1
    if (cancelledReason !== undefined && operation.waiters === 0 && !operation.settled) {
      operation.controller.abort(cancelledReason)
    }
  }
  if (signal === undefined) {
    return operation.promise.finally(() => {
      release()
    })
  }
  return new Promise<DeepSeekFileReference>((resolve, reject) => {
    const abort = (): void => {
      const reason = abortReason(signal)
      release(reason)
      reject(reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    void operation.promise.then((value) => {
      signal.removeEventListener('abort', abort)
      release()
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      release()
      reject(uploadFailure(error))
    })
  })
}

// 中文：媒体类型 → 文件扩展名。
function extension(mediaType: RequestImageAttachment['mediaType']): 'png' | 'jpeg' | 'webp' | 'gif' {
  switch (mediaType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpeg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
  }
}

// 中文：为请求版本生成确定性文件名（dsh- 前缀 + 附件摘要 + 变体摘要 + 扩展名）。
function filename(version: RequestImageAttachment): string {
  const attachment = String(version.attachment.attachmentId).slice('sha256:'.length, 'sha256:'.length + 16)
  const variant = String(version.variantId).slice('sha256:'.length, 'sha256:'.length + 8)
  return `${OWNED_FILE_PREFIX}${attachment}-${variant}.${extension(version.mediaType)}`
}

/** User-scoped durable file-id reuse for the DeepSeek route. */
/**
 * （中文）DeepSeek 路由的"用户作用域持久文件 id 复用"存储。
 */
export class DeepSeekFileStore {
  // 中文：持久上传索引（跨进程共享，落盘在 DSH 主目录）。
  private readonly index: DeepSeekUploadIndex
  // 中文：时钟（默认 Date.now，测试可注入）。
  private readonly now: () => number
  // 中文：传输实现（默认全局 fetch，测试可注入）。
  private readonly fetchImpl: typeof fetch | undefined
  // 中文：进行中的共享上传（键为 scope+变体 id）。
  private readonly inflight = new Map<string, SharedUpload>()

  /**
   * （中文）构造。
   * @param options 可测试的索引、时钟与传输边界。
   */
  /**
   * @param options - testable index, clock, and transport boundaries.
   */
  constructor(options: FileStoreOptions = {}) {
    this.index = options.index ?? new DeepSeekUploadIndex()
    this.now = options.now ?? Date.now
    this.fetchImpl = options.fetch
  }

  // 中文：按连接快照构建一次性的 Files API 客户端。
  private client(connection: DeepSeekFileConnection): DeepSeekFilesClient {
    return new DeepSeekFilesClient({
      baseURL: connection.baseURL,
      apiKey: connection.apiKey,
      ...this.fetchImpl === undefined ? {} : { fetch: this.fetchImpl },
    })
  }

  /**
   * （中文）解析或上传一张确定性请求图片。并发调用共享同一次上传，各自保留
   * 独立的等待。
   * @param version 确定性的模型请求字节与完整变换身份。
   * @param connection 端点与 API key 快照。
   * @param policy 过期与配额恢复策略。
   * @param signal 本次等待的取消；没有等待者时共享传输停止。
   * @returns 可复用的文件 id，以及本次调用是否发布了新上传。
   */
  /**
   * Resolve or upload one deterministic request image. Concurrent calls share one upload while retaining independent waits.
   * @param version - deterministic model-request bytes and complete transformation identity.
   * @param connection - endpoint and API-key snapshot.
   * @param policy - expiry and quota-recovery policy.
   * @param signal - cancellation of this wait; shared transport stops when no waiter remains.
   * @returns a reusable file id and whether this call published a new upload.
   */
  ensureUploaded(
    version: RequestImageAttachment,
    connection: DeepSeekFileConnection,
    policy: DeepSeekFilePolicy,
    signal?: AbortSignal,
  ): Promise<DeepSeekFileReference> {
    signal?.throwIfAborted()
    const scope = deepSeekFileScope(connection.baseURL, connection.apiKey)
    const key = `${scope}\0${version.variantId}`
    let active = this.inflight.get(key)
    // 中文：已中止的共享上传直接丢弃，允许重开。
    if (active?.controller.signal.aborted) {
      this.inflight.delete(key)
      active = undefined
    }
    if (active !== undefined) return waitForUpload(active, signal)
    const controller = new AbortController()
    const shared: SharedUpload = {
      controller,
      settled: false,
      waiters: 0,
      promise: undefined as never,
    }
    shared.promise = this.ensureUploadedOnce(version, connection, policy, controller.signal).then((value) => {
      shared.settled = true
      return value
    }, (error: unknown) => {
      shared.settled = true
      throw uploadFailure(error)
    })
    this.inflight.set(key, shared)
    // 中文：上传结算后从进行中集合移除（若仍指向自己）。
    void shared.promise.finally(() => {
      if (this.inflight.get(key) === shared) this.inflight.delete(key)
    }).catch(() => {})
    return waitForUpload(shared, signal)
  }

  // 中文：单次实际上传：单图大小校验 → 索引命中复用 → 上传 → 配额恢复重试
  // → 索引提交（他人抢先则删除重复上传）。
  private async ensureUploadedOnce(
    version: RequestImageAttachment,
    connection: DeepSeekFileConnection,
    policy: DeepSeekFilePolicy,
    signal: AbortSignal,
  ): Promise<DeepSeekFileReference> {
    if (version.bytes > MAX_CHAT_IMAGE_BYTES) {
      throw new LlmError('DeepSeek chat image exceeds the 32 MiB per-image limit.', 'INVALID_REQUEST')
    }
    const scope = deepSeekFileScope(connection.baseURL, connection.apiKey)
    const now = this.now()
    const marginMs = policy.refreshMarginSeconds * 1_000
    // 中文：索引命中且剩余存活期足够 → 直接复用（不新上传）。
    const cached = await this.index.get(scope, version.variantId, now, marginMs)
    if (cached !== undefined) return { record: cached, uploaded: false }

    const client = this.client(connection)
    const upload = async (): Promise<DeepSeekUploadRecord> => {
      const remote = await client.upload({
        data: version.data,
        mediaType: version.mediaType,
        filename: filename(version),
        expiresAfterSeconds: policy.expiresAfterSeconds,
        signal,
      })
      if (remote.bytes !== version.data.byteLength) {
        throw new LlmError('DeepSeek Files API upload response does not match the submitted image.', 'INVALID_RESPONSE')
      }
      return {
        scope,
        attachmentId: version.attachment.attachmentId,
        variantId: version.variantId,
        fileId: remote.id,
        bytes: remote.bytes,
        createdAt: remote.createdAt * 1_000,
        expiresAt: remote.expiresAt * 1_000,
      }
    }

    let candidate: DeepSeekUploadRecord
    try {
      candidate = await upload()
    } catch (error: unknown) {
      // 中文：配额错误：先回收最旧自有文件腾出空间，删除成功则重试一次上传。
      if (!isFilesQuotaError(error)) throw error
      const deleted = await this.reclaimOldestOwned(connection, policy.quotaCleanupBatch, signal)
      if (deleted === 0) throw error
      candidate = await upload()
    }
    const committed = await this.index.commit(candidate, this.now(), marginMs)
    if (!committed.accepted) {
      // 中文：他人抢先提交了可复用映射：删除自己刚上传的重复文件。
      try {
        await client.delete(candidate.fileId, signal)
      } catch {
        // The winning mapping is durable. A failed duplicate cleanup affects quota only and is retried by recovery.
        // 中文：获胜映射是持久的。失败的重复清理只影响配额，会由回收机制重试。
      }
    }
    return { record: committed.record, uploaded: committed.accepted }
  }

  /**
   * （中文）在 chat 端点拒绝其远端 id 后，失效一条精确的本地映射。
   * @param version 远端世代失败的请求图片版本。
   * @param fileId 被拒绝的精确文件 id。
   * @param connection 端点与 API key 快照。
   */
  /**
   * Invalidate one exact local mapping after the chat endpoint rejects its remote id.
   * @param version - request-image version whose remote generation failed.
   * @param fileId - exact rejected file id.
   * @param connection - endpoint and API-key snapshot.
   */
  async invalidate(
    version: RequestImageAttachment,
    fileId: DeepSeekFileId,
    connection: DeepSeekFileConnection,
  ): Promise<void> {
    await this.index.remove(
      deepSeekFileScope(connection.baseURL, connection.apiKey),
      version.variantId,
      fileId,
    )
  }

  /**
   * （中文）删除某附件的已索引远端文件并移除本地映射。
   * @param version 要释放的精确请求图片版本。
   * @param connection 端点与 API key 快照。
   * @param policy 用于定位可复用映射的过期策略。
   * @param signal 请求取消。
   * @returns 是否存在已索引文件并被删除。
   */
  /**
   * Delete the indexed remote file for one attachment and remove its local mapping.
   * @param version - exact request-image version to release.
   * @param connection - endpoint and API-key snapshot.
   * @param policy - expiry policy used to locate a reusable mapping.
   * @param signal - request cancellation.
   * @returns whether an indexed file existed and was deleted.
   */
  async release(
    version: RequestImageAttachment,
    connection: DeepSeekFileConnection,
    policy: DeepSeekFilePolicy,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const scope = deepSeekFileScope(connection.baseURL, connection.apiKey)
    const record = await this.index.get(
      scope,
      version.variantId,
      this.now(),
      policy.refreshMarginSeconds * 1_000,
    )
    if (record === undefined) return false
    await this.client(connection).delete(record.fileId, signal)
    await this.index.remove(scope, version.variantId, record.fileId)
    return true
  }

  /**
   * （中文）删除文件名标识为 harness 自有的最旧 provider 文件。
   * @param connection 端点与 API key 快照。
   * @param count 要删除的正数文件数上限。
   * @param signal 请求取消。
   * @returns 成功删除的文件数。
   */
  /**
   * Delete the oldest provider files whose names identify harness ownership.
   * @param connection - endpoint and API-key snapshot.
   * @param count - positive maximum number of files to delete.
   * @param signal - request cancellation.
   * @returns number of successfully deleted files.
   */
  async reclaimOldestOwned(
    connection: DeepSeekFileConnection,
    count: number,
    signal?: AbortSignal,
  ): Promise<number> {
    const client = this.client(connection)
    let after: DeepSeekFileId | undefined
    const owned: DeepSeekFileId[] = []
    // 中文：分页遍历（升序 = 最旧在前），只收集 dsh- 前缀的 owned 文件。
    while (owned.length < count) {
      const page = await client.list({
        ...after === undefined ? {} : { after },
        limit: 1_000,
        order: 'asc',
        ...signal === undefined ? {} : { signal },
      })
      for (const file of page.data) {
        if (!file.filename.startsWith(OWNED_FILE_PREFIX)) continue
        owned.push(file.id)
        if (owned.length === count) break
      }
      if (!page.hasMore || page.lastId === undefined || page.lastId === after) break
      after = page.lastId
    }
    for (const fileId of owned) await client.delete(fileId, signal)
    return owned.length
  }

  /**
   * （中文）删除活跃 API key 命名空间里的每个远端 harness 自有文件并清空索引。
   * @param connection 端点与 API key 快照。
   * @param signal 请求取消。
   * @returns 删除的文件数。
   */
  /**
   * Delete every remote harness-owned file in the active API-key namespace and clear its index.
   * @param connection - endpoint and API-key snapshot.
   * @param signal - request cancellation.
   * @returns number of deleted files.
   */
  async releaseAll(connection: DeepSeekFileConnection, signal?: AbortSignal): Promise<number> {
    let total = 0
    // 中文：分页清空：每次回收一批，直到某批不足整页。
    for (;;) {
      const deleted = await this.reclaimOldestOwned(connection, 1_000, signal)
      total += deleted
      if (deleted < 1_000) break
    }
    await this.index.clear(deepSeekFileScope(connection.baseURL, connection.apiKey))
    return total
  }
}
