
/**
 * On-disk JSON unit format: the file is always the current net state, kept
 * human-readable (pretty-printed, stable key order from insertion) — that
 * legibility is this backend's reason to exist. `single`-layout units are
 * one document with a unit header; `per-record`-layout units are a directory
 * with one version-stamped document per record (`<table>/<key>.json`) plus a
 * `global.json` for the global slot, so a write rewrites one record instead
 * of the whole unit.
 * @module @deepseek-ai/dsh-storage-json/src/format
 */
/*
 * 模块总览：文件内容永远是"当前净状态"，不写追加日志。保持人类可读是
 * JSON 后端区别于 SQLite 后端的核心卖点。
 */

/*
 * 【文件职责】定义可读 JSON 存储格式；
 * single 保存整个单元，per-record 为各记录保存独立的带版本文档。
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/** In-memory authoritative state of one unit; the file is its projection. `global` is `null` until first written. */
/*
 * 一个单元的内存权威态；磁盘文件只是它的投影。
 * global 在首次写入前为 null（与领域层的"从未写入"哨兵语义一致）。
 */
export interface UnitState {
  version: number
  global: unknown
  tables: Map<string, Map<string, unknown>>
}

/**
 * Serialize a unit state to file content.
 * @param name - Unit name, stamped into the header.
 * @param state - Authoritative in-memory state.
 * @returns pretty-printed JSON document with a trailing newline.
 */
/*
 * 把单元内存态序列化为文件内容。
 * 结构：{ unit: { name, version }, global, tables }；美化打印（2 空格缩进）并以换行结尾。
 * @param name 单元名，盖进文件头。
 * @param state 权威内存态。
 * @returns 带尾换行的美化 JSON 文档。
 */
export function serialize(name: string, state: UnitState): string {
  // 把 Map 形式的内存表展开成普通对象（Object.fromEntries 保留插入顺序）。
  const tables: Record<string, Record<string, unknown>> = {}
  for (const [table, records] of state.tables) {
    tables[table] = Object.fromEntries(records)
  }
  const document = {
    unit: { name, version: state.version },
    global: state.global,
    tables,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * Parse file content into unit state, validating shape and version.
 * @param text - Raw file content.
 * @param descriptor - Expected identity; version mismatch rejects.
 * @returns the parsed state.
 */
/*
 * 把文件内容解析成单元状态，并校验形状与版本。四步失败依次为：
 * 非法 JSON → malformed-medium；顶层不是对象 → malformed-medium；单元头缺失或
 * 名字不符 → malformed-medium；version 与预期不符 → version-mismatch；表不是普通
 * 对象 → malformed-medium。
 * @param text 原始文件内容。
 * @param descriptor 期望的身份；版本不一致会拒绝。
 * @returns 解析出的状态。
 */
export function parse(text: string, descriptor: KvUnitDescriptor): UnitState {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch (error) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': file is not valid JSON`, { cause: error })
  }
  if (typeof document !== 'object' || document === null) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': file is not a JSON object`)
  }
  const { unit, global: globalValue, tables } = document as Record<string, unknown>
  // 单元头校验：必须是对象、名字与预期一致、version 是数字。
  if (
    typeof unit !== 'object' || unit === null ||
    (unit as Record<string, unknown>)['name'] !== descriptor.name ||
    typeof (unit as Record<string, unknown>)['version'] !== 'number'
  ) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': missing or foreign unit header`)
  }
  const version = (unit as Record<string, unknown>)['version'] as number
  // 版本校验：介质盖的版本戳与当前代码期望不一致，拒绝读取（防不兼容旧格式）。
  if (version !== descriptor.version) {
    throw new StorageError(
      'version-mismatch',
      `unit '${descriptor.name}': stored version ${version} != expected ${descriptor.version}`,
    )
  }
  if (typeof tables !== 'object' || tables === null) {
    throw new StorageError('malformed-medium', `unit '${descriptor.name}': tables is not an object`)
  }
  const state: UnitState = { version, global: globalValue ?? null, tables: new Map() }
  // 按描述符声明的每张表装载记录：表字段缺失按空表处理；存在则必须是普通对象
  // （不能是数组），再逐条进 Map。
  for (const table of descriptor.tables) {
    const records = (tables as Record<string, unknown>)[table]
    if (records === undefined) {
      state.tables.set(table, new Map())
      continue
    }
    if (typeof records !== 'object' || records === null || Array.isArray(records)) {
      throw new StorageError('malformed-medium', `unit '${descriptor.name}': table '${table}' is not an object`)
    }
    state.tables.set(table, new Map(Object.entries(records as Record<string, unknown>)))
  }
  return state
}

/**
 * Serialize one per-record document: the unit's version stamp plus the
 * record value, pretty-printed like the whole-unit document.
 * @param version - Unit format version, stamped into the header.
 * @param value - The record value (or the global singleton value).
 * @returns pretty-printed JSON document with a trailing newline.
 */
export function serializeRecord(version: number, value: unknown): string {
  return `${JSON.stringify({ version, record: value }, null, 2)}\n`
}

/**
 * Parse one per-record document, validating its version stamp. A document
 * that is malformed or stamped with an unaccepted version is FOREIGN and
 * reads as absent — the per-record contract: one bad or stale record file
 * must not brick the whole unit, and an unaccepted version stamp discards the
 * record instead of migrating it (the whole-unit format rejects instead,
 * because there is exactly one document).
 * @param text - Raw per-record document content.
 * @param versions - Accepted unit versions (the current one plus the
 * descriptor's compatibleVersions); any other stamp discards the
 * document.
 * @returns the record value, or `undefined` for a foreign document.
 */
export function parseRecord(text: string, versions: readonly number[]): unknown {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null) return undefined
  const { version: stamped, record } = document as Record<string, unknown>
  if (typeof stamped !== 'number' || !versions.includes(stamped)) return undefined
  return record
}
