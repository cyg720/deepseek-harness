/**
 * ================================ 文件注释 ================================
 * 【文件职责】JSONL 后端的磁盘格式工具箱：路径段安全编码（SessionId 是未校验的
 *   品牌字符串，入路径前必须编码——防穿越、防冲突）、项目/会话目录布局、头行的
 *   序列化与反序列化、事件批的 JSONL 文本化，以及截断修复偏移的计算
 *   （SessionLogScanner 流式扫描器）。
 * 【技术维度】注入式转义（`~XXXX` 十六进制码元转义，单射覆盖全部 UTF-16 码元，
 *   含孤立代理项）；首行 `type:'session'` 头记录 + 逐行事件记录的 JSONL 布局；
 *   打包行（chunks 存储行）的透明解码；字节级增量扫描器（跨块残片缓冲）。
 * 【产品维度】会话文件按"项目 → 会话"两级目录组织，用户能在资源管理器里直接
 *   找到某次对话；损坏日志只丢弃真正残缺的部分，尽量保住已写完的历史。
 * 【逻辑维度】按代码顺序：①编码类型与文件后缀；②HeaderLine 及双向转换、类型守卫；
 *   ③encodeSegment/projectKey/projectDir/sessionDir/logPath 路径构建；
 *   ④eventLines 序列化；⑤refuseForeignFormatVersion/parseHeaderRecord 头解析；
 *   ⑥SessionLogScanner 与 scanLog/parseHeaderMeta。
 * 【关键边界】encodeSegment 对空串抛错；projectKey 有意有损（分隔符折叠 + 截断
 *   到 251 字符），只作人类可读分组键；版本检查必须在结构解析之前完成，
 *   让未来格式得到"请升级"而非"已损坏"的错误。
 * 【新手阅读建议】先读 encodeSegment 理解路径安全，再看 HeaderLine 双向转换，
 * 最后精读 SessionLogScanner 的 write/consumeEventLine——它是崩溃恢复语义的核心。
 * ==========================================================================
 */
/**
 * On-disk format helpers for the JSONL session-persistence backend: path
 * sanitization (a {@link SessionId} is an unvalidated branded string, so it
 * MUST be encoded before use in a path — no traversal, no collision), the
 * per-project/session directory layout, header-line (de)serialization, and the
 * truncation-repair offset computation.
 *
 * @module dsh-session-persistence-jsonl/format
 */
/*
 * 【中文导读】上面英文概括：本模块是 JSONL 后端的磁盘格式助手——路径净化、目录
 * 布局、头行编解码与截断修复偏移计算。
 */

import { join } from 'node:path'
import {
  decodeSeqRanges, decodeStorageRecord, encodeSeqRanges, packChunkRuns, SESSION_FORMAT_VERSION,
} from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, StorageRecord } from '@deepseek-ai/dsh-session'
import { SessionFormatUnsupportedError, sessionFormatVersionRefusal } from '@deepseek-ai/dsh-session-persistence'

/** Physical encoding selected for JSONL session artifacts. */
/* 【中文】JSONL 会话工件的物理编码：zstd 压缩帧或明文。 */
export type JsonlCompression = 'zstd' | 'none'

/**
 * Return the artifact suffix for one physical encoding.
 * @param compression - configured JSONL artifact encoding.
 * @returns `.jsonl.zstd` for Zstandard or `.jsonl` for plaintext.
 */
/*
 * 【中文】按物理编码返回工件文件后缀。
 * @param compression - 配置的编码。
 * @returns zstd 返回 .jsonl.zstd；明文返回 .jsonl。
 */
export function logSuffix(compression: JsonlCompression): '.jsonl.zstd' | '.jsonl' {
  return compression === 'zstd' ? '.jsonl.zstd' : '.jsonl'
}

/**
 * The first JSONL record of a session artifact: the immutable
 * {@link SessionHeader} tagged as a `session` record so a reader can tell it
 * apart from an event line.
 */
/*
 * 【中文】会话工件的首行 JSON 结构：不可变 SessionHeader 加上 type:'session'
 * 标签——读取方据此把头行与事件行区分开。可选字段缺省时直接省略（不写 null）。
 */
export interface HeaderLine {
  /** 【中文】固定为 'session' 的记录类型标签。 */
  type: 'session'
  /** 【中文】日志格式版本（写入时的 SESSION_FORMAT_VERSION）。 */
  version: number
  /** 【中文】会话 id（原始形式，未做路径编码）。 */
  id: SessionId
  /** 【中文】创建时间戳（非负安全整数毫秒）。 */
  createdAt: number
  /** 【中文】会话工作目录（可选）。 */
  cwd?: string
  /** 【中文】父会话 id（子代理派生场景，可选）。 */
  parentSession?: SessionId
  /** 【中文】种子事件长度（可选）。 */
  seedLength?: number
  /** 【中文】来源标记；目前仅 'subagent'（可选）。 */
  origin?: 'subagent'
  /** 【中文】代理委托深度，缺省按 0 处理。 */
  delegationDepth: number
  /** 【中文】代理预设名（可选）。 */
  agentPreset?: string
}

/**
 * Build the header line object from a {@link SessionHeader}.
 * @param header - the immutable session metadata to serialize.
 * @returns the `type: 'session'`-tagged line object, absent optional fields omitted (never null).
 */
/*
 * 【中文】把 SessionHeader 序列化为首行对象：可选字段缺失时省略键而非写 null；
 * delegationDepth 缺省补 0，保证行结构稳定。
 * @param header - 要序列化的不可变会话头。
 * @returns 带 type:'session' 标签的行对象。
 */
export function toHeaderLine(header: SessionHeader): HeaderLine {
  return {
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    ...header.parentSession !== undefined ? { parentSession: header.parentSession } : {},
    ...header.seedLength !== undefined ? { seedLength: header.seedLength } : {},
    ...header.origin !== undefined ? { origin: header.origin } : {},
    delegationDepth: header.delegationDepth ?? 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  }
}

/**
 * Parse a header line back into a {@link SessionHeader}.
 * @param line - the shape-checked first line of a log (see the `isHeaderLine` guard).
 * @returns the header, absent optional fields omitted.
 */
/*
 * 【中文】把首行对象还原为 SessionHeader。若发现已退役的策略基线字段
 * （sandboxMode/approvalPolicy）则直接报错——旧策略体系不再被解读。
 * @param line - 已通过形状检查的首行对象（见 isHeaderLine 守卫）。
 * @returns 会话头；可选字段缺失时省略。
 */
export function fromHeaderLine(line: HeaderLine): SessionHeader {
  if (Object.hasOwn(line, 'sandboxMode') || Object.hasOwn(line, 'approvalPolicy')) {
    throw new Error('session header uses retired policy baseline fields')
  }
  return {
    version: line.version,
    id: line.id,
    createdAt: line.createdAt,
    ...line.cwd !== undefined ? { cwd: line.cwd } : {},
    ...line.parentSession !== undefined ? { parentSession: line.parentSession } : {},
    ...line.seedLength !== undefined ? { seedLength: line.seedLength } : {},
    ...line.origin !== undefined ? { origin: line.origin } : {},
    delegationDepth: line.delegationDepth,
    ...line.agentPreset !== undefined ? { agentPreset: line.agentPreset } : {},
  }
}

/** Type guard: a parsed first line is a well-formed session header. */
/*
 * 【中文】类型守卫：逐字段校验解析出的首行——type 必须是 'session'，version/id/
 * createdAt/delegationDepth 类型正确且数值为非负安全整数（并排除 -0），
 * origin/agentPreset 取值受限。这是"文件边界"上少有的运行时校验点。
 * @param value - JSON 解析后的任意值。
 * @returns 合法头行返回 true 并收窄类型。
 */
function isHeaderLine(value: unknown): value is HeaderLine {
  return (
    typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'session'
    && typeof (value as { version?: unknown }).version === 'number'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { createdAt?: unknown }).createdAt === 'number'
    && Number.isSafeInteger((value as { createdAt: number }).createdAt)
    && (value as { createdAt: number }).createdAt >= 0
    && !Object.is((value as { createdAt: number }).createdAt, -0)
    && typeof (value as { delegationDepth?: unknown }).delegationDepth === 'number'
    && Number.isSafeInteger((value as { delegationDepth: number }).delegationDepth)
    && (value as { delegationDepth: number }).delegationDepth >= 0
    && !Object.is((value as { delegationDepth: number }).delegationDepth, -0)
    && ((value as { origin?: unknown }).origin === undefined
      || (value as { origin?: unknown }).origin === 'subagent')
    && ((value as { agentPreset?: unknown }).agentPreset === undefined
      || typeof (value as { agentPreset?: unknown }).agentPreset === 'string')
  )
}

/**
 * Encode an arbitrary string as a single safe path segment, injectively over ALL JS (UTF-16)
 * strings — including lone surrogates. A {@link SessionId} is an unvalidated branded string,
 * so this neutralizes `../`, absolute paths, NUL, and separators before any filesystem use.
 * Safe code units remain literal; every other unit, including `~`, becomes
 * `~XXXX`. Operating on code units preserves lone surrogates, while special-
 * casing `.` and `..` prevents traversal by an otherwise safe whole segment.
 *
 * @param raw - the string to encode; must be non-empty (throws on `''`).
 * @returns the escaped single path segment, decodable back to `raw`.
 */
/*
 * 【中文】把任意字符串编码成单个安全路径段：安全字符（字母数字下划点连字符）
 * 原样保留，其余每个 UTF-16 码元（含 `~`、分隔符、NUL、孤立代理项）转义为
 * `~XXXX` 十六进制；整段恰为 "." / ".." 时也转义，杜绝目录穿越。编码是单射，
 * 可无损解码回原文。
 * @param raw - 待编码字符串；空串抛错。
 * @returns 转义后的单段路径名。
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  // 整段就是 "." 或 ".." 的特判：否则它们虽由安全字符组成，却是路径穿越语义。
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * Build the readable directory key for a project path.
 * Filesystem separators and drive separators become `-`; unsafe code units use
 * the same `~XXXX` escape as session ids. The key is bounded for filesystem
 * component limits. Separator replacement and truncation are intentionally
 * lossy, following the common human-navigable project-directory convention.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
/*
 * 【中文】把项目路径转成"人类可读"的目录名：文件/盘符分隔符折叠为单个 '-'，
 * 其余不安全码元用 `~XXXX` 转义。与 encodeSegment 不同，这里有意有损：
 * 分隔符合并 + 截断到 251 字符（适配文件系统组件长度限制），只作分组展示键。
 * 结果形如 `--<slug>--`；空 slug 兜底为 'root'。
 * @param cwd - 会话的项目目录路径。
 * @returns 文件系统安全的项目目录名。
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  // separatorRun 记录上一字符是否分隔符：连续分隔符只产出一个 '-'。
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * The configured root's human-navigable project directory. A configured root
 * may be local or shared; this grouping does not prescribe its deployment.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory; `undefined` selects `_no-cwd`.
 * @returns the project directory path under `root`.
 */
/*
 * 【中文】取 root 下某项目对应的目录：cwd 未定义时归入特殊目录 `_no-cwd`，
 * 否则用 projectKey 生成的可读目录名。
 * @param root - 后端的会话根目录。
 * @param cwd - 会话项目目录；undefined 选择 _no-cwd。
 * @returns root 下的项目目录绝对路径。
 */
export function projectDir(root: string, cwd: string | undefined): string {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * The directory owned by one session and available for future session-local
 * artifacts.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory.
 * @param id - the session id, encoded to one safe path segment.
 * @returns the session directory beneath its project directory.
 */
/*
 * 【中文】某会话专属的目录（未来可容纳会话级其他工件）：项目目录 + 编码后的 id。
 * @param root - 会话根目录。
 * @param cwd - 项目目录。
 * @param id - 会话 id（入路径前经 encodeSegment 编码）。
 * @returns 项目目录下的会话目录路径。
 */
export function sessionDir(root: string, cwd: string | undefined, id: SessionId): string {
  return join(projectDir(root, cwd), encodeSegment(id))
}

/**
 * The append-only event-log file path for a session.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory (`undefined` → `_no-cwd`).
 * @param id - the session id, path-encoded via {@link encodeSegment} before filesystem use.
 * @param compression - physical artifact encoding and filename suffix.
 * @returns the session's configured JSONL artifact path.
 */
/*
 * 【中文】会话的追加式事件日志文件完整路径：会话目录 + `session<后缀>`。
 * @param root - 会话根目录。
 * @param cwd - 项目目录（undefined → _no-cwd）。
 * @param id - 会话 id（经 encodeSegment 编码后使用）。
 * @param compression - 物理编码，决定文件名后缀。
 * @returns 配置对应的 JSONL 工件路径。
 */
export function logPath(
  root: string,
  cwd: string | undefined,
  id: SessionId,
  compression: JsonlCompression,
): string {
  return join(sessionDir(root, cwd, id), `session${logSuffix(compression)}`)
}

/**
 * Serialize an event batch as JSONL lines (no trailing newline). With
 * `packChunks` on, delta-chunk runs pack into `text-chunks` /
 * `reasoning-chunks` / `tool-call-chunks` storage rows; off writes one event
 * per line. Both modes range-encode provenance at the storage boundary.
 * Reading is layout-blind either way ({@link scanLog} always decodes rows),
 * so the switch changes only newly written bytes.
 * @param events - the batch to serialize, in log order.
 * @param packChunks - whether to pack delta runs into storage rows.
 * @returns the batch's JSONL text; the writer adds the final newline.
 */
/*
 * 【中文】把事件批序列化为 JSONL 文本（不含末尾换行，由写方补）。packChunks 开启
 * 时把连续的 delta 块事件打包成存储行；关闭则逐事件一行。两种布局的读取方式
 * 完全相同（scanLog 总是解行），开关只影响新写入的字节。
 * @param events - 按日志顺序排列的事件批。
 * @param packChunks - 是否把增量块打包成存储行。
 * @returns 批次的 JSONL 文本。
 */
export function eventLines(events: readonly SessionEvent[], packChunks: boolean): string {
  // 打包与否只改变"行"的粒度；decodeStorageRecord 读侧无条件展开。
  const records: readonly StorageRecord[] = packChunks ? packChunkRuns(events) : events
  return records.map(record => JSON.stringify(encodeProvenanceForStorage(record))).join('\n')
}

/**
 * Losslessly shrink a record's `sourceEventSeqs` for the log: consecutive
 * runs of at least three seqs become `[start, end]` pairs, and any other list
 * stays verbatim.
 * @param record - one stored record (event or packed row).
 * @returns the record with its provenance in storage form (widened from the
 *   in-memory `number[]`; {@link expandProvenanceFromStorage} restores it).
 */
function encodeProvenanceForStorage(record: StorageRecord): unknown {
  if (!('sourceEventSeqs' in record)) return record
  return { ...record, sourceEventSeqs: encodeSeqRanges(record.sourceEventSeqs) }
}

/**
 * Expand a parsed line's storage-form provenance back to `number[]`.
 * @param parsed - the JSON-parsed value of one stored line.
 * @returns the value with provenance expanded.
 * @throws when the record or its storage-form provenance is malformed.
 */
function expandProvenanceFromStorage(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('stored session records must be objects')
  }
  const record = parsed as { seq?: unknown; sourceEventSeqs?: unknown }
  if (record.sourceEventSeqs === undefined) return parsed
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0) {
    throw new TypeError('stored session event seq must be a non-negative safe integer')
  }
  return { ...record, sourceEventSeqs: decodeSeqRanges(record.sourceEventSeqs, record.seq as number) }
}

/** 【中文】一次日志扫描的产出：头信息、有效事件前缀、可安全追加的字节偏移。 */
interface SessionLogScan {
  meta: SessionHeader
  events: SessionEvent[]
  committedBytes: number
}

/** Parse one complete header record supplied independently from event rows. */
/**
 * Refuse a header carrying a format version this build does not read BEFORE
 * validating the current header shape or decoding any event row: a future
 * format need not satisfy this build's structural checks at all, and its user
 * must see "upgrade the harness", never "corrupt session log".
 * @param parsed - the JSON-parsed first line of a session artifact.
 */
/*
 * 【中文】版本前置守卫：在按当前结构校验头、解码任何事件行之前，先检查首行的
 * version 字段——未来格式完全可能不满足今天的结构检查，用户必须看到
 * "请升级 harness"而不是"日志损坏"。version 等于当前值则放行。
 * @param parsed - 会话工件首行的 JSON 解析结果。
 */
function refuseForeignFormatVersion(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) return
  const { version, id } = parsed as { version?: unknown; id?: unknown }
  if (typeof version !== 'number' || version === SESSION_FORMAT_VERSION) return
  throw new SessionFormatUnsupportedError(
    sessionFormatVersionRefusal(typeof id === 'string' ? id : String(id), version),
  )
}

/** 【中文】解析头记录：必须是"恰好一行"（以换行结尾且中间无换行），JSON 合法，
 * 版本受支持且通过形状守卫；任何一步失败都以明确的损坏/空文件错误拒绝。 */
function parseHeaderRecord(record: Buffer): SessionHeader {
  // 结构检查：非空、以 0x0A 结尾、且这是唯一一个换行——保证"恰好一行"。
  if (record.length === 0 || record.at(-1) !== 0x0A || record.indexOf(0x0A) !== record.length - 1) {
    throw new Error('empty or header-less session log')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(record.subarray(0, -1).toString('utf8'))
  } catch {
    throw new Error('corrupt session log: header line is not valid JSON')
  }
  // 先拒外来版本再验结构：错误语义优先于形状细节。
  refuseForeignFormatVersion(parsed)
  if (!isHeaderLine(parsed)) {
    throw new Error('corrupt session log: first line is not a session header')
  }
  return fromHeaderLine(parsed)
}

/**
 * Incrementally scan complete JSONL event records after an independently
 * supplied header record. Newline search and byte offsets stay on raw buffers;
 * only complete records are decoded to UTF-8. A fragment crossing writes is
 * copied because a decoder may reuse its output buffer after `write()` returns.
 */
/*
 * 【中文】增量式 JSONL 事件扫描器：在独立供给的头记录之后，逐块消费明文、只把
 * "完整行"解码为事件。换行查找与字节偏移始终基于原始 Buffer；跨块残片会被拷贝
 * 缓存（因为解码器可能在 write 返回后复用其输出缓冲）。同时维护"已提交字节
 * 偏移"（committedBytes），即崩溃后可安全追加/截断的位置。
 */
export class SessionLogScanner {
  /** 【中文】解析自首行的会话头。 */
  private readonly meta: SessionHeader
  /** 【中文】有效连续事件前缀（seq 从 0 连续）。 */
  private readonly events: SessionEvent[] = []
  /** 【中文】尚未凑成完整行的残片（已拷贝，避免底层缓冲复用问题）。 */
  private fragments: Buffer[] = []
  /** 【中文】残片累计字节数。 */
  private fragmentBytes = 0
  /** 【中文】迄今消费的总输入字节数。 */
  private inputBytes: number
  /** 【中文】已提交（确认完整且连续）的字节偏移；崩溃修复的安全截断点。 */
  private committedBytes: number
  /** 【中文】已处理的事件行计数（含失败行，用于错误定位）。 */
  private eventLine = 0
  /** 【中文】首个遇到的损坏问题；出现后停止累积前缀，等待是否以 turn/end 定界。 */
  private issue: Error | undefined
  /** 【中文】finish 后禁止再 write。 */
  private finished = false

  /**
   * Create an event scanner from exactly one newline-terminated header record.
   * @param headerRecord - the complete first JSONL record, including its newline.
   */
  /*
   * 【中文】用"恰好一个换行结尾的头记录"创建扫描器；头在此处完成全部校验。
   * @param headerRecord - 完整的首条 JSONL 记录（含换行符）。
   */
  constructor(headerRecord: Buffer) {
    this.meta = parseHeaderRecord(headerRecord)
    // 头记录本身也算入输入与已提交字节。
    this.inputBytes = headerRecord.length
    this.committedBytes = headerRecord.length
  }

  /**
   * Consume the next raw plaintext chunk, retaining only an incomplete final record.
   * @param chunk - bytes immediately following all previously supplied bytes.
   */
  /*
   * 【中文】消费下一段明文：按换行切分，完整行走事件解析，最后一段不完整残片
   * 留待下一块拼接。若之前已有残片，先把新片段并入再解析。
   * @param chunk - 紧接此前所有字节之后的明文块。
   */
  write(chunk: Buffer): void {
    if (this.finished) throw new Error('cannot write to a finished session log scanner')
    const chunkStart = this.inputBytes
    this.inputBytes += chunk.length
    let lineStart = 0
    for (
      let newline = chunk.indexOf(0x0A);
      newline !== -1;
      newline = chunk.indexOf(0x0A, lineStart)
    ) {
      const fragment = chunk.subarray(lineStart, newline)
      let line = fragment
      if (this.fragments.length > 0) {
        // 跨块残片拼合：有缓存残片时必须拷贝拼接，防止上游缓冲复用导致数据被覆盖。
        if (fragment.length > 0) this.fragments.push(fragment)
        line = Buffer.concat(this.fragments, this.fragmentBytes + fragment.length)
        this.fragments = []
        this.fragmentBytes = 0
      }
      this.consumeEventLine(line, chunkStart + newline + 1)
      lineStart = newline + 1
    }
    if (lineStart < chunk.length) {
      const fragment = Buffer.from(chunk.subarray(lineStart))
      this.fragments.push(fragment)
      this.fragmentBytes += fragment.length
    }
  }

  /**
   * Snapshot progress before appending a recoverable torn-frame prefix.
   * @returns byte, committed-prefix, and expanded-event cursors.
   */
  /*
   * 【中文】快照当前进度：总输入字节、已提交字节、已展开的事件数。zstd 读路径在
   * 追加"残帧抢救明文"之前先记下这个检查点，之后新增的事件即抢救事件。
   * @returns 三个游标组成的对象。
   */
  checkpoint(): { inputBytes: number; committedBytes: number; eventCount: number } {
    return {
      inputBytes: this.inputBytes,
      committedBytes: this.committedBytes,
      eventCount: this.events.length,
    }
  }

  /**
   * Finish scanning, ignoring a final record without a newline as a torn tail.
   * @returns the header, contiguous event prefix, and safe truncation offset.
   */
  /*
   * 【中文】结束扫描：没有换行结尾的最后一行按残尾忽略（不进入事件列表）。
   * @returns 头信息、连续事件前缀与安全截断偏移。
   */
  finish(): SessionLogScan {
    this.finished = true
    return { meta: this.meta, events: this.events, committedBytes: this.committedBytes }
  }

  /** Decode one complete event row and update the contiguous prefix. */
  /*
   * 【中文】解析一行完整事件记录并推进连续前缀。关键语义：
   * - 解析/解码失败：记下首个 issue；只有当后续行里出现 turn/end（回合收尾）
   *   时才抛出——否则把损坏行当作新的"残尾起点"，尽量保住之前的前缀；
   * - seq 断档：同样记 issue 并回滚本行展开的事件，等待 turn/end 定界；
   * - 一切正常则推进 committedBytes 到本行末尾。
   * @param line - 完整一行的原始字节（不含换行）。
   * @param endByte - 该行（含换行）结束后的绝对字节偏移。
   */
  private consumeEventLine(line: Buffer, endByte: number): void {
    this.eventLine += 1
    let decoded: SessionEvent[]
    try {
      decoded = decodeStorageRecord(expandProvenanceFromStorage(JSON.parse(line.toString('utf8'))))
    } catch {
      // 首个问题优先保留；后续同类问题不覆盖它。
      this.issue ??= new Error(`corrupt session log: unparsable committed event at line ${this.eventLine}`)
      return
    }

    if (this.issue !== undefined) {
      if (decoded.some(event => event.type === 'turn/end')) throw this.issue
      return
    }

    const rowStart = this.events.length
    for (const event of decoded) {
      if (event.seq !== this.events.length) {
        const expected = this.events.length
        this.events.length = rowStart
        this.issue = new Error(
          `corrupt session log: seq gap in committed region at line ${this.eventLine} `
          + `(expected ${expected}, got ${event.seq})`,
        )
        if (decoded.some(candidate => candidate.type === 'turn/end')) throw this.issue
        return
      }
      this.events.push(event)
    }
    // 本行全部事件连续合法：提交点推进到行尾（含换行）。
    this.committedBytes = endByte
  }
}

/**
 * Parse a complete or torn JSONL buffer into its preserved event prefix. This
 * compatibility wrapper supplies the first record separately, then delegates
 * event rows to {@link SessionLogScanner}.
 *
 * @param buffer - the raw bytes of the log file (header line first).
 * @returns the header, preserved event prefix, and byte offset safe to append at.
 */
/*
 * 【中文】一次性解析完整（或残缺）的 JSONL 缓冲：先切出首行作为头记录，
 * 其余事件行交给 {@link SessionLogScanner}。兼容性包装，便于非流式场景使用。
 * @param buffer - 日志文件的原始字节（首行为头记录）。
 * @returns 头信息、保留的事件前缀、可安全追加的字节偏移。
 */
export function scanLog(buffer: Buffer): SessionLogScan {
  const headerEnd = buffer.indexOf(0x0A)
  // 连一个换行都没有：连头行都不完整。
  if (headerEnd === -1) throw new Error('empty or header-less session log')
  const scanner = new SessionLogScanner(buffer.subarray(0, headerEnd + 1))
  scanner.write(buffer.subarray(headerEnd + 1))
  return scanner.finish()
}

/**
 * Parse just the header line of a log into a {@link SessionHeader}, or
 * `undefined` if it is missing/not a header. Used by `list()` to read session
 * metadata WITHOUT parsing the whole log: a session picker scales with the
 * number of sessions, not the total size of every conversation.
 * @param firstLine - the first line of a log file (without its trailing newline).
 * @returns the parsed header, or `undefined` when the line is not a well-formed session header.
 */
/*
 * 【中文】只解析日志头行：JSON 解析或形状校验失败一律返回 undefined（而非抛错），
 * 供 list 等场景把"不是会话日志的文件"静默跳过。
 * @param firstLine - 日志文件首行（不含末尾换行）。
 * @returns 解析出的头信息；首行非法时为 undefined。
 */
export function parseHeaderMeta(firstLine: string): SessionHeader | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine)
  } catch {
    return undefined
  }
  if (!isHeaderLine(parsed)) return undefined
  return fromHeaderLine(parsed)
}
