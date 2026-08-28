/**
 * Fixed physical-record compression for SQLite. Schema-owned functions
 * encode logical events and decode tagged rows before persistence consumers
 * observe them.
 * @module @deepseek-ai/dsh-session-persistence-sqlite/compression
 */
/*
 * 文件职责：实现 compression.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { readFileSync } from 'node:fs'
import { TextDecoder } from 'node:util'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import type { SessionEvent, SurfaceEventType } from '@deepseek-ai/dsh-session'
import {
  decodeSerializedChunkRow,
  /** 中文说明：type ChunkRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type ChunkRow,
  MAX_PACKED_DATA_BYTES,
  /** 中文说明：type StorageRecord 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type StorageRecord,
} from './codec.ts'
import type { EventRow } from './schema.ts'

/** One physical row ready for SQLite parameter binding. */
/* 中文说明：interface BoundRecord 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export interface BoundRecord {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: string | Uint8Array
  readonly sourceEventSeqs: Uint8Array | null
  readonly surfaceOp: string | null
  readonly isPacked: 0 | 1
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
/** 中文说明：常量 ZSTD_COMPRESSION_LEVEL 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const ZSTD_COMPRESSION_LEVEL = 3
const DELTA_TAG = 0
const RUN_TAG = 1
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_ZIGZAG_INTEGER = MAX_SAFE_INTEGER * 2n
/**
 * Schema-19 raw-content zstd dictionary for independently decodable data rows.
 * Its exact bytes are part of the physical format; changing the resource
 * requires a schema-version bump.
 */
const ZSTD_DICTIONARY = readFileSync(new URL('../resources/zstd-dictionary.bin', import.meta.url))

/** Compress options shared by every data-column frame. */
const DATA_ZSTD_OPTIONS = {
  dictionary: ZSTD_DICTIONARY,
  params: { [constants.ZSTD_c_compressionLevel]: ZSTD_COMPRESSION_LEVEL },
} as const
const CHUNK_TAGS = ['text-chunks', 'reasoning-chunks', 'tool-call-chunks'] as const
/** 中文说明：type ChunkTag 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
type ChunkTag = typeof CHUNK_TAGS[number]

/** 中文说明：函数 isChunkTag 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isChunkTag(value: string): value is ChunkTag {
  return (CHUNK_TAGS as readonly string[]).includes(value)
}

/**
 * Decode one physical SQLite row into its complete logical event span.
 * @param row - detached SQLite event row.
 * @returns every logical event represented by the row.
 */
/*
 * 中文说明：函数 decodeRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param row 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeRow(row: EventRow): SessionEvent[] {
  if (row.is_packed === 0) return [decodeScalarRow(row)]
  if (!isChunkTag(row.type)) {
    throw new Error(`malformed ${row.type} storage row: packed discriminator requires a chunk tag`)
  }
  if (row.source_event_seqs !== null || row.surface_op !== null) {
    throw new Error(`malformed ${row.type} storage row: packed surface fields must be null`)
  }
  return decodeSerializedChunkRow(
    row.type,
    row.seq,
    row.time,
    decodeData(row.data, MAX_PACKED_DATA_BYTES),
  )
}

/**
 * Convert a storage record to SQLite column values.
 * @param record - scalar event or packed chunk record.
 * @returns column values for one physical insert.
 */
/*
 * 中文说明：函数 bindRecord 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param record 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function bindRecord(record: StorageRecord): BoundRecord {
  if (isChunkRow(record)) {
    return {
      seq: record.seq0,
      type: record.type,
      time: record.time0,
      data: encodeData(JSON.stringify(record.data)),
      sourceEventSeqs: null,
      surfaceOp: null,
      isPacked: 1,
    }
  }
  /** 中文说明：变量 event 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const event = record
  /** 中文说明：变量 surface 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const surface = event as SessionEvent<SurfaceEventType>
  return {
    seq: event.seq,
    type: event.type,
    time: event.time,
    data: encodeData(JSON.stringify(event.data)),
    sourceEventSeqs: surface.sourceEventSeqs === undefined
      ? null
      : encodeSourceEventSeqs(surface.sourceEventSeqs),
    surfaceOp: surface.surfaceOp === undefined ? null : JSON.stringify(surface.surfaceOp),
    isPacked: 0,
  }
}

/** 中文说明：函数 encodeData 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function encodeData(serialized: string): string | Uint8Array {
  /** 中文说明：变量 bytes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const bytes = Buffer.from(serialized)
  const compressed = zstdCompressSync(bytes, DATA_ZSTD_OPTIONS)
  return compressed.length < bytes.length ? compressed : serialized
}

/** 中文说明：函数 decodeData 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function decodeData(value: string | Uint8Array, maxOutputLength?: number): string {
  if (typeof value === 'string') return value
  /** 中文说明：变量 decoded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const decoded = maxOutputLength === undefined
    ? zstdDecompressSync(value, { dictionary: ZSTD_DICTIONARY })
    : zstdDecompressSync(value, { dictionary: ZSTD_DICTIONARY, maxOutputLength })
  return UTF8_DECODER.decode(decoded)
}

/** 中文说明：函数 encodeSourceEventSeqs 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function encodeSourceEventSeqs(values: readonly number[]): Uint8Array {
  if (values.length === 0) return new Uint8Array()
  const deltas = [DELTA_TAG]
  let previous = 0n
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] as number
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('sourceEventSeqs must contain non-negative safe integers')
    }
    const current = BigInt(value)
    const encoded = index === 0
      ? current
      : current >= previous
        ? (current - previous) * 2n
        : ((previous - current) * 2n) - 1n
    appendVarint(deltas, encoded)
    previous = current
  }
  if (!isStrictlyIncreasing(values)) return Uint8Array.from(deltas)

  const runs = [RUN_TAG]
  let start = values[0] as number
  let end = start
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index] as number
    if (value === end + 1) {
      end = value
      continue
    }
    appendVarint(runs, BigInt(start))
    appendVarint(runs, BigInt(end - start + 1))
    start = value
    end = start
  }
  appendVarint(runs, BigInt(start))
  appendVarint(runs, BigInt(end - start + 1))
  return Uint8Array.from(runs.length < deltas.length ? runs : deltas)
}

function isStrictlyIncreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] as number))
}

/** 中文说明：函数 appendVarint 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function appendVarint(bytes: number[], value: bigint): void {
  /** 中文说明：变量 remaining 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let remaining = value
  while (remaining >= 0x80n) {
    bytes.push(Number(remaining & 0x7fn) | 0x80)
    remaining >>= 7n
  }
  bytes.push(Number(remaining))
}

function decodeSourceEventSeqs(bytes: Uint8Array, maxEntries: number): number[] {
  if (bytes.length === 0) return []
  if (bytes.length === 1) {
    throw new Error('malformed source_event_seqs storage value: truncated tagged payload')
  }
  switch (bytes[0]) {
    case DELTA_TAG: return decodeDeltaVarints(bytes, 1)
    case RUN_TAG: return decodeRunVarints(bytes, 1, maxEntries)
    default: throw new Error('malformed source_event_seqs storage value: unknown encoding tag')
  }
}

function decodeDeltaVarints(bytes: Uint8Array, offset: number): number[] {
  const values: number[] = []
  /** 中文说明：变量 previous 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let previous = 0n
  while (offset < bytes.length) {
    /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = values.length === 0
    /** 中文说明：变量 decoded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decoded = readVarint(bytes, offset, first ? MAX_SAFE_INTEGER : MAX_ZIGZAG_INTEGER)
    offset = decoded.offset
    /** 中文说明：变量 delta 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delta = first
      ? decoded.value
      : (decoded.value & 1n) === 0n
        ? decoded.value / 2n
        : -((decoded.value + 1n) / 2n)
    /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = first ? delta : previous + delta
    if (value < 0n || value > MAX_SAFE_INTEGER) {
      throw new Error('malformed source_event_seqs storage value: decoded seq is out of range')
    }
    values.push(Number(value))
    previous = value
  }
  return values
}

function decodeRunVarints(bytes: Uint8Array, offset: number, maxEntries: number): number[] {
  const values: number[] = []
  let previousEnd = -1
  while (offset < bytes.length) {
    const start = readVarint(bytes, offset, MAX_SAFE_INTEGER)
    const count = readVarint(bytes, start.offset, MAX_SAFE_INTEGER)
    offset = count.offset
    const first = Number(start.value)
    const length = Number(count.value)
    if (length < 1) {
      throw new Error('malformed source_event_seqs storage value: run count must be positive')
    }
    if (first <= previousEnd || !Number.isSafeInteger(first + length - 1)) {
      throw new Error('malformed source_event_seqs storage value: runs must ascend within safe integers')
    }
    if (length > maxEntries - values.length) {
      throw new Error('malformed source_event_seqs storage value: run exceeds its event sequence')
    }
    for (let index = 0; index < length; index += 1) values.push(first + index)
    previousEnd = first + length - 1
  }
  return values
}

function readVarint(
  bytes: Uint8Array,
  offset: number,
  limit: bigint,
): { readonly value: bigint; readonly offset: number } {
  /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let value = 0n
  /** 中文说明：变量 shift 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let shift = 0n
  while (offset < bytes.length) {
    /** 中文说明：变量 byte 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const byte = bytes[offset] as number
    offset += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      if (shift > 0n && (byte & 0x7f) === 0) {
        throw new Error('malformed source_event_seqs storage value: non-canonical varint')
      }
      if (value > limit) {
        throw new Error('malformed source_event_seqs storage value: varint is out of range')
      }
      return { value, offset }
    }
    shift += 7n
    if (shift > 56n) {
      throw new Error('malformed source_event_seqs storage value: varint is out of range')
    }
  }
  throw new Error('malformed source_event_seqs storage value: truncated varint')
}

/** 中文说明：函数 isChunkRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isChunkRow(record: StorageRecord): record is ChunkRow {
  return isChunkTag(record.type) && 'seq0' in record && !('seq' in record)
}

/** 中文说明：函数 decodeScalarRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function decodeScalarRow(row: EventRow): SessionEvent {
  /** 中文说明：变量 surfaceFields 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const surfaceFields = {
    ...row.source_event_seqs === null
      ? {}
      : { sourceEventSeqs: decodeSourceEventSeqs(row.source_event_seqs, row.seq) },
    ...row.surface_op === null
      ? {}
      : { surfaceOp: JSON.parse(row.surface_op) as SessionEvent<SurfaceEventType>['surfaceOp'] },
  }
  return {
    type: row.type as SessionEvent['type'],
    seq: row.seq,
    time: row.time,
    data: JSON.parse(decodeData(row.data)) as SessionEvent['data'],
    ...surfaceFields,
  } as SessionEvent
}

/**
 * Validate and flatten physical rows into their logical prefix. A malformed
 * row or logical gap is committed corruption when a later valid turn end
 * exists; otherwise it starts a removable physical tail.
 * @param rows - physical rows ordered by their first logical sequence.
 * @param base - logical sequence expected from the first selected row.
 * @returns the contiguous logical prefix and optional physical deletion base.
 */
/*
 * 中文说明：函数 scanRows 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param rows 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param base 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scanRows(
  rows: readonly EventRow[],
  base = 0,
): { preserved: SessionEvent[]; tornFrom?: number } {
  /** 中文说明：变量 lastTurnEndRow 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let lastTurnEndRow = -1
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    try {
      if (decodeRow(rows[index] as EventRow).some(event => event.type === 'turn/end')) {
        lastTurnEndRow = index
        break
      }
    } catch {
      // A malformed row cannot prove that an earlier physical prefix committed.
    }
  }

  /** 中文说明：变量 preserved 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const preserved: SessionEvent[] = []
  /** 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let expected = base
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    /** 中文说明：变量 physical 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const physical = rows[rowIndex] as EventRow
    /** 中文说明：变量 logicalEvents 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let logicalEvents: SessionEvent[] | undefined
    try {
      logicalEvents = decodeRow(physical)
    } catch {
      // The committed-prefix rule below owns whether this invalid row is fatal or repairable.
    }
    if (logicalEvents === undefined) {
      if (rowIndex <= lastTurnEndRow) {
        throw new Error(`corrupt session log: invalid committed physical row at seq ${physical.seq}`)
      }
      return { preserved, tornFrom: physical.seq }
    }
    /** 中文说明：变量 contiguous 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let contiguous = true
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const event of logicalEvents) {
      if (event.seq !== expected) {
        contiguous = false
        break
      }
      expected += 1
    }
    if (!contiguous) {
      if (rowIndex <= lastTurnEndRow) {
        throw new Error(`corrupt session log: invalid committed physical row at seq ${physical.seq}`)
      }
      return { preserved, tornFrom: physical.seq }
    }
    preserved.push(...logicalEvents)
  }
  return { preserved }
}
