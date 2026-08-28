/**
 * Schema-19 physical chunk-row codec. This package owns the durable tags,
 * validation, and row-size limits independently from other persistence formats.
 * @module @deepseek-ai/dsh-session-persistence-sqlite/codec
 */
/*
 * 文件职责：实现 codec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/* jscpd:ignore-start -- schema 19 deliberately owns a frozen physical codec;
 * importing or sharing the JSONL codec would let that format mutate this database interpreter. */
/** 中文说明：type DeltaKind 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
type DeltaKind = 'text-delta' | 'reasoning-delta' | 'tool-call-delta'
/** 中文说明：type DeltaEvent 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
type DeltaEvent = SessionEvent<'assistant/chunk'>

/** 中文说明：interface RunDataBase 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
interface RunDataBase {
  readonly turn: number
  readonly step: number
  readonly index: number
  readonly dt: number[]
}

/** 中文说明：interface TextRunData 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
interface TextRunData extends RunDataBase {
  readonly texts: string[]
}

/** 中文说明：interface ToolCallRunData 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
interface ToolCallRunData extends RunDataBase {
  readonly id: Extract<StreamChunk, { type: 'tool-call-delta' }>['id']
  readonly name?: string
  readonly args: string[]
}

/** One schema-19 packed physical record. */
export type ChunkRow =
  | { readonly type: 'text-chunks'; readonly seq0: number; readonly time0: number; readonly data: TextRunData }
  | { readonly type: 'reasoning-chunks'; readonly seq0: number; readonly time0: number; readonly data: TextRunData }
  | { readonly type: 'tool-call-chunks'; readonly seq0: number; readonly time0: number; readonly data: ToolCallRunData }

/** One scalar event or schema-19 packed physical record. */
export type StorageRecord = SessionEvent | ChunkRow

/** Minimum eligible members in a packed physical record. */
/* 中文说明：常量 MIN_PACKED_ROW_MEMBERS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MIN_PACKED_ROW_MEMBERS = 3
/** Maximum logical members represented by one packed physical record. */
/* 中文说明：常量 MAX_PACKED_ROW_MEMBERS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_PACKED_ROW_MEMBERS = 1_024
/** Maximum UTF-8 bytes in one packed physical record's data column. */
/* 中文说明：常量 MAX_PACKED_DATA_BYTES 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_PACKED_DATA_BYTES = 1_048_576

/** 中文说明：函数 isRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 中文说明：函数 hasExactKeys 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

/** 中文说明：函数 classify 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function classify(event: SessionEvent): DeltaKind | undefined {
  if (event.type !== 'assistant/chunk') return undefined
  if (!hasExactKeys(event, ['type', 'seq', 'time', 'data'])) return undefined
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !Number.isSafeInteger(event.time)) return undefined
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data: unknown = event.data
  if (!isRecord(data) || !hasExactKeys(data, ['turn', 'step', 'chunk'])) return undefined
  if (typeof data.turn !== 'number' || typeof data.step !== 'number') return undefined
  /** 中文说明：变量 chunk 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunk = data.chunk
  if (!isRecord(chunk) || typeof chunk.index !== 'number') return undefined
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return hasExactKeys(chunk, ['type', 'index', 'text']) && typeof chunk.text === 'string'
        ? chunk.type
        : undefined
    case 'tool-call-delta': {
      /** 中文说明：变量 validKeys 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const validKeys = hasExactKeys(chunk, ['type', 'index', 'id', 'argumentsDelta'])
        || (hasExactKeys(chunk, ['type', 'index', 'id', 'name', 'argumentsDelta'])
          && typeof chunk.name === 'string')
      return validKeys && typeof chunk.id === 'string' && typeof chunk.argumentsDelta === 'string'
        ? chunk.type
        : undefined
    }
    default:
      return undefined
  }
}

/** 中文说明：函数 toolCallOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function toolCallOf(event: DeltaEvent): { readonly id: string; readonly name?: string } {
  return event.data.chunk as { readonly id: string; readonly name?: string }
}

/** 中文说明：函数 indexOf 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function indexOf(event: DeltaEvent): number {
  return (event.data.chunk as { readonly index: number }).index
}

/** 中文说明：函数 continues 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function continues(previous: DeltaEvent, next: DeltaEvent, kind: DeltaKind): boolean {
  if (next.seq !== previous.seq + 1 || !Number.isSafeInteger(next.time - previous.time)) return false
  if (next.data.turn !== previous.data.turn || next.data.step !== previous.data.step) return false
  if (indexOf(next) !== indexOf(previous)) return false
  if (kind !== 'tool-call-delta') return true
  /** 中文说明：变量 left 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const left = toolCallOf(previous)
  /** 中文说明：变量 right 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const right = toolCallOf(next)
  return left.id === right.id
    && Object.hasOwn(left, 'name') === Object.hasOwn(right, 'name')
    && left.name === right.name
}

/** 中文说明：函数 buildRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function buildRow(kind: DeltaKind, run: readonly DeltaEvent[]): ChunkRow {
  /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const first = run[0] as DeltaEvent
  /** 中文说明：变量 base 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const base = {
    turn: first.data.turn,
    step: first.data.step,
    index: indexOf(first),
    dt: run.slice(1).map((event, index) => event.time - (run[index] as DeltaEvent).time),
  }
  /** 中文说明：变量 envelope 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const envelope = { seq0: first.seq, time0: first.time }
  if (kind === 'tool-call-delta') {
    /** 中文说明：变量 call 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const call = toolCallOf(first)
    return {
      type: 'tool-call-chunks',
      ...envelope,
      data: {
        ...base,
        id: call.id as Extract<StreamChunk, { type: 'tool-call-delta' }>['id'],
        ...Object.hasOwn(call, 'name') ? { name: call.name as string } : {},
        args: run.map(event => (event.data.chunk as { readonly argumentsDelta: string }).argumentsDelta),
      },
    }
  }
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = {
    ...base,
    texts: run.map(event => (event.data.chunk as { readonly text: string }).text),
  }
  return kind === 'text-delta'
    ? { type: 'text-chunks', ...envelope, data }
    : { type: 'reasoning-chunks', ...envelope, data }
}

/** 中文说明：函数 packedDataBytes 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function packedDataBytes(row: ChunkRow): number {
  return Buffer.byteLength(JSON.stringify(row.data))
}

/** 中文说明：函数 emitBoundedRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function emitBoundedRun(out: StorageRecord[], kind: DeltaKind, completeRun: readonly DeltaEvent[]): void {
  /** 中文说明：变量 offset 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let offset = 0
  while (completeRun.length - offset >= MIN_PACKED_ROW_MEMBERS) {
    /** 中文说明：变量 low 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let low = MIN_PACKED_ROW_MEMBERS
    /** 中文说明：变量 high 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let high = Math.min(completeRun.length - offset, MAX_PACKED_ROW_MEMBERS)
    /** 中文说明：变量 largest 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const largest = buildRow(kind, completeRun.slice(offset, offset + high))
    if (packedDataBytes(largest) <= MAX_PACKED_DATA_BYTES) {
      out.push(largest)
      offset += high
      continue
    }
    high -= 1
    /** 中文说明：变量 accepted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let accepted = 0
    /** 中文说明：变量 acceptedRow 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let acceptedRow: ChunkRow | undefined
    while (low <= high) {
      /** 中文说明：变量 middle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const middle = Math.floor((low + high) / 2)
      /** 中文说明：变量 candidate 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const candidate = buildRow(kind, completeRun.slice(offset, offset + middle))
      if (packedDataBytes(candidate) <= MAX_PACKED_DATA_BYTES) {
        accepted = middle
        acceptedRow = candidate
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    if (accepted === 0) {
      out.push(completeRun[offset] as DeltaEvent)
      offset += 1
      continue
    }
    /* v8 ignore next -- accepted is set only with its same-branch candidate. */
    out.push(acceptedRow ?? malformed(kind, 'bounded encoder lost its accepted row'))
    offset += accepted
  }
  out.push(...completeRun.slice(offset))
}

/**
 * Pack eligible logical chunk runs into bounded schema-19 records.
 * @param events - logical events in sequence order.
 * @returns scalar and packed physical records in equivalent order.
 */
/*
 * 中文说明：函数 packChunkRuns 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param events 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function packChunkRuns(events: readonly SessionEvent[]): StorageRecord[] {
  /** 中文说明：变量 out 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const out: StorageRecord[] = []
  /** 中文说明：变量 kind 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let kind: DeltaKind | undefined
  /** 中文说明：变量 run 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let run: DeltaEvent[] = []
  /** 中文说明：函数值 flush 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const flush = (): void => {
    if (kind === undefined) out.push(...run)
    else emitBoundedRun(out, kind, run)
    kind = undefined
    run = []
  }
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const event of events) {
    /** 中文说明：变量 nextKind 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nextKind = classify(event)
    if (nextKind === undefined) {
      flush()
      out.push(event)
      continue
    }
    /** 中文说明：变量 delta 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delta = event as DeltaEvent
    /** 中文说明：变量 previous 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const previous = run.at(-1)
    if (nextKind === kind && previous !== undefined && continues(previous, delta, nextKind)) {
      run.push(delta)
      continue
    }
    flush()
    kind = nextKind
    run = [delta]
  }
  flush()
  return out
}

/** 中文说明：函数 malformed 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function malformed(tag: string, reason: string): never {
  throw new Error(`malformed ${tag} storage row: ${reason}`)
}

/** 中文说明：函数 validateRunData 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateRunData(
  tag: string,
  data: Record<string, unknown>,
  payloadKey: 'texts' | 'args',
  serializedBytes?: number,
): string[] {
  if (typeof data.turn !== 'number' || typeof data.step !== 'number' || typeof data.index !== 'number') {
    malformed(tag, 'turn/step/index must be numbers')
  }
  /** 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const payload = data[payloadKey]
  if (!Array.isArray(payload)
    || payload.length < MIN_PACKED_ROW_MEMBERS
    || payload.length > MAX_PACKED_ROW_MEMBERS
    || payload.some(member => typeof member !== 'string')) {
    malformed(tag, `${payloadKey} must contain ${MIN_PACKED_ROW_MEMBERS}..${MAX_PACKED_ROW_MEMBERS} strings`)
  }
  /** 中文说明：变量 gaps 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const gaps = data.dt
  if (!Array.isArray(gaps) || gaps.some(gap => !Number.isSafeInteger(gap))) {
    malformed(tag, 'dt must be an array of safe integers')
  }
  if (gaps.length !== payload.length - 1) malformed(tag, 'dt length must match the member count')
  if ((serializedBytes ?? Buffer.byteLength(JSON.stringify(data))) > MAX_PACKED_DATA_BYTES) {
    malformed(tag, `data exceeds ${MAX_PACKED_DATA_BYTES} UTF-8 bytes`)
  }
  return payload as string[]
}

/** 中文说明：函数 validateRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateRow(
  value: Record<string, unknown>,
  tag: ChunkRow['type'],
  serializedBytes?: number,
): ChunkRow {
  if (!hasExactKeys(value, ['type', 'seq0', 'time0', 'data'])) malformed(tag, 'invalid envelope fields')
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0) malformed(tag, 'seq0 must be non-negative')
  if (!Number.isSafeInteger(value.time0)) malformed(tag, 'time0 must be a safe integer')
  /** 中文说明：变量 data 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const data = value.data
  if (!isRecord(data)) malformed(tag, 'data must be an object')
  /** 中文说明：变量 payload 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let payload: string[]
  if (tag === 'tool-call-chunks') {
    /** 中文说明：变量 withName 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const withName = hasExactKeys(data, ['turn', 'step', 'index', 'id', 'name', 'dt', 'args'])
    if (!withName && !hasExactKeys(data, ['turn', 'step', 'index', 'id', 'dt', 'args'])) {
      malformed(tag, 'invalid tool-call data fields')
    }
    if (typeof data.id !== 'string' || (withName && typeof data.name !== 'string')) {
      malformed(tag, 'id and optional name must be strings')
    }
    payload = validateRunData(tag, data, 'args', serializedBytes)
  } else {
    if (!hasExactKeys(data, ['turn', 'step', 'index', 'dt', 'texts'])) malformed(tag, 'invalid text data fields')
    payload = validateRunData(tag, data, 'texts', serializedBytes)
  }
  if (!Number.isSafeInteger((value.seq0 as number) + payload.length - 1)) malformed(tag, 'member seqs exceed safe integers')
  /** 中文说明：变量 time 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let time = value.time0 as number
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const gap of data.dt as number[]) {
    time += gap
    if (!Number.isSafeInteger(time)) malformed(tag, 'member times exceed safe integers')
  }
  return value as unknown as ChunkRow
}

/** 中文说明：函数 expandRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function expandRow(row: ChunkRow): SessionEvent[] {
  /** 中文说明：变量 members 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const members = row.type === 'tool-call-chunks' ? row.data.args : row.data.texts
  /** 中文说明：变量 events 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const events: SessionEvent[] = []
  /** 中文说明：变量 time 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let time = row.time0
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) time += row.data.dt[index - 1] as number
    /** 中文说明：变量 chunk 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let chunk: StreamChunk
    switch (row.type) {
      case 'text-chunks':
        chunk = { type: 'text-delta', index: row.data.index, text: members[index] as string }
        break
      case 'reasoning-chunks':
        chunk = { type: 'reasoning-delta', index: row.data.index, text: members[index] as string }
        break
      case 'tool-call-chunks':
        chunk = {
          type: 'tool-call-delta',
          index: row.data.index,
          id: row.data.id,
          ...Object.hasOwn(row.data, 'name') ? { name: row.data.name as string } : {},
          argumentsDelta: members[index] as string,
        }
        break
    }
    events.push({
      type: 'assistant/chunk',
      seq: row.seq0 + index,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk },
    })
  }
  return events
}

/**
 * Decode one scalar or packed schema-19 record.
 * @param value - parsed physical-record value.
 * @returns the represented logical events.
 */
/*
 * 中文说明：函数 decodeStorageRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeStorageRecord(value: unknown): SessionEvent[] {
  if (!isRecord(value)) return [value as SessionEvent]
  /** 中文说明：变量 tag 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const tag = value.type
  if (tag !== 'text-chunks' && tag !== 'reasoning-chunks' && tag !== 'tool-call-chunks') {
    return [value as SessionEvent]
  }
  return expandRow(validateRow(value, tag))
}

/**
 * Decode one packed row from its exact uncompressed data value. The byte bound
 * rejects oversized input before JSON parsing and avoids serializing it again.
 * @param tag - validated packed physical type.
 * @param seq0 - first represented logical sequence number.
 * @param time0 - first represented logical timestamp.
 * @param serializedData - decoded SQLite data-column text.
 * @returns the represented logical events.
 */
/*
 * 中文说明：函数 decodeSerializedChunkRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param tag 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param seq0 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param time0 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param serializedData 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeSerializedChunkRow(
  tag: ChunkRow['type'],
  seq0: number,
  time0: number,
  serializedData: string,
): SessionEvent[] {
  /** 中文说明：变量 bytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bytes = Buffer.byteLength(serializedData)
  if (bytes > MAX_PACKED_DATA_BYTES) malformed(tag, `data exceeds ${MAX_PACKED_DATA_BYTES} UTF-8 bytes`)
  return expandRow(validateRow({ type: tag, seq0, time0, data: JSON.parse(serializedData) as unknown }, tag, bytes))
}
/* jscpd:ignore-end */
