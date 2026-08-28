/**
 * Lossless row packing for `assistant/chunk` delta runs. Providers stream
 * token-sized deltas, so a log stores hundreds of near-identical event lines
 * whose JSON envelopes dwarf their payloads (~56× measured on a real DeepSeek
 * session). This module packs each run of consecutive same-block delta chunks
 * into ONE storage row — `text-chunks`, `reasoning-chunks`, or
 * `tool-call-chunks` — and expands rows back to the exact original events.
 *
 * Packed rows are an encoding vocabulary, NOT session events: they never enter
 * `Session.events`, have no `SessionEventMap` entry, and use bare (slash-less)
 * type tags so a reader cannot confuse them with the event taxonomy
 * (precedent: the JSONL header line's `session` tag). Persistence and bounded
 * history transport both use the codec. The encoder whitelists exact shapes —
 * anything it does not fully recognize stays verbatim, so unknown fields or
 * future chunk variants lose compression, never data. The decoder validates
 * before expanding and fails loud on a malformed row-tagged value instead of
 * silently dropping a whole run.
 *
 * @module @deepseek-ai/dsh-session/chunk-rows
 */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】为 assistant/chunk 流增量（delta）串提供无损的存储打包：把连续同类同块的 delta
 *           chunk 事件串压成一行存储记录（text-chunks / reasoning-chunks / tool-call-chunks），
 *           并能把行精确展开回原来的事件序列。
 * 【技术维度】行程编码思想；白名单式结构分类（classify 精确匹配键集合与类型，不认识的原样存储
 *            ——丢压缩率绝不丢数据）；时间差（dt 数组）编码成员时间戳；安全整数范围校验防浮点
 *            舍入造成静默损坏；判别联合 + assertNever 兜底。
 * 【产品维度】提供方按 token 粒度流式输出，日志里会出现大量近乎雷同的事件行，JSON 信封体积远超
 *            载荷（实测约 56 倍）。打包显著缩小磁盘占用，同时保证重放时字节级还原。
 * 【逻辑维度】classify 判定事件可否打包；continues 判定是否延续同一串；buildRow 构造行；
 *           packChunkRuns 是编码主入口；validateRunData/validateRow 校验行；expandRow 展开；
 *           decodeStorageRecord 是解码主入口（行标签的值先验证后展开，其余值原样通过）。
 * 【关键边界】存储行的类型标签不带斜杠（text-chunks 等），刻意区别于事件词汇（assistant/chunk）；
 *           MIN_RUN=3 是格式常量而非可调参数；name 字段只有整串一致时才能打包；dt 允许负值
 *           （墙钟回拨）；展开时 seq/time 越出安全整数即判损坏并抛错。
 * 【新手阅读建议】先读 ChunkRow 三个变体与 RunDataBase 理解行布局，再读 packChunkRuns 的
 *           run/flush 主循环，最后读 decodeStorageRecord 体会“先验证后展开、fail loud”的策略。
 * ==========================================================================
 */

import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from './types.ts'

/** The chunk kinds that may pack; block boundaries, usage, and finish chunks always stay one event per line. */
/* 可打包的 delta 种类；块边界、usage、finish 等 chunk 永远保持一事件一行。 */
type DeltaKind = 'text-delta' | 'reasoning-delta' | 'tool-call-delta'

/** A run member: an `assistant/chunk` event whose exact shape the encoder whitelisted. */
/* 串的一员：其完整形状已被编码器白名单确认的 assistant/chunk 事件。 */
type DeltaEvent = SessionEvent<'assistant/chunk'>

/**
 * Fields shared by every packed run: placement, block correlation, and member
 * timestamps as gaps. Member `k` reconstructs as seq `seq0 + k` and time
 * `time0` plus the first `k` gaps; a gap may be negative when the wall clock
 * stepped backwards between events.
 */
/*
 * 每个打包串共享的字段：放置信息、块关联，以及以差值表示的成员时间戳。
 * 成员 k 还原为 seq0+k、time0 加上前 k 个差值；差值可为负（事件之间墙钟倒退）。
 */
interface RunDataBase {
  // 整串相同的事件所属轮次与步骤。
  turn: number
  step: number
  /** The stream block index every member shares. */
  // 所有成员共享的流块下标。
  index: number
  /** Epoch-ms gaps between consecutive members; length is one less than the member count. */
  // 相邻成员之间的纪元毫秒差；长度比成员数少一。
  dt: number[]
}

/** Payload of a `text-chunks`/`reasoning-chunks` row: one entry per member, never joined — token boundaries are data. */
/* text-chunks/reasoning-chunks 行的载荷：每成员一项，绝不拼接——token 边界本身就是数据。 */
interface TextRunData extends RunDataBase {
  // 每个成员的文本片段。
  texts: string[]
}

/** Payload of a `tool-call-chunks` row: the run-constant call identity plus each member's raw arguments fragment. */
/* tool-call-chunks 行的载荷：整串恒定的调用身份，加每个成员的原始参数片段。 */
interface ToolCallRunData extends RunDataBase {
  id: ToolCallId
  /** Present iff every member carried it, with one uniform value (a mixed run never packs). */
  // 当且仅当每个成员都携带且取值一致时才存在（混合串不打包）。
  name?: string
  // 每个成员的参数 JSON 片段。
  args: string[]
}

/**
 * A packed run of consecutive delta chunk events, discriminated on `type`.
 * `seq0`/`time0` anchor the first member; text and reasoning rows share the
 * {@link TextRunData} payload, tool-call rows carry {@link ToolCallRunData}.
 */
/*
 * 一串打包的连续 delta chunk 事件，按 type 判别。
 * seq0/time0 锚定第一个成员；文本与推理行共用 {@link TextRunData} 载荷，
 * 工具调用行携带 {@link ToolCallRunData}。
 */
export type ChunkRow =
  | { type: 'text-chunks'; seq0: number; time0: number; data: TextRunData }
  | { type: 'reasoning-chunks'; seq0: number; time0: number; data: TextRunData }
  | { type: 'tool-call-chunks'; seq0: number; time0: number; data: ToolCallRunData }

/** One durable log line's JSON value: a session event verbatim, or a packed chunk row. */
/* 一条耐久日志行的 JSON 值：原样的会话事件，或打包的 chunk 行。 */
export type StorageRecord = SessionEvent | ChunkRow

/**
 * Test whether an encoded record is a packed chunk row rather than a Session event.
 * @param record - one persistence or bounded-history encoding record.
 * @returns Whether the record is a packed chunk row.
 */
export function isChunkRow(record: StorageRecord): record is ChunkRow {
  return record.type === 'text-chunks'
    || record.type === 'reasoning-chunks'
    || record.type === 'tool-call-chunks'
}

/**
 * Number of logical Session events represented by one packed row.
 * @param row - validated or encoder-produced packed row.
 * @returns Count of consecutive chunk events in the row.
 */
export function chunkRowLength(row: ChunkRow): number {
  return row.type === 'tool-call-chunks' ? row.data.args.length : row.data.texts.length
}

/**
 * Minimum members before a run packs. Below it a row's envelope rivals the
 * event lines it replaces. A format constant, not a tunable: both layouts
 * decode identically, so changing it never invalidates stored logs.
 */
/* 打包所需的最少成员数。低于它，行信封的体积就与它所替代的事件行相当。这是格式常量而非可调项：两种布局的解码结果一致，改动它不会使已存日志失效。 */
const MIN_RUN = 3

// 判断运行时值是否为对象记录（非 null 的对象）。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Exact-key check: `value` has every key in `keys` and nothing else. */
/* 精确键检查：value 恰好拥有 keys 中的每一个键且别无其他。 */
function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
}

/**
 * Classify an event for packing: its delta kind when the ENTIRE shape
 * (envelope, data, chunk — exact keys, primitive types, integer seq/time) is
 * whitelisted, else `undefined` (store verbatim). Inputs come from live typed
 * appends AND parsed fixture files, so the checks are structural, not
 * type-trusted. Integer times keep gap encoding exact: a fractional time would
 * reconstruct through float subtraction/addition, which need not round-trip.
 */
/*
 * 为打包分类一个事件：完整形状（信封、data、chunk——精确键、原始类型、整数 seq/time）
 * 全部在白名单内时返回其 delta 种类，否则返回 undefined（按原样存储）。
 * 输入既来自实时的类型化追加，也来自解析出的夹具文件，因此检查是结构性的、不信类型。
 * 整数时间保证差值编码精确：小数时间经浮点减法再加法还原未必回到原值。
 * @param event - 待分类的会话事件。
 * @returns 可打包的 delta 种类；不可打包时为 undefined。
 */
function classify(event: SessionEvent): DeltaKind | undefined {
  if (event.type !== 'assistant/chunk') return undefined
  if (!hasExactKeys(event, ['type', 'seq', 'time', 'data'])) return undefined
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isSafeInteger(event.time)) return undefined
  const data: unknown = event.data
  if (!isRecord(data) || !hasExactKeys(data, ['turn', 'step', 'chunk'])) return undefined
  if (typeof data.turn !== 'number' || typeof data.step !== 'number') return undefined
  const chunk = data.chunk
  if (!isRecord(chunk) || typeof chunk.index !== 'number') return undefined
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return hasExactKeys(chunk, ['type', 'index', 'text']) && typeof chunk.text === 'string'
        ? chunk.type
        : undefined
    case 'tool-call-delta': {
      const shapeOk = hasExactKeys(chunk, ['type', 'index', 'id', 'argumentsDelta'])
        || (hasExactKeys(chunk, ['type', 'index', 'id', 'name', 'argumentsDelta']) && typeof chunk.name === 'string')
      return shapeOk && typeof chunk.id === 'string' && typeof chunk.argumentsDelta === 'string'
        ? chunk.type
        : undefined
    }
    // Whitelist fall-through over parsed data: block-start/end, usage, finish,
    // and any future chunk variant stay one event per line.
    // 白名单的 fall-through：针对解析数据，block-start/end、usage、finish 及未来新变体都保持一事件一行。
    default:
      return undefined
  }
}

/** The tool-call fields of a whitelisted delta chunk (only after {@link classify} returned `'tool-call-delta'`). */
/* 取白名单 delta chunk 的工具调用字段（仅在 classify 返回 'tool-call-delta' 之后调用）。 */
function toolCallOf(event: DeltaEvent): { id: string; name?: string } {
  return event.data.chunk as { id: string; name?: string }
}

/** The block index of a whitelisted delta chunk (not every {@link StreamChunk} variant carries one). */
/* 取白名单 delta chunk 的块下标（并非每个 StreamChunk 变体都携带）。 */
function indexOf(event: DeltaEvent): number {
  return (event.data.chunk as { index: number }).index
}

/** Whether `next` extends a run ending in `prev` (same kind already checked by the caller). */
/* 判断 next 是否延续以 prev 结尾的串（同种类已由调用者确认）。要求 seq 连续、时间差为安全整数、turn/step/块下标一致；工具调用串还要求 id 相同且 name 在有无与取值上都一致。 */
function continues(prev: DeltaEvent, next: DeltaEvent, kind: DeltaKind): boolean {
  if (next.seq !== prev.seq + 1) return false
  // Two safe-integer times can sit further apart than a double subtracts
  // exactly (2^53-1 and its negation differ by ~2^54); a rounded gap would
  // decode to a different timestamp. The check is exact in both directions: a
  // true gap within safe range subtracts without rounding and passes, while a
  // true gap beyond it rounds to a value that is itself beyond and fails.
  // 两个安全整数时间的差距可能超出 double 能精确减法的范围（±(2^53-1) 相距约 2^54）；
  // 被舍入的差值会解出不符的时间戳。该检查双向精确：真实差值在安全范围内则减法无损并通过，
  // 超范围的差值舍入后自身也超范围而失败。
  if (!Number.isSafeInteger(next.time - prev.time)) return false
  if (next.data.turn !== prev.data.turn || next.data.step !== prev.data.step) return false
  if (indexOf(next) !== indexOf(prev)) return false
  if (kind !== 'tool-call-delta') return true
  const a = toolCallOf(prev)
  const b = toolCallOf(next)
  // `name` must match in presence AND value — a mixed run is not representable.
  // name 在“有无”与“取值”上都必须一致——混合串无法表示。
  return a.id === b.id && Object.hasOwn(a, 'name') === Object.hasOwn(b, 'name') && a.name === b.name
}

/** Build the row for a completed run (`run.length >= MIN_RUN`, uniform per {@link continues}). */
/* 为一个已完成的串（长度 ≥ MIN_RUN、经 continues 保证一致）构造存储行。 */
function buildRow(kind: DeltaKind, run: readonly DeltaEvent[]): ChunkRow {
  const first = run[0] as DeltaEvent
  // 串级公共字段：turn/step/块下标，以及相邻成员的时间差。
  const base = {
    turn: first.data.turn,
    step: first.data.step,
    index: indexOf(first),
    dt: run.slice(1).map((event, i) => event.time - (run[i] as DeltaEvent).time),
  }
  // 首成员锚点：seq0/time0。
  const envelope = { seq0: first.seq, time0: first.time }
  if (kind === 'tool-call-delta') {
    const call = toolCallOf(first)
    return {
      type: 'tool-call-chunks',
      ...envelope,
      data: {
        ...base,
        id: ToolCallId(call.id),
        ...Object.hasOwn(call, 'name') ? { name: call.name as string } : {},
        args: run.map(event => (event.data.chunk as { argumentsDelta: string }).argumentsDelta),
      },
    }
  }
  const data = { ...base, texts: run.map(event => (event.data.chunk as { text: string }).text) }
  return kind === 'text-delta'
    ? { type: 'text-chunks', ...envelope, data }
    : { type: 'reasoning-chunks', ...envelope, data }
}

/**
 * Pack an event batch for storage: each run of at least {@link MIN_RUN}
 * consecutive whitelisted same-kind, same-block delta chunk events becomes one
 * {@link ChunkRow}; every other event passes through verbatim, in order.
 * Pure and stateless — safe over any array, including a batch whose runs were
 * split by flush boundaries (the split runs simply pack per batch).
 *
 * @param events - the batch to encode, in log order.
 * @returns the storage records to write, one JSONL line each.
 */
/*
 * 为存储打包一批事件：每段至少 {@link MIN_RUN} 个连续的、白名单确认的同种同块 delta chunk
 * 事件压成一个 {@link ChunkRow}；其余事件按原样按序通过。纯函数、无状态——对任何数组都安全，
 * 包括被 flush 边界切开串的批次（被切开的串按批各自打包）。
 * @param events - 按日志顺序排列的待编码批次。
 * @returns 待写入的存储记录，每条对应一行 JSONL。
 */
export function packChunkRuns(events: readonly SessionEvent[]): StorageRecord[] {
  const out: StorageRecord[] = []
  // 当前累积的串种类与成员列表；flush 在种类切换或批次结束时统一结算。
  let kind: DeltaKind | undefined
  let run: DeltaEvent[] = []
  // 结算当前串：够长则建行，否则原样吐回；随后复位累积状态。
  const flush = (): void => {
    if (kind !== undefined && run.length >= MIN_RUN) out.push(buildRow(kind, run))
    else out.push(...run)
    kind = undefined
    run = []
  }
  for (const event of events) {
    const k = classify(event)
    if (k === undefined) {
      flush()
      out.push(event)
      continue
    }
    const delta = event as DeltaEvent
    const last = run[run.length - 1]
    if (k === kind && last !== undefined && continues(last, delta, k)) {
      run.push(delta)
      continue
    }
    flush()
    kind = k
    run = [delta]
  }
  flush()
  return out
}

/** Throw the uniform malformed-row diagnostic. */
/* 抛出统一格式的畸形行诊断错误。 */
function malformed(tag: string, why: string): never {
  throw new Error(`malformed ${tag} storage row: ${why}`)
}

/** Validate the shared run-data fields and the payload/dt arity; returns the member payload. */
/* 校验串共享字段与载荷/时间差的元素个数关系；返回成员载荷数组。 */
function validateRunData(tag: string, data: Record<string, unknown>, payloadKey: 'texts' | 'args'): string[] {
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
    malformed(tag, 'turn/step/index must be numbers')
  }
  const payload = data[payloadKey]
  if (!Array.isArray(payload) || payload.length === 0 || payload.some(entry => typeof entry !== 'string')) {
    malformed(tag, `${payloadKey} must be a non-empty string array`)
  }
  const dt = data.dt
  if (!Array.isArray(dt) || dt.some(gap => !Number.isSafeInteger(gap))) {
    malformed(tag, 'dt must be an array of safe integers')
  }
  if (dt.length !== payload.length - 1) {
    malformed(tag, `dt length ${dt.length} does not match ${payload.length} members`)
  }
  return payload as string[]
}

/** Validate a row-tagged parsed value's envelope and data, throwing on any malformation. */
/* 校验带行标签的已解析值的信封与数据，发现任何畸形即抛错；通过后原值按 ChunkRow 返回。 */
function validateRow(value: Record<string, unknown>, tag: ChunkRow['type']): ChunkRow {
  if (!hasExactKeys(value, ['type', 'seq0', 'time0', 'data'])) {
    malformed(tag, 'envelope must be exactly {type, seq0, time0, data}')
  }
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0) {
    malformed(tag, 'seq0 must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(value.time0)) {
    malformed(tag, 'time0 must be a safe integer')
  }
  const data = value.data
  if (!isRecord(data)) malformed(tag, 'data must be an object')
  let payload: string[]
  if (tag === 'tool-call-chunks') {
    const withName = hasExactKeys(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args'])
    if (!withName && !hasExactKeys(data, ['turn', 'step', 'index', 'id', 'dt', 'args'])) {
      malformed(tag, 'data must be exactly {turn, step, index, id, name?, dt, args}')
    }
    if (typeof data.id !== 'string' || (withName && typeof data.name !== 'string')) {
      malformed(tag, 'id (and name when present) must be strings')
    }
    payload = validateRunData(tag, data, 'args')
  } else {
    if (!hasExactKeys(data, ['turn', 'step', 'index', 'dt', 'texts'])) {
      malformed(tag, 'data must be exactly {turn, step, index, dt, texts}')
    }
    payload = validateRunData(tag, data, 'texts')
  }
  // Reconstruction bounds. The encoder only packs runs whose member seqs and
  // times are all safe integers, so a running value that leaves safe range is
  // outside any encoder's image: float arithmetic would round it to a
  // different number than exact arithmetic, a silent corruption. Within safe
  // range every step is exact, so the first departure is always caught.
  if (payload.length - 1 > Number.MAX_SAFE_INTEGER - (value.seq0 as number)) {
    malformed(tag, 'member seqs must stay safe integers')
  }
  let time = value.time0 as number
  for (const gap of data.dt as number[]) {
    time += gap
    if (!Number.isSafeInteger(time)) malformed(tag, 'member times must stay safe integers')
  }
  return value as unknown as ChunkRow
}

/** Expand a validated row back into its exact original events, in order. */
/* 把一个已校验的行按序精确展开回原始事件。 */
function expandRow(row: ChunkRow): SessionEvent[] {
  // 成员载荷、还原出的事件列表与游动的时间累加器。
  const members = row.type === 'tool-call-chunks' ? row.data.args : row.data.texts
  const events: SessionEvent[] = []
  let time = row.time0
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += row.data.dt[k - 1] as number
    let chunk: StreamChunk
    switch (row.type) {
      case 'text-chunks':
        chunk = { type: 'text-delta', index: row.data.index, text: members[k] as string }
        break
      case 'reasoning-chunks':
        chunk = { type: 'reasoning-delta', index: row.data.index, text: members[k] as string }
        break
      case 'tool-call-chunks':
        chunk = {
          type: 'tool-call-delta',
          index: row.data.index,
          id: row.data.id,
          ...Object.hasOwn(row.data, 'name') ? { name: row.data.name as string } : {},
          argumentsDelta: members[k] as string,
        }
        break
      /* v8 ignore next 4 -- validateRow only returns the three row tags */
      default: {
        const unreachable: never = row
        throw new Error(`chunk-rows received unsupported row ${String(unreachable)}`)
      }
    }
    events.push({
      type: 'assistant/chunk',
      seq: row.seq0 + k,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    })
  }
  return events
}

/**
 * Decode one parsed JSONL line value into the session event(s) it stores.
 * Chunk-row-tagged values validate and expand (a malformed row throws — it is
 * corrupt storage, and treating it as an event would silently drop a whole
 * run); every other value passes through as a single event, unvalidated.
 *
 * @param value - one line's `JSON.parse` result.
 * @returns the stored events, in log order.
 */
/*
 * 把一条已解析的 JSONL 行值解码为它存储的会话事件。
 * 带行标签的值先校验再展开（畸形行直接抛错——那是损坏的存储，当作事件处理会静默丢掉整串）；
 * 其余值不经校验、作为单条事件原样通过。
 * @param value - 一行的 JSON.parse 结果。
 * @returns 按日志顺序排列的所存事件。
 */
export function decodeStorageRecord(value: unknown): SessionEvent[] {
  if (!isRecord(value)) return [value as SessionEvent]
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
    return [value as SessionEvent]
  }
  return expandRow(validateRow(value, tag))
}
