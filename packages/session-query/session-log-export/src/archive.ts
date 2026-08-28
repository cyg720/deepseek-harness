/*
 * ================================ 文件注释 ================================
 * 【文件职责】宿主侧会话日志下载：把一个会话（及其可选的全部子代理后代）的
 * 持久化日志与引用的媒体对象流式打包成 ZIP 归档，供远程客户端下载。
 * 【技术维度】基于 fflate 的流式 Zip API：每个条目分块 DEFLATE 压缩，受
 * ReadableStream 背压（高水位 64 KiB + 容量闸门）约束，宿主从不一次性持有整
 * 份归档。会话 id 经清洗后才进入归档路径，防止路径穿越。
 * 【产品维度】用户可在桌面宿主 GUI 中"导出会话"：下载的 ZIP 里每个文件与后
 * 端持久化工件逐字节一致（根日志 session.jsonl、子代理 subagents/<id>/<file>、
 * 媒体 media/<attachmentId>.<ext>），无需清单即可自描述。
 * 【逻辑维度】服务解析（sessionLogExportDeps）→ 活会话刷盘（flushLiveSessionLog）
 * → 逐条目产出（sessionLogZipEntries：根工件 + 谱系后代 + 去重媒体）→ 分块
 * 推送压缩（pushArtifactChunks / pushBinaryChunks）→ 背压容量闸门（ResponseCapacityGate）
 * → 组装流（streamSessionLogZip）。
 * 【关键边界】必须支持原始工件读取（supportsRawArtifacts）否则 501；子代理缺失
 * 时 fail-loud 报错而非静默少导出；代理对压缩级别做白名单校验（0-9）；取消与
 * 消费者取消共享一个生产者信号并终止压缩器。
 * 【新手阅读建议】从 streamSessionLogZip 入手看流的组装，再读 sessionLogZipEntries
 * 了解条目顺序，最后看两个 pushChunks 理解背压与代理对边界。
 * ==========================================================================
 */
/**
 * Host-side session-log download: streams one ZIP archive whose files are the
 * sessions' stored artifact text verbatim plus every referenced media object.
 * The root artifact sits under its original base name (`session.jsonl`); each
 * subagent descendant under `subagents/<id>/<filename>`; each image referenced
 * by any included log under `media/<attachmentId>.<ext>` (content-addressed,
 * so one archive never duplicates a shared image). No manifest is written —
 * every file is byte-identical to the backend's durable artifact or attachment
 * store and self-describing through its own header line or media type. Before
 * each live session's artifact read, the SessionStore flush barrier makes the
 * current in-memory log durable; cold sessions need no barrier. Request abort
 * and response-consumer cancellation share one producer signal and terminate
 * the active compressor.
 * Compression runs on the host with fflate's streaming Zip API, so the archive
 * bytes are produced incrementally and the host never holds the whole archive
 * in one buffer; production waits for consumer pull whenever the response queue
 * reaches its byte high-water mark, so a slow consumer bounds accumulation to
 * the fixed 64 KiB response queue plus one synchronous fflate push.
 * @module
 */

import { Zip, ZipDeflate } from 'fflate'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionLineageNode, SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence, SessionRawArtifact } from '@deepseek-ai/dsh-session-persistence'

/** Valid fflate DEFLATE levels accepted by session-log export. */
// fflate 合法的 DEFLATE 压缩级别（0 不压缩 ~ 9 最大压缩），导出时做白名单校验。
export type SessionLogCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/** Balanced default used when Session export configuration omits a compression level. */
export const DEFAULT_SESSION_LOG_COMPRESSION_LEVEL: SessionLogCompressionLevel = 6

/** The services a session-log export needs (the live-session store is optional). */
// 日志导出所需的服务集合（活会话存储可选）：查询引擎、持久化、附件存储与会话存储。
export interface SessionLogExportDeps {
  readonly sessionQuery: SessionQueryEngine | undefined
  readonly sessionPersistence: SessionPersistence | undefined
  readonly attachments: AttachmentStore | undefined
  readonly sessions: SessionStore | undefined
}

/** The export services narrowed to the mounted ones streaming actually reads. */
// 收窄后的导出服务：流式导出实际读取的已装配服务（sessions 仍可选——冷会话无需刷盘）。
export interface SessionLogExportReady {
  readonly sessionQuery: SessionQueryEngine
  readonly sessionPersistence: SessionPersistence
  readonly attachments: AttachmentStore
  readonly sessions: SessionStore | undefined
}

/**
 * Resolve the persistence, session-query, and attachment services a log export needs.
 * @param ctx - the composed host context.
 * @returns the export services (absent when the deployment does not mount them).
 */
// 从组合后的宿主 Context 解析导出所需服务（缺装配时对应字段为 undefined）。
export function sessionLogExportDeps(ctx: Context): SessionLogExportDeps {
  return {
    sessionQuery: ctx.get('sessionQuery'),
    sessionPersistence: ctx.get('sessionPersistence'),
    attachments: ctx.get('attachments'),
    sessions: ctx.get('sessions'),
  }
}

/**
 * Flush one currently live session through the store's authoritative durability
 * barrier immediately before its raw artifact is read. A cold or absent id has
 * no in-memory work to flush.
 * @param deps - export services, including the optional live-session store.
 * @param id - the session whose artifact is about to be read.
 * @param signal - optional cancellation observed around the flush barrier.
 */
// 在读取某活会话原始工件前，经存储的权威持久化屏障把内存日志刷盘；冷会话或
// 不存在的 id 没有可刷的内存工作，直接返回。
export async function flushLiveSessionLog(
  deps: Pick<SessionLogExportDeps, 'sessions'>,
  id: SessionId,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  const sessions = deps.sessions
  if (sessions === undefined) return
  const session = sessions.get(id)
  if (session === undefined) return
  await sessions.flush(session)
  signal?.throwIfAborted()
}

/** One exported file: a stored artifact text or one referenced media object. */
// 一条导出条目：要么是存储的工件文本，要么是某个被引用的媒体对象字节。
export type SessionLogZipEntry =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly data: Uint8Array }

/** Zip extension for each accepted raster media type. */
// 各类可接受光栅媒体类型对应的 zip 扩展名映射。
const MEDIA_TYPE_EXTENSIONS: Record<ImageAttachmentRef['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * The zip path for one media object: content-addressed by the opaque
 * attachment id so shared images land once and the id in the log maps back to
 * the archive entry without a manifest.
 * @param ref - the durable reference from a session log.
 * @returns the archive path.
 */
// 媒体对象在归档中的路径：按附件 id 内容寻址，共享图片只落一份，日志中的 id
// 无需清单即可映射回归档条目。
function mediaEntryPath(ref: ImageAttachmentRef): string {
  return `media/${String(ref.attachmentId)}.${MEDIA_TYPE_EXTENSIONS[ref.mediaType]}`
}

/**
 * Collect every image reference inside one content array, descending into
 * nested tool results the way the live attachment route does.
 * @param content - an event content array (or nested tool-result content).
 * @param refs - the dedupe map being filled (keyed by attachment id).
 */
// 在一个内容数组中收集全部图片引用（用显式栈做迭代式深度优先，递归下降进
// 嵌套工具结果，与实时附件路由的遍历方式一致），按附件 id 去重。
function collectImageRefs(content: unknown, refs: Map<string, ImageAttachmentRef>): void {
  if (!Array.isArray(content)) return
  const pending: unknown[] = []
  for (const item of content) pending.push(item)
  while (pending.length > 0) {
    const value = pending.pop()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown; content?: unknown }
    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
      const ref = block.attachment as ImageAttachmentRef
      refs.set(String(ref.attachmentId), ref)
    }
    if (Array.isArray(block.content)) {
      for (const item of block.content) pending.push(item)
    }
  }
}

/**
 * Collect every image reference one session event carries, across the same
 * carriers the live attachment route scans (direct content, message content,
 * inserted messages, and completed assistant chunk blocks).
 * @param event - one parsed JSONL event object.
 * @param refs - the dedupe map being filled (keyed by attachment id).
 */
// 收集单条会话事件携带的全部图片引用：覆盖实时附件路由扫描的同一批载体
// （直接 content、消息 content、插入消息、助手分块 block-end）。
function collectEventImageRefs(event: unknown, refs: Map<string, ImageAttachmentRef>): void {
  const data = (event as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return
  const carrier = data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: Array<{ content?: unknown }>
    chunk?: { type?: unknown; block?: unknown }
  }
  collectImageRefs(carrier.content, refs)
  if (carrier.message !== undefined) collectImageRefs(carrier.message.content, refs)
  if (carrier.inserted !== undefined) {
    for (const message of carrier.inserted) collectImageRefs(message.content, refs)
  }
  if (carrier.chunk?.type === 'block-end') collectImageRefs([carrier.chunk.block], refs)
}

/**
 * Collect the distinct media references one stored artifact text names.
 * Lines that fail to parse cannot reference media and are skipped (the
 * artifact text itself is exported verbatim regardless).
 * @param content - the stored artifact text.
 * @returns the dedupe map keyed by attachment id.
 */
// 收集一份工件文本点名引用的全部媒体：逐行 JSON 解析（解析失败的行不可能引用
// 媒体，跳过——工件文本本身无论何种情况都原样导出）。
function imageRefsInArtifact(content: string): Map<string, ImageAttachmentRef> {
  const refs = new Map<string, ImageAttachmentRef>()
  for (const line of content.split('\n')) {
    if (line === '') continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    collectEventImageRefs(event, refs)
  }
  return refs
}

/**
 * One safe zip path segment from an untrusted session id. Session ids are
 * host-controlled, but the brand allows any non-empty string, so `../`, dot
 * segments, and separator characters are neutralized before they can shape
 * archive entries. Distinct ids may collapse onto one segment (id collision
 * is impossible for the host-minted UUIDs, so no uniqueness suffix is kept).
 * @param id - the raw session id.
 * @returns a filesystem-safe single path segment.
 */
// 从不信任的会话 id 生成安全路径段：宿主铸造的 UUID 虽不可能包含危险字符，但
// 品牌允许任意非空字符串，因此把 ../、点段与分隔符替换掉，防止塑造归档条目。
function safeSessionIdSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * The export archive filename for one root session.
 * @param sessionId - the root session id (sanitized to one safe path segment).
 * @returns the attachment filename for the session's export archive.
 */
// 根会话导出归档的文件名：dsh-session-<sanitized-id>.zip。
export function sessionLogZipFilename(sessionId: string): string {
  return `dsh-session-${safeSessionIdSegment(sessionId)}.zip`
}

/**
 * Yield the export entries in zip order: the preloaded root artifact first,
 * then every subagent descendant in lineage order (each flushed when live,
 * read from the persistence backend right before it is yielded, and dropped
 * after the consumer moves on), then every distinct media object referenced by any of
 * the included logs (read and verified from the attachment store, one archive
 * entry per attachment id). The host holds at most one descendant's artifact
 * text and one media object at a time beyond the root.
 * @param deps - the mounted export services (the caller answered 500 before this runs).
 * @param root - the already-read root artifact (read by the caller so the
 * missing-session path can answer cleanly before streaming starts).
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param signal - optional cancellation forwarded to lineage, persistence, and attachment reads.
 * @returns the export entries in zip order.
 */
// 按 zip 顺序产出导出条目：根工件最先，然后按谱系顺序产出每个子代理后代（活的
// 先刷盘、读取后即弃，宿主最多同时持有根工件 + 一个后代工件 + 一个媒体对象），
// 最后产出全部去重后的媒体对象。
export async function* sessionLogZipEntries(
  deps: SessionLogExportReady,
  root: SessionRawArtifact,
  sessionId: SessionId,
  includeDescendants: boolean,
  signal?: AbortSignal,
): AsyncGenerator<SessionLogZipEntry> {
  const media = new Map<string, ImageAttachmentRef>()
  const rememberMedia = (content: string): void => {
    for (const [id, ref] of imageRefsInArtifact(content)) media.set(id, ref)
  }
  rememberMedia(root.content)
  yield { path: root.filename, content: root.content }
  if (includeDescendants) {
    const seen = new Set<SessionId>([sessionId])
    const collect = async function* (
      nodes: readonly SessionLineageNode[],
    ): AsyncGenerator<SessionLogZipEntry> {
      for (const node of nodes) {
        signal?.throwIfAborted()
        const id = node.session.header.id
        if (seen.has(id)) continue
        seen.add(id)
        await flushLiveSessionLog(deps, id, signal)
        const raw = await deps.sessionPersistence.readRaw(id, signal)
        signal?.throwIfAborted()
        if (raw === undefined) {
          throw new Error(`subagent "${id}" has no stored log artifact`)
        }
        rememberMedia(raw.content)
        yield {
          path: `subagents/${safeSessionIdSegment(id)}/${raw.filename}`,
          content: raw.content,
        }
        yield* collect(node.descendants)
      }
    }
    const lineage = await deps.sessionQuery.traceSession(sessionId, signal)
    signal?.throwIfAborted()
    yield* collect(lineage.descendants)
  }
  for (const ref of media.values()) {
    signal?.throwIfAborted()
    const stored = await deps.attachments.readImage(ref, signal)
    signal?.throwIfAborted()
    yield { path: mediaEntryPath(ref), data: stored.data }
  }
}

/** How many code units of artifact text one zip push carries (bounded encode memory). */
// 一次 zip 推送携带的工件文本代码单元数：限制编码内存占用。
const PUSH_CHUNK_CODE_UNITS = 1 << 16

/** How many bytes of media one zip push carries (bounded memory; images are already size-capped). */
// 一次 zip 推送携带的媒体字节数（图片本身已有大小上限，这里进一步约束内存）。
const PUSH_CHUNK_BYTES = 1 << 16

/** Byte capacity retained by the response stream before ZIP production waits for pull. */
// 响应流保留的字节容量（高水位）：达到后 ZIP 生产等待消费者拉取。
const RESPONSE_HIGH_WATER_MARK_BYTES = 1 << 16

/** One producer waiter released only when ReadableStream pull restores capacity. */
// 生产容量闸门：只有当 ReadableStream pull 恢复容量（或取消）时才释放等待中的生产者。
class ResponseCapacityGate {
  /** 当前被挂起的生产者释放回调；pull 时调用它。 */
  private releasePending: (() => void) | undefined

  /**
   * Wait until the response queue has positive byte capacity or cancellation wins.
   * @param controller - response controller whose desired size owns capacity.
   * @param signal - combined request/consumer cancellation.
   */
  // 等待响应队列出现正字节容量或取消胜出：有容量立即返回，否则挂起自己，
  // 由 pull 或取消信号唤醒（唤醒后再检查一次取消）。
  async wait(
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted()
    if (controller.desiredSize === null || controller.desiredSize > 0) return
    await new Promise<void>((resolve) => {
      const release = (): void => {
        this.releasePending = undefined
        signal.removeEventListener('abort', release)
        resolve()
      }
      this.releasePending = release
      signal.addEventListener('abort', release, { once: true })
    })
    signal.throwIfAborted()
  }

  /** Release the current producer waiter after a consumer pull. */
  // 消费者拉取后释放当前等待中的生产者。
  pulled(): void {
    this.releasePending?.()
  }
}

/**
 * Push one media object's bytes into a deflate stream in bounded chunks,
 * waiting for consumer capacity between chunks like the artifact path does.
 * @param deflate - the zip entry's deflate stream.
 * @param data - the stored image bytes.
 * @param controller - response queue controller.
 * @param capacity - pull-driven response-capacity gate.
 * @param signal - cancellation; throws when aborted.
 */
// 把媒体对象字节分块推入 deflate 流：与工件文本路径一样，块间等待消费者容量。
async function pushBinaryChunks(
  deflate: ZipDeflate,
  data: Uint8Array,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0
  do {
    signal.throwIfAborted()
    const end = Math.min(offset + PUSH_CHUNK_BYTES, data.byteLength)
    const finalChunk = end >= data.byteLength
    deflate.push(data.subarray(offset, end), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (offset < data.byteLength)
}

/**
 * Push one artifact's text into a deflate stream in bounded chunks, never
 * splitting a surrogate pair across a chunk boundary (a lone high surrogate
 * re-encodes as U+FFFD and would silently corrupt the exported artifact).
 * @param deflate - the zip entry's deflate stream.
 * @param content - the artifact text verbatim.
 * @param controller - response queue controller.
 * @param capacity - pull-driven response-capacity gate.
 * @param signal - cancellation; throws when aborted.
 */
// 把工件文本分块推入 deflate 流：块边界绝不落在代理对中间——否则孤代理高位会
// 被重编码为 U+FFFD，静默损坏导出的工件。
async function pushArtifactChunks(
  deflate: ZipDeflate,
  content: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate,
  signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder()
  let offset = 0
  let finalChunk: boolean
  do {
    signal.throwIfAborted()
    let end = Math.min(offset + PUSH_CHUNK_CODE_UNITS, content.length)
    if (end < content.length && end - offset > 1) {
      // Back off one code unit when the boundary lands inside a surrogate
      // pair: the pair then starts the next chunk whole.
      const last = content.charCodeAt(end - 1)
      if (last >= 0xd800 && last <= 0xdbff) end -= 1
    }
    finalChunk = end >= content.length
    deflate.push(encoder.encode(content.slice(offset, end)), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (!finalChunk)
}

/**
 * Stream one session-log ZIP as a WHATWG ReadableStream. The root artifact is
 * read and validated by the caller before this is called (missing root or
 * missing services answer cleanly before any byte is produced); each entry is
 * then encoded and deflated in bounded chunks as it is produced, so the
 * archive bytes arrive incrementally. A descendant that fails to read errors
 * the stream (fail-loud, never silent under-export).
 * @param deps - the mounted export services (the caller answered 500 before this runs).
 * @param root - the already-read root artifact (first zip entry).
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param compressionLevel - validated fflate DEFLATE level for every ZIP entry.
 * @param signal - request cancellation combined with response-consumer cancellation.
 * @returns the zip byte stream.
 */
// 流式产出会话日志 ZIP：根工件由调用方预先读取并校验（缺失根/缺服务在产生任何
// 字节前干净应答），随后逐条分块编码压缩；后代读取失败会让流报错（fail-loud，
// 绝不静默少导出）。消费者取消与请求取消合并为一个生产者信号，终止压缩器。
export function streamSessionLogZip(
  deps: SessionLogExportReady,
  root: SessionRawArtifact,
  sessionId: SessionId,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const consumerAbort = new AbortController()
  const producerSignal = AbortSignal.any([signal, consumerAbort.signal])
  let zip: Zip | undefined
  let zipTerminated = false
  const capacity = new ResponseCapacityGate()
  const terminateZip = (): void => {
    if (zip === undefined || zipTerminated) return
    zipTerminated = true
    zip.terminate()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // fflate invokes the callback synchronously per compressed chunk, so a
      // single push can enqueue ahead of a slow consumer; the capacity gate
      // waits for pull between pushes once the byte queue is full, bounding
      // accumulation to the queue high-water mark plus one synchronous push.
      const archive = new Zip((error, data, final) => {
        /* v8 ignore next 3 -- fflate reports only internal zip failures, unreachable for valid inputs */
        if (error) {
          controller.error(error)
          return
        }
        /* v8 ignore next -- fflate may emit empty chunks; not controllable from tests */
        if (data.byteLength > 0) controller.enqueue(data)
        if (final) controller.close()
      })
      zip = archive
      void (async () => {
        try {
          for await (const entry of sessionLogZipEntries(deps, root, sessionId, includeDescendants, producerSignal)) {
            const deflate = new ZipDeflate(entry.path, { level: compressionLevel })
            archive.add(deflate)
            if ('content' in entry) {
              await pushArtifactChunks(deflate, entry.content, controller, capacity, producerSignal)
            } else {
              await pushBinaryChunks(deflate, entry.data, controller, capacity, producerSignal)
            }
          }
          archive.end()
        } catch (error) {
          // A mid-stream failure (missing descendant, cancellation, read
          // error) must fail the download rather than ship a truncated archive.
          /* v8 ignore next -- typed backends reject with Error, and DOMException is one in Node */
          terminateZip()
          controller.error(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    },
    pull() {
      capacity.pulled()
    },
    cancel(reason) {
      consumerAbort.abort(
        reason instanceof Error ? reason : new Error('session log export stream cancelled'),
      )
      terminateZip()
    },
  }, {
    highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES,
    size: chunk => chunk.byteLength,
  })
}
