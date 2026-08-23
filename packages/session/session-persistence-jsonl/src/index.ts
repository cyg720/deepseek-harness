/**
 * ================================ 文件注释 ================================
 * 【文件职责】JSONL 持久化后端：把每个会话存成磁盘上"一个目录 + 一个追加式文件"，
 *   文件第一行是头记录、其后是逐条事件行；实现 SessionPersistence 服务接口并实现
 *   PersistenceBackend 存储原语，读写编排全部委托给 PersistenceCoordinator。
 * 【技术维度】每会话一个 JSONL 工件；物理编码可选 zstd 帧（默认，带校验和）或明文；
 *   原子物化 = 临时文件 fsync + link/MoveFileEx 发布（POSIX 用 link 防 EEXIST 竞态，
 *   Windows 用写透移动）；stat(dev,ino,size,mtimeNs,ctimeNs) 派生修订号；残尾帧
 *   可截断修复并抢救出已完整的事件。
 * 【产品维度】会话历史以人类可导航的 目录结构 落盘（按项目分组），崩溃后可无损
 *   恢复；zstd 压缩显著减小长会话日志体积。
 * 【逻辑维度】按代码顺序：①配置 Schema 与压缩选择；②修订号/ENOENT 小助手；
 *   ③JsonlSessionPersistence 类——服务方法转发、后端钩子（loadStored/
 *   readStoredRevision/readRaw/appendBatch/commitRepair/list/listSnapshots）、
 *   物化与追加的文件力学（materialize*、appendLines、rollbackAppend、repair）、
 *   发现助手（findLog/首行读取/编码一致性检查）。
 * 【关键边界】root 必填且解析一次（cwd 变化不漂移）；同一 root 内两种物理编码
 *   不允许混存（发现即报错）；append 部分写入失败要回滚到原尺寸防重复 seq；
 *   列举只读头信息，成本与会话数而非日志长度相关。
 * 【新手阅读建议】先读类注释与 Config，再顺着 loadStored→readPrefix→readZstdPrefix
 *   看读路径、materialize→appendLines→commitRepair 看写路径；format.ts 与 zstd.ts
 *   是被本文件调用的底层工具。
 * ==========================================================================
 */
/**
 * JSONL durable session-persistence backend. It stores a header and contiguous
 * events in one append-only file per session, and delegates orchestration to
 * {@link PersistenceCoordinator}. Its side-effect-free locator returns the
 * absolute per-session log target before materialization.
 * @module @deepseek-ai/dsh-session-persistence-jsonl
 */
/**
 * 【中文导读】上面英文概括本模块：JSONL 落盘后端——每会话一个追加文件，头与事件
 * 同存；编排交给协调器；定位器无副作用，物化前就能给出绝对路径。
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readdirSync } from 'node:fs'
import { open, mkdir, readFile, readdir, realpath, link, rm, stat, truncate } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { scheduler } from 'node:timers/promises'
import { randomBytes } from 'node:crypto'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE, DEFAULT_WRITE_BATCH_MAX_DELAY_MS, MAX_WRITE_BATCH_DELAY_MS,
  SessionPersistence, SessionPersistenceRevision, PersistenceCoordinator, SessionFormatUnsupportedError,
  type PersistenceBackend, type SessionLocation, type SessionPersistenceSnapshot,
  type SessionInspection, type SessionPersistenceRevision as PersistenceRevision, type SessionRawArtifact,
  type StoredPrefix,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionId, SessionHeader, SessionPreparation } from '@deepseek-ai/dsh-session'
import {
  encodeSegment, eventLines, logPath, logSuffix, parseHeaderMeta, projectDir, scanLog, sessionDir,
  SessionLogScanner, toHeaderLine,
  type JsonlCompression,
} from './format.ts'
import {
  compressZstdFrame, createZstdFrameDecoder, decompressZstdFrame, decompressZstdPrefix, scanZstdFrames,
} from './zstd.ts'
import { ensureDurableDirectoryWin32, publishNewFileWin32 } from './win32.ts'

export type { JsonlCompression } from './format.ts'

/** 【中文】是否把连续的 assistant/chunk 增量事件打包成存储行（默认开，约省 60% 体积）。 */
const DEFAULT_PACK_CHUNKS = true
/** 【中文】默认物理编码：带校验和的 zstd 帧。 */
const DEFAULT_COMPRESSION: JsonlCompression = 'zstd'
/**
 * Internal scheduling constant, not deployment configuration: balance
 * frame-boundary event-loop yields against `setImmediate` overhead. One frame
 * remains an indivisible synchronous decode.
 */
/**
 * 【中文】内部调度常量（非部署配置）：解码大日志时每隔约 500ms 让出一次事件循环，
 * 在"帧边界让出"与"setImmediate 开销"间取平衡；单帧内部仍是不可分割的同步解码。
 */
const ZSTD_DECODE_YIELD_INTERVAL_MS = 500

/** Assert that the independently decodable first frame contains only the header record. */
/**
 * 【中文】校验第一帧解压后恰好是一行头记录（以换行结尾且只有一行）。第一帧独立
 * 可解是"列举只读头"优化的前提。
 * @param plaintext - 第一帧的明文。
 */
function assertZstdHeaderFrame(plaintext: Buffer): void {
  if (plaintext.length === 0 || plaintext.indexOf(0x0A) !== plaintext.length - 1) {
    throw new Error('corrupt Zstandard session log: first frame is not exactly one header line')
  }
}

/** Loader schema for the JSONL artifact's physical encoding. */
/**
 * 【中文】加载器配置 Schema：JSONL 工件的物理编码取 'zstd' 或 'none'，默认 zstd。
 */
export const JsonlCompressionSchema: z<JsonlCompression> = z.union([
  z.const('zstd'),
  z.const('none'),
]).default(DEFAULT_COMPRESSION)

/** Plugin config: where the JSONL backend keeps its session logs, and the packed-row write switch. */
/**
 * 【中文】插件配置：会话日志存放在哪、以及写打包行的开关等。
 */
export interface Config {
  /**
   * Root directory for all session files. Required (no default): a default of
   * `process.cwd()` would scatter session files as the process's cwd changes
   * (bash calls, subprocesses). Sessions group under human-readable project
   * directories, then per-session directories. An existing root must be a
   * readable directory; an absent root is created on first materialization.
   */
  root: string
  /**
   * Write runs of consecutive `assistant/chunk` delta events as packed
   * `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows (lossless,
   * ~60% smaller logs measured on a real session). Defaults to true; false
   * keeps one `SessionEvent` per line for diagnostics. Reading packed rows is
   * unconditional: a log's layout never depends on this switch.
   */
  packChunks?: boolean
  /** Physical encoding; defaults to checksummed Zstandard frames. */
  compression?: JsonlCompression
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/** Opaque coordinator token for replacing bytes recovered from a torn frame. */
/**
 * 【中文】JSONL 后端专属的残尾修复令牌（对协调器 opaque）：truncateTo 是应截断到的
 * 字节偏移（残帧起点）；recoveredEvents 是从残帧里抢救出的、已完整可解析的事件，
 * 截断后需要原样补写回去。
 */
interface JsonlTornMarker {
  truncateTo: number
  recoveredEvents: SessionEvent[]
}

/**
 * 【中文】文件 stat 元组：设备号、inode、大小与纳秒级修改/变更时间——拼成修订号，
 * 内容一变至少一项必变。
 */
interface FileRevisionIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

/** Build the source-qualified revision shared by full and lightweight reads. */
/**
 * 【中文】把文件身份五元组拼成"来源限定"的修订号字符串。全量读（readStableFile）与
 * 轻量读（readStoredRevision/listSnapshots）共用同一构造，保证两者可比较。
 * @param identity - stat 得到的文件身份。
 * @returns 品牌化的持久化修订号。
 */
function fileRevision(identity: FileRevisionIdentity): PersistenceRevision {
  return SessionPersistenceRevision([
    identity.dev,
    identity.ino,
    identity.size,
    identity.mtimeNs,
    identity.ctimeNs,
  ].join(':'))
}

/** Whether a filesystem error means absence; every non-ENOENT failure must surface. */
/**
 * 【中文】判断一个文件系统错误是否表示"目标不存在"（ENOENT）。只有 ENOENT 才能被
 * 当作"没有"；权限、IO 等其他错误必须向上抛出，绝不能伪装成"不存在"。
 * @param error - 待判断的错误。
 * @returns 是 ENOENT 返回 true。
 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/**
 * The JSONL persistence backend. Load as a plugin; it registers as
 * `ctx.sessionPersistence` and (via the coordinator) installs the write-path
 * listeners. Its torn-tail marker carries the byte offset and any events
 * recovered from an incomplete final Zstandard frame.
 */
/**
 * 【中文】JSONL 持久化后端本体：作为插件加载后注册为 ctx.sessionPersistence，
 * 并（经协调器）安装写路径监听。它同时实现两个角色：
 * - SessionPersistence（服务面）：对外 API；
 * - PersistenceBackend<JsonlTornMarker>（存储面）：文件字节的存取原语。
 * 残尾标记携带字节偏移与从残帧抢救出的事件。
 */
export class JsonlSessionPersistence extends SessionPersistence implements PersistenceBackend<JsonlTornMarker> {
  /** 【中文】JSONL 每会话一个文件，天然支持原样工件读取。 */
  override readonly supportsRawArtifacts = true

  /** 【中文】Cordis 依赖声明：需要 sessions 服务来构建未发布 Session。 */
  static inject = ['sessions']

  static Config: z<Config> = z.object({
    root: z.string().required(),
    packChunks: z.boolean().default(DEFAULT_PACK_CHUNKS),
    compression: JsonlCompressionSchema,
    preparedSessionCacheSize: z.number().step(1).min(1).default(DEFAULT_PREPARED_SESSION_CACHE_SIZE),
    writeBatchMaxDelayMs: z.number().step(1).min(1).max(MAX_WRITE_BATCH_DELAY_MS)
      .default(DEFAULT_WRITE_BATCH_MAX_DELAY_MS),
  })

  /**
   * Backend label for coordinator diagnostics and effects. It shadows
   * `Service.name` without changing the service key captured by the base
   * constructor.
   */
  /**
   * 【中文】后端显示名，用于协调器诊断与 effect 命名。它遮蔽了 Service.name，
   * 但不改变基类构造时捕获的服务键（仍是 sessionPersistence）。
   */
  override readonly name = 'session-persistence-jsonl'

  /** 【中文】解析后的会话根目录（绝对路径）。 */
  private root: string
  /** 【中文】是否把增量 chunk 事件打包成存储行写入。 */
  private packChunks: boolean
  /** 【中文】本后端的物理编码（zstd / none），整个 root 内必须一致。 */
  private compression: JsonlCompression
  /** 【中文】共享的读写编排器（缓冲、串行化、修复都在它那里）。 */
  private coordinator: PersistenceCoordinator<JsonlTornMarker>
  /** 【中文】root 编码一致性检查的缓存 Promise：整个生命周期只查一次。 */
  private rootEncodingCheck: Promise<void> | undefined

  /**
   * 【中文】构造后端：解析 root、补默认值、校验根目录可用，并创建协调器
   * （协调器构造时会安装写路径监听）。
   * @param ctx - Cordis 上下文。
   * @param config - 插件配置（root 必填）。
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Resolve once so later process.cwd() changes cannot split one backend across roots.
    // 一次性解析为绝对路径：之后 process.cwd() 再变化也不会把一个后端劈到两个根下。
    this.root = resolve(config.root)
    // Programmatic wrappers may construct the backend without Schemastery normalization.
    // 编程式包装可能绕过 Schemastery 归一化直接构造，这里补齐默认值。
    const preparedSessionCacheSize = config.preparedSessionCacheSize
      ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE
    const writeBatchMaxDelayMs = config.writeBatchMaxDelayMs
      ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS
    this.packChunks = config.packChunks ?? DEFAULT_PACK_CHUNKS
    this.compression = config.compression ?? DEFAULT_COMPRESSION
    this.assertUsableRoot()
    this.coordinator = new PersistenceCoordinator<JsonlTornMarker>(this.ctx, this, {
      preparedSessionCacheSize,
      writeBatchMaxDelayMs,
    })
  }

  // Each backend keeps the typed service API beside its storage hooks;
  // extracting these trivial forwards would add an inheritance layer.
  /* jscpd:ignore-start */
  // --- SessionPersistence service API (delegated to the coordinator) ---

  /** Resolve the absolute target path without touching the filesystem. */
  locate(meta: SessionHeader): SessionLocation {
    return { kind: 'jsonl', path: logPath(this.root, meta.cwd, meta.id, this.compression) }
  }

  create(meta: SessionHeader): Promise<void> {
    return this.coordinator.create(meta)
  }

  append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    return this.coordinator.append(id, events)
  }

  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    return this.coordinator.prepare(id, signal)
  }

  load(id: SessionId): Promise<SessionInspection> {
    return this.coordinator.load(id)
  }

  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    return this.coordinator.inspect(id, signal)
  }

  // JSONL is sequential media: no loadStoredFrom hook, so the coordinator
  // parses the stored prefix (both encodings) and skips forward to fromSeq.
  // JSONL 是顺序介质：不提供 loadStoredFrom 寻址钩子，协调器会解析完整前缀
  //（两种编码都一样）再前跳到 fromSeq。
  readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }

  // One method serves both public `list` and the backend hook; delegating it to
  // the coordinator would call this hook recursively.
  // list 同时充当公共 API 与后端钩子：若委托给协调器，钩子会递归调用自身。

  /* jscpd:ignore-end */
  // --- PersistenceBackend hooks (the file-bytes storage primitives) ---
  // --- PersistenceBackend 钩子（文件字节级的存取原语） ---

  /** Read a stored prefix by id across all project directories when cwd is unknown. */
  /**
   * 【中文】后端钩子：按 id 读"已存前缀"。cwd 未知时扫描所有项目目录找日志；
   * 找不到返回 undefined。找到则进入 readPrefix 做解析与残尾识别。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   * @returns 已存前缀（含修订号与残尾标记）；不存在为 undefined。
   */
  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<JsonlTornMarker> | undefined> {
    signal?.throwIfAborted()
    await this.ensureRootEncoding()
    signal?.throwIfAborted()
    const path = await this.findLog(id, signal)
    if (path === undefined) return undefined
    return this.readPrefix(path, id, signal)
  }

  /**
   * Read one log's stat-derived revision without loading its event bytes.
   * Resolving an id with unknown cwd still scans the project directories.
   */
  /**
   * 【中文】后端钩子：只 stat 日志文件派生修订号，不加载事件字节。cwd 未知的
   * id 仍要扫描项目目录定位文件。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   * @returns 当前修订号；会话不存在为 undefined。
   */
  async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<PersistenceRevision | undefined> {
    signal?.throwIfAborted()
    await this.ensureRootEncoding()
    signal?.throwIfAborted()
    const path = await this.findLog(id, signal)
    if (path === undefined) return undefined
    try {
      const identity = await stat(path, { bigint: true })
      signal?.throwIfAborted()
      return fileRevision(identity)
    } catch (error: unknown) {
      signal?.throwIfAborted()
      if (isENOENT(error)) return undefined
      throw error
    }
  }

  /**
   * Read a session's stored artifact text verbatim: the durable file bytes
   * decoded from this backend's physical encoding (complete zstd frames
   * concatenated, or UTF-8 plaintext). The content is the exact JSONL text the
   * backend wrote — never a reconstruction from parsed events — so packed-
   * chunk rows, key order, and line breaks survive byte-for-byte. A torn
   * final frame is omitted, matching the committed-prefix semantics of every
   * other read.
   * @param id - the persisted session to read.
   * @param signal - optional cancellation for the stat/read/decode work.
   * @returns the raw artifact text plus the header parsed from its own first
   * line, or `undefined` when the session has no stored artifact.
   */
  /**
   * 【中文】原样读取会话工件：返回后端写下的确切 JSONL 文本（zstd 已解压拼接，
   * 或 UTF-8 明文）——绝不是由解析后的事件重新拼装。打包行、键顺序、换行都
   * 逐字节保留；残尾帧被省略，与其他读法的"已提交前缀"语义一致。
   * @param id - 要读的已持久化会话 id。
   * @param signal - stat/读/解码期间的可选取消信号。
   * @returns 原文与其首行解析出的头；无工件为 undefined。
   */
  override async readRaw(id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined> {
    signal?.throwIfAborted()
    await this.ensureRootEncoding()
    signal?.throwIfAborted()
    const path = await this.findLog(id, signal)
    if (path === undefined) return undefined
    // 在修订号稳定的窗口内读文件，防止读到并发追加产生的撕裂字节。
    const { buffer } = await this.readStableFile(path, signal)
    let content: string
    if (this.compression === 'zstd') {
      const { frames } = scanZstdFrames(buffer)
      if (frames.length === 0) throw new Error('empty or header-less Zstandard session log')
      const decoder = createZstdFrameDecoder()
      const plaintexts: Buffer[] = []
      // The decoder yields views into a reused buffer; copy each frame's
      // plaintext immediately so a later concat cannot read overwritten memory.
      // 解码器产出的是复用缓冲上的视图：必须立刻拷贝每帧明文，
      // 否则后面的 concat 会读到被覆盖的内存。
      for (const plaintext of decoder.decode(buffer, frames)) {
        signal?.throwIfAborted()
        plaintexts.push(Buffer.from(plaintext))
      }
      content = Buffer.concat(plaintexts).toString('utf8')
    } else {
      content = buffer.toString('utf8')
    }
    const meta = parseHeaderMeta(content.split('\n', 1)[0] as string)
    if (meta === undefined || meta.id !== id) {
      throw new Error(`corrupt session log: invalid header line in "${path}"`)
    }
    // The logical artifact name is `session.jsonl` regardless of the physical
    // encoding suffix (`.jsonl.zstd` marks compression only).
    // 逻辑文件名固定为 session.jsonl：.jsonl.zstd 后缀只是物理编码标记。
    return { meta, filename: 'session.jsonl', content }
  }

  /**
   * Read a file's bytes under a revision-stable loop: a writer appending
   * between stat and readFile would yield a torn physical file, so retry
   * while the stat revision changes.
   * @param path - the artifact file to read.
   * @param signal - optional cancellation for the stat/read work.
   * @returns the stable bytes and the revision that matched both stats.
   */
  /**
   * 【中文】修订号稳定循环读：stat → 读 → 再 stat，两次 stat 的修订号一致才返回。
   * 若写者在 stat 与 readFile 之间追加过，字节会撕裂——此时重试整个循环。
   * @param path - 要读的工件文件路径。
   * @param signal - 可选取消信号。
   * @returns 稳定的字节缓冲与前后一致的修订号。
   */
  private async readStableFile(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ buffer: Buffer; revision: PersistenceRevision }> {
    for (;;) {
      signal?.throwIfAborted()
      const before = fileRevision(await stat(path, { bigint: true }))
      const buffer = await readFile(path, { signal })
      signal?.throwIfAborted()
      const after = fileRevision(await stat(path, { bigint: true }))
      if (before === after) return { buffer, revision: after }
    }
  }

  /**
   * Read a stored prefix and convert torn-tail state to the opaque marker the
   * coordinator can round-trip without knowing the physical encoding.
   */
  /**
   * 【中文】读取已存前缀并把"残尾状态"翻译成协调器可往返的不透明标记：
   * zstd 走 readZstdPrefix；明文走 scanLog（committedBytes < 文件长度即有残行）。
   * 解析期发现的格式拒绝若缺路径，在这里补上本工件的位置。
   * @param path - 日志文件路径。
   * @param expectedId - 期望的会话 id（可选校验）。
   * @param signal - 可选取消信号。
   * @returns 前缀 + 修订号（+ 残尾标记，若有）。
   */
  private async readPrefix(
    path: string,
    expectedId?: SessionId,
    signal?: AbortSignal,
  ): Promise<StoredPrefix<JsonlTornMarker>> {
    const { buffer, revision } = await this.readStableFile(path, signal)
    let prefix: Omit<StoredPrefix<JsonlTornMarker>, 'revision'>
    try {
      if (this.compression === 'zstd') {
        prefix = await this.readZstdPrefix(buffer, signal)
      } else {
        signal?.throwIfAborted()
        const { meta, events, committedBytes } = scanLog(buffer)
        signal?.throwIfAborted()
        prefix = {
          meta,
          events,
          ...committedBytes < buffer.byteLength
            ? { tornMarker: { truncateTo: committedBytes, recoveredEvents: [] } }
            : {},
        }
      }
    } catch (error: unknown) {
      // A parse-time format refusal predates any SessionHeader, so the
      // coordinator's locate-based enrichment cannot run; attach the artifact
      // this read actually refused.
      // 解析期的格式拒绝发生在拿到 SessionHeader 之前，协调器基于 locate 的
      // 补全帮不上忙：这里直接附上本次读取所拒绝的工件路径。
      if (error instanceof SessionFormatUnsupportedError && error.location === undefined) {
        throw new SessionFormatUnsupportedError(`${error.message} (raw log: ${path})`, { kind: 'jsonl', path })
      }
      throw error
    }
    signal?.throwIfAborted()
    await this.assertStoredIdentity(path, prefix.meta, expectedId, signal)
    signal?.throwIfAborted()
    return { ...prefix, revision }
  }

  /** Decode complete frames and retain complete JSONL records from a torn final frame. */
  /**
   * 【中文】zstd 读路径：扫描帧 → 解码首帧并校验"恰好一行头"→ 逐帧喂给
   * SessionLogScanner（定期让出事件循环防卡死）→ checkpoint 确认完整帧内没有
   * 撕裂行。无残尾直接 finish；有残尾则尽力解压残帧前缀、把抢救出的完整事件
   * 记入 tornMarker（截断点 = 残帧起点）。
   * @param buffer - 整个日志文件的字节。
   * @param signal - 可选取消信号。
   * @returns 前缀结构（不含修订号）。
   */
  private async readZstdPrefix(
    buffer: Buffer,
    signal?: AbortSignal,
  ): Promise<Omit<StoredPrefix<JsonlTornMarker>, 'revision'>> {
    signal?.throwIfAborted()
    const { frames, tornStart } = scanZstdFrames(buffer)
    signal?.throwIfAborted()
    if (frames.length === 0) throw new Error('empty or header-less Zstandard session log')

    const decoder = createZstdFrameDecoder()
    let yieldDeadline = performance.now() + ZSTD_DECODE_YIELD_INTERVAL_MS
    try {
      const decodedFrames = decoder.decode(buffer, frames)
      signal?.throwIfAborted()
      const headerFrame = decodedFrames.next()
      signal?.throwIfAborted()
      /* v8 ignore next -- a non-empty structural frame list makes the decoder yield its first frame or throw. */
      if (headerFrame.done) throw new Error('empty or header-less Zstandard session log')
      assertZstdHeaderFrame(headerFrame.value)
      const scanner = new SessionLogScanner(headerFrame.value)

      let remainingFrames = frames.length - 1
      for (const plaintext of decodedFrames) {
        signal?.throwIfAborted()
        scanner.write(plaintext)
        remainingFrames -= 1
        if (remainingFrames > 0 && performance.now() >= yieldDeadline) {
          await scheduler.yield()
          signal?.throwIfAborted()
          yieldDeadline = performance.now() + ZSTD_DECODE_YIELD_INTERVAL_MS
        }
      }
      signal?.throwIfAborted()
      // checkpoint：记录完整帧消化后的字节/事件游标，用于后续识别抢救事件。
      const complete = scanner.checkpoint()
      if (complete.committedBytes !== complete.inputBytes) {
        throw new Error('corrupt Zstandard session log: complete frame contains a torn JSONL record')
      }
      if (tornStart === undefined) {
        const prefix = scanner.finish()
        return { meta: prefix.meta, events: prefix.events }
      }

      // 有残尾帧：尽力解压残帧可用前缀；解不出明文也不影响此前完整帧的可恢复性。
      let recoveredPlaintext: Buffer = Buffer.alloc(0)
      try {
        signal?.throwIfAborted()
        recoveredPlaintext = await decompressZstdPrefix(buffer.subarray(tornStart))
      } catch {
        /* v8 ignore next -- decoder failure plus concurrent abort is timing-dependent */
        if (signal?.aborted) signal.throwIfAborted()
        // A structurally incomplete final frame may end before Node's decoder can
        // emit any plaintext; the complete prior frames remain recoverable.
      }
      signal?.throwIfAborted()
      scanner.write(recoveredPlaintext)
      const recoveredPrefix = scanner.finish()
      signal?.throwIfAborted()
      return {
        meta: recoveredPrefix.meta,
        events: recoveredPrefix.events,
        tornMarker: {
          // 截断到残帧起点；checkpoint 之后新解析出的完整事件即"抢救事件"。
          truncateTo: tornStart,
          recoveredEvents: recoveredPrefix.events.slice(complete.eventCount),
        },
      }
    } catch (error) {
      /* v8 ignore next -- decoder failure plus concurrent abort is timing-dependent */
      if (signal?.aborted) signal.throwIfAborted()
      throw error
    } finally {
      // 无论成败都要释放解码器持有的原生资源。
      decoder.close()
    }
  }

  /** Durably append a batch, lazily materializing the file when not yet present. */
  /**
   * 【中文】后端钩子：把一批连续事件持久化。文件尚不存在时走 materialize
   * （头 + 首批原子发布）；已存在则直接追加行并 fsync。
   * @param meta - 会话头。
   * @param events - 连续事件批。
   * @param isMaterialized - 是否已有持久化文件。
   */
  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void> {
    await this.ensureRootEncoding()
    if (isMaterialized) {
      await this.appendLines(meta, events)
    } else {
      await this.materialize(meta, events)
    }
  }

  /**
   * Make a crash repair durable: truncate a torn tail, restore complete events
   * decoded from it, then append synthetic closers. Two fsync'd steps — the seam
   * does not require this to be atomic.
   */
  /**
   * 【中文】把崩溃修复落盘：先截断残尾，再补写"从残尾抢救出的事件 + 协调器给的
   * 合成收尾"。两步各自 fsync——契约不要求这两步原子。
   * @param meta - 会话头。
   * @param tornMarker - 残尾标记（无则跳过截断）。
   * @param closers - 合成收尾事件。
   */
  async commitRepair(
    meta: SessionHeader,
    tornMarker: JsonlTornMarker | undefined,
    closers: readonly SessionEvent[],
  ): Promise<void> {
    if (tornMarker !== undefined) await this.repair(meta, tornMarker.truncateTo)
    const repairedEvents = [...(tornMarker?.recoveredEvents ?? []), ...closers]
    if (repairedEvents.length > 0) await this.appendLines(meta, repairedEvents)
  }

  /** List valid unique stored sessions' metadata (header line only — no full-log parse). */
  /**
   * 【中文】列举所有有效且不重复的已存会话元数据：只读各自头行，不解析整份日志。
   * @param signal - 可选取消信号。
   * @returns 每个会话一条头信息。
   */
  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    return (await this.listArtifacts(signal)).map(artifact => artifact.header)
  }

  /** List metadata plus a stat-derived identity for each append-only log. */
  /**
   * 【中文】在 list 基础上为每份追加日志附上 stat 派生的修订号。stat 期间文件
   * 恰好消失（ENOENT）则跳过该条；其他错误照常上抛。
   * @param signal - 可选取消信号。
   * @returns {头信息, 修订号} 快照列表。
   */
  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    const snapshots: SessionPersistenceSnapshot[] = []
    for (const artifact of await this.listArtifacts(signal)) {
      signal?.throwIfAborted()
      try {
        const identity = await stat(artifact.path, { bigint: true })
        signal?.throwIfAborted()
        snapshots.push({
          header: artifact.header,
          revision: fileRevision(identity),
        })
      } catch (error: unknown) {
        signal?.throwIfAborted()
        // 列举与删除竞争时 ENOENT 视为"刚被移除"，跳过即可。
        if (!isENOENT(error)) throw error
      }
    }
    signal?.throwIfAborted()
    return snapshots
  }

  /**
   * 【中文】列举助手：遍历 项目目录 → 会话目录，检查"对面编码的工件是否存在"
   *（存在即编码混存错误），只读头行解析元数据，校验存储身份并拒绝跨目录重复 id。
   * 成本随会话数量伸缩，与日志长度无关。
   * @param signal - 可选取消信号。
   * @returns {头信息, 路径} 列表。
   */
  private async listArtifacts(signal?: AbortSignal): Promise<Array<{ header: SessionHeader; path: string }>> {
    signal?.throwIfAborted()
    await this.ensureRootEncoding()
    signal?.throwIfAborted()
    const artifacts: Array<{ header: SessionHeader; path: string }> = []
    const ids = new Set<SessionId>()
    for (const project of await this.listProjectDirs(signal)) {
      signal?.throwIfAborted()
      for (const dir of await this.listSessionDirs(project, signal)) {
        signal?.throwIfAborted()
        const opposite = join(dir, `session${logSuffix(this.oppositeCompression())}`)
        const oppositeExists = await this.exists(opposite)
        signal?.throwIfAborted()
        if (oppositeExists) throw this.encodingMismatch(opposite)
        const path = join(dir, `session${logSuffix(this.compression)}`)
        const pathExists = await this.exists(path)
        signal?.throwIfAborted()
        if (!pathExists) continue
        // Read only headers so listing scales with session count, not log size.
        const first = this.compression === 'zstd'
          ? await this.readFirstZstdLine(path, signal)
          : await this.readFirstLine(path, signal)
        signal?.throwIfAborted()
        if (first === undefined) continue // empty/half-written file
        const meta = parseHeaderMeta(first)
        if (meta === undefined) continue // not a session header
        await this.assertStoredIdentity(path, meta, undefined, signal)
        signal?.throwIfAborted()
        if (ids.has(meta.id)) {
          throw new Error(`duplicate JSONL session id "${meta.id}" appears in multiple project directories`)
        }
        ids.add(meta.id)
        artifacts.push({ header: meta, path })
      }
    }
    signal?.throwIfAborted()
    return artifacts
  }

  // --- materialization / append / repair (file mechanics) ---
  // --- 物化 / 追加 / 修复（文件力学） ---

  /** Atomically write the header line + first batch (temp-write, fsync, publish). */
  /**
   * 【中文】原子物化：写"头行 + 首批事件"。先拒绝对面编码的既有工件，编码内容
   * 后按平台分派：Windows 用 Win32 写透发布，POSIX 用 link 发布。头与首批分成两个
   * zstd 帧，保证首帧独立可解（列举只读头的优化依赖这一点）。
   * @param meta - 会话头。
   * @param events - 首批事件。
   */
  private async materialize(meta: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
    const project = projectDir(this.root, meta.cwd)
    const dir = sessionDir(this.root, meta.cwd, meta.id)
    const finalPath = logPath(this.root, meta.cwd, meta.id, this.compression)
    // 物化前最后一道防线：同 id 的对面编码工件存在则报错。
    await this.rejectOppositeArtifact(meta.cwd, meta.id)
    const content = await this.encodeMaterialization(meta, events)
    /* v8 ignore next -- native Windows coverage exercises this platform dispatch; Linux covers the POSIX peer */
    if (process.platform === 'win32') {
      await this.materializeWin32(project, dir, finalPath, meta.id, content)
    } else {
      await this.materializePosix(project, dir, finalPath, meta.id, content)
    }
  }

  /* v8 ignore start -- Windows uses the Win32 durable-publish path; POSIX coverage exercises this peer. */
  /**
   * 【中文】POSIX 物化路径：逐层 mkdir(0o700) 并 fsync 各级父目录 → 拒绝已存在
   * 日志 → 写临时文件并 fsync → link() 发布（而非 rename）。link 在目标已存在时
   * 以 EEXIST 失败，两个进程并发物化同一 id 时不会互相覆盖。
   * @param project - 项目目录。
   * @param dir - 会话目录。
   * @param finalPath - 最终日志路径。
   * @param id - 会话 id（错误文案用）。
   * @param content - 已编码的文件内容。
   */
  private async materializePosix(
    project: string,
    dir: string,
    finalPath: string,
    id: SessionId,
    content: Buffer | string,
  ): Promise<void> {
    // 每建一层目录就 fsync 其父目录，让目录项本身也具备崩溃持久性。
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await this.syncDirPosix(dirname(this.root))
    await mkdir(project, { recursive: true, mode: 0o700 })
    await this.syncDirPosix(this.root)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await this.syncDirPosix(project)
    await this.rejectExistingLog(finalPath, id)
    const tmp = await this.writeSyncedTempFile(finalPath, content)
    // Publish via link()+unlink(), NOT rename(): link fails with EEXIST if the
    // final path already exists, so two processes materializing the same id
    // concurrently cannot clobber each other. rename() would silently overwrite.
    // 用 link()+unlink() 而非 rename() 发布：目标已存在时 link 以 EEXIST 失败，
    // 并发物化同一 id 的两个进程不会互相覆盖；rename() 会静默覆盖。
    let linked = false
    try {
      await link(tmp, finalPath)
      linked = true
    } finally {
      // Remove an unpublished temp on failure. After publication, defer cleanup
      // until the directory entry is durable so cleanup cannot reject a live log.
      // 发布失败时清理未发布的临时文件；发布成功则等目录项持久化之后再清理，
      // 保证清理动作绝不会误删"活着的"日志。
      /* v8 ignore next -- link failure is the TOCTOU/IO race guarded above; not reachable in test */
      if (!linked) await rm(tmp, { force: true })
    }
    // link() succeeded — the log is published. fsync the directory so the new
    // entry survives a power loss: the new link is not crash-durable until the
    // parent directory's metadata is synced.
    // link 成功即发布完成。fsync 父目录让新目录项在断电后仍在：
    // 父目录元数据未落盘前，新链接不具备崩溃持久性。
    await this.syncDirPosix(dir)
    // Best-effort temp cleanup: the log is already published and durable, so a
    // failure to remove the (now-redundant) temp hard link must NOT reject the
    // append. Swallow only the rm failure; nothing else of consequence runs here.
    // 尽力清理临时硬链接：日志已发布且持久，删不掉这个多余链接绝不能让追加失败。
    // 只吞掉 rm 失败；此处没有其他需要收尾的动作。
    try {
      await rm(tmp, { force: true })
    } catch {
      /* v8 ignore next -- redundant temp link; publish already durable, rm failure is an unreachable IO edge */
    }
  }
  /* v8 ignore stop */

  /* v8 ignore start -- native Windows coverage exercises this integration path */
  /**
   * 【中文】Windows 物化路径：用 ensureDurableDirectoryWin32 逐层建目录（写透发布），
   * 拒绝已存在日志，写临时文件后经 publishNewFileWin32 发布；发布失败清理临时文件。
   * @param project - 项目目录。
   * @param dir - 会话目录。
   * @param finalPath - 最终日志路径。
   * @param id - 会话 id（错误文案用）。
   * @param content - 已编码的文件内容。
   */
  private async materializeWin32(
    project: string,
    dir: string,
    finalPath: string,
    id: SessionId,
    content: Buffer | string,
  ): Promise<void> {
    await ensureDurableDirectoryWin32(this.root)
    await ensureDurableDirectoryWin32(project)
    await ensureDurableDirectoryWin32(dir)
    await this.rejectExistingLog(finalPath, id)
    const tmp = await this.writeSyncedTempFile(finalPath, content)
    try {
      await publishNewFileWin32(tmp, finalPath)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }
  /* v8 ignore stop */

  private async rejectExistingLog(finalPath: string, id: SessionId): Promise<void> {
    // Never publish over an existing committed log: materialize is the first
    // write of a session the backend believes is new. A file here means a
    // different session shares this id on disk — reject loudly. (createCore
    // already guards the create path, so this is unreachable-in-practice TOCTOU
    // defense.)
    // 绝不覆盖已提交日志：materialize 是"后端认为全新"的会话的第一次写。此处有
    // 文件意味着磁盘上有另一个会话共用该 id——大声拒绝。（createCore 已在创建
    // 路径把关，这是实际到不了的 TOCTOU 后备防线。）
    /* v8 ignore next 3 -- createCore guards collisions before materialize; this is a TOCTOU backstop */
    if (await this.exists(finalPath)) {
      throw new Error(`refusing to materialize "${id}": a log already exists on disk (load/resume it instead)`)
    }
  }

  /**
   * 【中文】写临时文件并 fsync：文件名带随机后缀防碰撞，'wx' 标志保证独占创建，
   * 0o600 权限。返回临时文件路径供发布步骤移动/硬链接。
   * @param finalPath - 最终发布路径（临时名基于它派生）。
   * @param content - 要写入的内容。
   * @returns 已落盘的临时文件路径。
   */
  private async writeSyncedTempFile(finalPath: string, content: Buffer | string): Promise<string> {
    const tmp = `${finalPath}.${randomBytes(6).toString('hex')}.tmp`
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    return tmp
  }

  /** Encode the header and first batch without combining their frame boundaries. */
  /**
   * 【中文】物化编码：头行与首批事件各自独立成帧（绝不合并帧边界），保证首帧
   * 单独解压即得头记录。明文模式直接拼接字符串。
   * @param meta - 会话头。
   * @param events - 首批事件。
   * @returns 已编码内容。
   */
  private async encodeMaterialization(meta: SessionHeader, events: readonly SessionEvent[]): Promise<Buffer | string> {
    const header = JSON.stringify(toHeaderLine(meta)) + '\n'
    const body = eventLines(events, this.packChunks) + '\n'
    if (this.compression === 'none') return header + body
    const headerFrame = await compressZstdFrame(header)
    const eventFrame = await compressZstdFrame(body)
    return Buffer.concat([headerFrame, eventFrame])
  }

  /** Encode one durable append batch in the configured physical representation. */
  /**
   * 【中文】把一批事件编码为当前物理表示：zstd 压成一个完整帧，明文原样返回。
   * @param events - 事件批次。
   * @returns 已编码内容。
   */
  private async encodeEventBatch(events: readonly SessionEvent[]): Promise<Buffer | string> {
    const body = eventLines(events, this.packChunks) + '\n'
    return this.compression === 'zstd' ? compressZstdFrame(body) : body
  }

  /** fsync a POSIX directory so a just-created/renamed entry is crash-durable. */
  /**
   * 【中文】fsync 一个 POSIX 目录：让刚创建/改名出来的目录项具备崩溃持久性。
   * Windows 没有对应机制，走 win32.ts 的写透命名空间操作。
   * @param dir - 要同步的目录路径。
   */
  /* v8 ignore start -- Windows uses write-through namespace operations; POSIX coverage exercises directory fsync. */
  private async syncDirPosix(dir: string): Promise<void> {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }
  /* v8 ignore stop */

  /**
   * Append and fsync event lines. On a partial write or sync failure, restore the
   * previous size before rethrowing because the unchanged cursor will retry the
   * batch; leaving partial bytes would create duplicate sequence numbers.
   */
  /**
   * 【中文】追加事件行并 fsync。写入或同步部分失败时，先把文件恢复到追加前的
   * 尺寸再抛错——因为游标未动、这批会被重试；留下半截字节会造成重复 seq。
   * @param meta - 会话头（定位日志文件）。
   * @param events - 要追加的事件批。
   */
  private async appendLines(meta: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
    const content = await this.encodeEventBatch(events)
    const path = logPath(this.root, meta.cwd, meta.id, this.compression)
    const handle = await open(path, 'a')
    // closed 标志保证句柄只关一次：回滚路径与 finally 都可能触发关闭。
    let closed = false
    const closeAppendHandle = async (): Promise<void> => {
      if (closed) return
      closed = true
      await handle.close()
    }

    try {
      // 记住追加前的尺寸，失败时据此截断回滚。
      const { size: before } = await handle.stat()
      try {
        await handle.writeFile(content)
        await handle.sync()
      } catch (error) {
        try {
          await closeAppendHandle()
          await this.rollbackAppend(path, before)
        } catch (rollbackError) {
          // 原始错误 + 回滚错误一起上报，避免掩盖任何一侧。
          throw new AggregateError([error, rollbackError], `failed to roll back append to "${path}"`)
        }
        throw error
      }
    } finally {
      await closeAppendHandle()
    }
  }

  /**
   * 【中文】把日志截断回指定字节并 fsync——appendLines 失败后的回滚动作。
   * @param path - 日志路径。
   * @param size - 目标尺寸（追加前的大小）。
   */
  private async rollbackAppend(path: string, size: number): Promise<void> {
    const handle = await open(path, 'r+')
    try {
      await handle.truncate(size)
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  /** Truncate the log file to `offset` bytes and fsync (discard the crash tail). */
  /**
   * 【中文】崩溃修复的截断步骤：把日志截到 offset 字节并 fsync，丢弃残尾。
   * @param meta - 会话头。
   * @param offset - 安全截断偏移（残帧起点）。
   */
  private async repair(meta: SessionHeader, offset: number): Promise<void> {
    const path = logPath(this.root, meta.cwd, meta.id, this.compression)
    await truncate(path, offset)
    const handle = await open(path, 'r+')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  // --- discovery helpers ---
  // --- 发现助手 ---

  /**
   * Read the first newline-terminated line of a file without loading the whole
   * file. Returns undefined if the file is empty or has no complete first line.
   * Reads in bounded chunks so a huge log costs only the header read.
   */
  /**
   * 【中文】读明文日志的首行（到第一个换行为止），不整文件加载。按 8KB 有界分块
   * 读取，超大日志也只花"一个头行"的代价。空文件或无完整首行返回 undefined。
   * @param path - 文件路径。
   * @param signal - 可选取消信号。
   * @returns 首行文本；无完整首行为 undefined。
   */
  private async readFirstLine(path: string, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    const handle = await open(path, 'r')
    try {
      signal?.throwIfAborted()
      const chunks: Buffer[] = []
      const buf = Buffer.alloc(8192)
      for (;;) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(buf, 0, buf.length, null)
        signal?.throwIfAborted()
        if (bytesRead === 0) return undefined // EOF with no newline → no complete line
        const slice = buf.subarray(0, bytesRead)
        const nl = slice.indexOf(0x0a)
        if (nl !== -1) {
          chunks.push(slice.subarray(0, nl))
          signal?.throwIfAborted()
          return Buffer.concat(chunks).toString('utf8')
        }
        chunks.push(Buffer.from(slice))
      }
    } finally {
      await handle.close()
    }
  }

  /** Read and validate only the independently compressed header frame. */
  /**
   * 【中文】zstd 日志的首行读取：分块累积字节，每轮用 scanZstdFrames(content, 1)
   * 尝试定位首帧；凑齐后解压、校验"恰好一行头"并返回该行。头帧独立压缩使列举
   * 无需解压整个日志。
   * @param path - 日志路径。
   * @param signal - 可选取消信号。
   * @returns 头行文本；无完整首帧为 undefined。
   */
  private async readFirstZstdLine(path: string, signal?: AbortSignal): Promise<string | undefined> {
    signal?.throwIfAborted()
    const handle = await open(path, 'r')
    try {
      signal?.throwIfAborted()
      let content = Buffer.alloc(0)
      const chunk = Buffer.alloc(8192)
      for (;;) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
        signal?.throwIfAborted()
        if (bytesRead === 0) return undefined
        signal?.throwIfAborted()
        content = Buffer.concat([content, chunk.subarray(0, bytesRead)])
        signal?.throwIfAborted()
        const first = scanZstdFrames(content, 1).frames[0]
        signal?.throwIfAborted()
        if (first === undefined) continue
        let plaintext: Buffer
        try {
          signal?.throwIfAborted()
          plaintext = await decompressZstdFrame(content.subarray(first.start, first.end))
        } catch (error) {
          /* v8 ignore next -- decoder failure plus concurrent abort is timing-dependent */
          if (signal?.aborted) signal.throwIfAborted()
          throw new Error('corrupt Zstandard session log: header frame failed validation', { cause: error })
        }
        signal?.throwIfAborted()
        assertZstdHeaderFrame(plaintext)
        return plaintext.subarray(0, -1).toString('utf8')
      }
    } finally {
      await handle.close()
    }
  }

  /** Find the unique physical log for an id across every project directory. */
  /**
   * 【中文】在 root 下所有项目目录中定位某 id 的唯一物理日志：逐目录拒绝旧版
   * 平铺工件与对面编码工件；命中多个目录视为存储损坏报错。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   * @returns 唯一日志路径；不存在为 undefined。
   */
  private async findLog(id: SessionId, signal?: AbortSignal): Promise<string | undefined> {
    const matches: string[] = []
    for (const project of await this.listProjectDirs(signal)) {
      signal?.throwIfAborted()
      await this.rejectLegacyFlatArtifact(project, id, signal)
      signal?.throwIfAborted()
      const dir = join(project, encodeSegment(id))
      const path = join(dir, `session${logSuffix(this.compression)}`)
      const opposite = join(dir, `session${logSuffix(this.oppositeCompression())}`)
      const oppositeExists = await this.exists(opposite)
      signal?.throwIfAborted()
      if (oppositeExists) throw this.encodingMismatch(opposite)
      const pathExists = await this.exists(path)
      signal?.throwIfAborted()
      if (pathExists) matches.push(path)
    }
    if (matches.length > 1) {
      throw new Error(`duplicate JSONL session id "${id}" appears in multiple project directories`)
    }
    signal?.throwIfAborted()
    return matches[0]
  }

  /** Require an existing configured root to be a readable directory. */
  /**
   * 【中文】构造期校验：root 已存在时必须是可读目录（用 readdirSync 探测）；
   * 不存在（ENOENT）则放行——它会在首次物化时创建。
   */
  private assertUsableRoot(): void {
    try {
      readdirSync(this.root)
    } catch (error) {
      if (isENOENT(error)) return
      throw error
    }
  }

  /** Reject metadata that does not identify the selected physical log. */
  /**
   * 【中文】存储身份守卫：头里的 id/cwd 必须恰好指向被读取的这份物理文件。
   * expectedId 给出时先比对 id；再由头信息推算期望路径，路径拼写不同时用
   * sameFile（realpath）确认是否同一文件——兼容大小写不敏感文件系统上的
   * 大小写别名，同时不在大小写敏感的存储上放松检查。
   * @param path - 实际读取的日志路径。
   * @param meta - 从日志解析出的头信息。
   * @param expectedId - 请求方期望的会话 id（可选）。
   * @param signal - 可选取消信号。
   */
  private async assertStoredIdentity(
    path: string,
    meta: SessionHeader,
    expectedId?: SessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    if (expectedId !== undefined && meta.id !== expectedId) {
      throw new Error(`corrupt session log "${path}": requested id "${expectedId}" does not match header id "${meta.id}"`)
    }
    let expectedPath: string
    try {
      expectedPath = logPath(this.root, meta.cwd, meta.id, this.compression)
    } catch (error) {
      throw new Error(`corrupt session log "${path}": header id cannot name a storage path`, { cause: error })
    }
    if (path !== expectedPath && !await this.sameFile(path, expectedPath, signal)) {
      throw new Error(`corrupt session log "${path}": header id "${meta.id}" and cwd identify "${expectedPath}"`)
    }
    signal?.throwIfAborted()
  }

  /**
   * Whether two path spellings resolve to the same physical file. This admits
   * case aliases on case-insensitive filesystems without weakening identity
   * checks on case-sensitive stores.
   */
  /**
   * 【中文】判断两个路径拼写是否指向同一个物理文件：对双方都做 realpath 后比较。
   * realpath ENOENT 视为"不是同一文件"（其一不存在）；其他错误上抛——
   * 权限/IO 故障不能被误判为"不同文件"。
   * @param path - 实际路径拼写 A。
   * @param expectedPath - 期望的路径拼写 B。
   * @param signal - 可选取消信号。
   * @returns 同一物理文件返回 true。
   */
  private async sameFile(path: string, expectedPath: string, signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    try {
      const [actual, expected] = await Promise.all([realpath(path), realpath(expectedPath)])
      signal?.throwIfAborted()
      return actual === expected
    } catch (error) {
      signal?.throwIfAborted()
      /* v8 ignore else -- non-ENOENT realpath failures require an external permission or I/O fault */
      if (isENOENT(error)) return false
      /* v8 ignore next -- non-ENOENT realpath failures are external I/O faults, propagated unchanged */
      throw error
    }
  }

  /** The human-readable project directories under the configured root. */
  /**
   * 【中文】列出 root 下的一层子目录（即各项目目录）。root 不存在视为"没有会话"
   * 返回空数组；其他 IO 错误一律上抛。
   * @param signal - 可选取消信号。
   * @returns 项目目录绝对路径列表。
   */
  private async listProjectDirs(signal?: AbortSignal): Promise<string[]> {
    try {
      signal?.throwIfAborted()
      const entries = await readdir(this.root, { withFileTypes: true })
      signal?.throwIfAborted()
      return entries.filter(e => e.isDirectory()).map(e => join(this.root, e.name))
    } catch (error) {
      // Only an absent root means no sessions; rethrow every other I/O failure.
      // 只有"根不存在"意味着没有会话；其余 IO 失败必须原样上抛。
      if (isENOENT(error)) return []
      throw error
    }
  }

  /** List session-owned directories and reject the obsolete flat-file layout. */
  /**
   * 【中文】列出某项目目录下的会话目录；若发现旧版"平铺日志文件"
   *（*.jsonl / *.jsonl.zstd 直接躺在项目目录里）则报错，提示迁移布局。
   * @param project - 项目目录。
   * @param signal - 可选取消信号。
   * @returns 会话目录绝对路径列表。
   */
  private async listSessionDirs(project: string, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted()
    const entries = await readdir(project, { withFileTypes: true })
    signal?.throwIfAborted()
    const legacy = entries.find(entry =>
      entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd')))
    if (legacy !== undefined) throw this.legacyLayout(join(project, legacy.name))
    return entries.filter(entry => entry.isDirectory()).map(entry => join(project, entry.name))
  }

  /** Reject a root that already belongs to the other physical encoding. */
  /**
   * 【中文】root 编码一致性检查（懒执行且只执行一次）：扫描全部会话目录，
   * 一旦发现"对面编码"的工件就报错。避免同一 root 下两种编码混存。
   * @returns 首次调用时启动检查；后续调用复用同一 Promise。
   */
  private ensureRootEncoding(): Promise<void> {
    // ??= 惰性缓存：检查只做一次，之后所有读写路径共享其结果。
    this.rootEncodingCheck ??= this.checkRootEncoding()
    return this.rootEncodingCheck
  }

  /** 【中文】实际执行 root 编码扫描：任何会话目录里出现对面编码工件即报错。 */
  private async checkRootEncoding(): Promise<void> {
    for (const project of await this.listProjectDirs()) {
      for (const dir of await this.listSessionDirs(project)) {
        const incompatible = join(dir, `session${logSuffix(this.oppositeCompression())}`)
        if (await this.exists(incompatible)) throw this.encodingMismatch(incompatible)
      }
    }
  }

  /**
   * 【中文】拒绝旧版平铺布局：项目目录下若存在 `<编码id>.jsonl[.zstd]` 文件，
   * 说明该 root 曾用旧版格式，必须先迁移才能继续。
   * @param project - 项目目录。
   * @param id - 会话 id。
   * @param signal - 可选取消信号。
   */
  private async rejectLegacyFlatArtifact(
    project: string,
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    const encoded = encodeSegment(id)
    for (const compression of ['zstd', 'none'] as const) {
      const path = join(project, encoded + logSuffix(compression))
      const artifactExists = await this.exists(path)
      signal?.throwIfAborted()
      if (artifactExists) throw this.legacyLayout(path)
    }
  }

  /** 【中文】物化前守卫：同 id 的"对面编码"工件已存在则报错，防止双份日志。 */
  private async rejectOppositeArtifact(cwd: string | undefined, id: SessionId): Promise<void> {
    const path = logPath(this.root, cwd, id, this.oppositeCompression())
    if (await this.exists(path)) throw this.encodingMismatch(path)
  }

  /** 【中文】返回与当前配置相反的物理编码。 */
  private oppositeCompression(): JsonlCompression {
    return this.compression === 'zstd' ? 'none' : 'zstd'
  }

  /** 【中文】构造"物理编码不匹配"错误：提示换 root 或改配置。 */
  private encodingMismatch(path: string): Error {
    return new Error(
      `session artifact ${JSON.stringify(path)} uses ${logSuffix(this.oppositeCompression())}, `
      + `but this backend is configured for compression ${JSON.stringify(this.compression)}; `
      + 'use a separate root or select the matching compression mode',
    )
  }

  /** 【中文】构造"旧版平铺布局"错误：提示迁移目录结构后再加载。 */
  private legacyLayout(path: string): Error {
    return new Error(
      `session artifact ${JSON.stringify(path)} uses the unsupported flat-file layout; `
      + 'use a separate root or move it into a project/session directory before loading',
    )
  }

  /**
   * 【中文】探测文件是否存在（打开后立即关闭）。只有 ENOENT 算"不存在"；
   * 权限/IO 错误必须上抛，绝不能让加载或冲突检查在"虚假的不存在"上继续。
   * Windows 对"普通文件/子路径"报 ENOENT 而非 ENOTDIR，因此还要检查直接父级，
   * 保证被阻断的会话目录仍被识别为存储故障。
   * @param path - 待探测路径。
   * @returns 存在返回 true。
   */
  private async exists(path: string): Promise<boolean> {
    try {
      const handle = await open(path, 'r')
      await handle.close()
      return true
    } catch (error) {
      // Only ENOENT means absent. A permission/I/O error must surface rather
      // than letting load or collision checks proceed under false absence.
      // Windows reports ENOENT, not ENOTDIR, for `regular-file/child`; verify
      // the immediate parent so a blocked session directory remains a storage fault.
      // 只有 ENOENT 表示不存在；权限/IO 错误必须上抛而非伪装成不存在。
      // Windows 把"父是普通文件"报成 ENOENT，所以补查父路径。
      /* v8 ignore else -- Windows reports file-valued parents as ENOENT; POSIX covers direct ENOTDIR. */
      if (isENOENT(error)) {
        await this.assertLogParentAllowsAbsence(path)
        return false
      }
      /* v8 ignore next -- Windows repairs ENOTDIR from ENOENT above; POSIX covers direct ENOTDIR. */
      throw error
    }
  }

  /* v8 ignore start -- native Windows coverage exercises this repair; POSIX open reports ENOTDIR before this point. */
  /**
   * 【中文】Windows 的 ENOTDIR 修复：父路径存在但不是目录时，手工构造 ENOTDIR
   * 错误上抛；父路径不存在则维持"目标确实不存在"的结论。
   * @param path - 原本探测的目标路径。
   */
  private async assertLogParentAllowsAbsence(path: string): Promise<void> {
    try {
      const parent = dirname(path)
      const info = await stat(parent)
      if (info.isDirectory()) return
      const error = new Error(`ENOTDIR: parent path exists but is not a directory: ${parent}`) as NodeJS.ErrnoException
      error.code = 'ENOTDIR'
      error.path = parent
      throw error
    } catch (error) {
      if (isENOENT(error)) return
      throw error
    }
  }
  /* v8 ignore stop */
}

export default JsonlSessionPersistence
