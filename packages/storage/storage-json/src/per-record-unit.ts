/*
 * 【文件职责】实现按记录存储的 JSON 单元，每次读取重新观察目录、写入完成耐久文件操作；
 * 内存表及串行链由领域层持有。
 */

import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Dirent } from 'node:fs'
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { writeAtomic } from './atomic.ts'
import { parseRecord, serializeRecord } from './format.ts'
import type { UnitState } from './format.ts'

/** Keys become path segments in this layout; this set is path-safe on every OS.
 * @remarks 中文说明：常量说明：SAFE_KEY_RE 用于处理 SAFE_KEY_RE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Open one `per-record`-layout unit under `root`: the unit directory is
 * `<root>/<name>/`. Loads lazily on the first `loadAll` — this unit holds no
 * state, so opening touches nothing on the medium.
 * @param descriptor - Static identity and shape of the unit.
 * @param root - Absolute backend root directory.
 * @param onClose - Backend callback releasing the unit's open-slot.
 * @returns the opened unit.
 * @remarks 中文说明：功能说明：打开 Per Record Unit 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：descriptor（KvUnitDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：root（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：onClose（() =>
 * void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<KvUnit>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 openPerRecordUnit(descriptor, root,
 * onClose)，并按返回类型处理结果。
 */
// oxlint-disable-next-line typescript/require-await -- async keeps both openers' call sites uniform
export async function openPerRecordUnit(
  descriptor: KvUnitDescriptor,
  root: string,
  onClose: () => void,
): Promise<KvUnit> {
  return new PerRecordJsonUnit(descriptor, join(root, descriptor.name), onClose)
}

/**
 * Read every record document under the unit directory: each declared table's
 * `<key>.json` files plus `global.json`. A missing directory is the empty
 * unit (materialization defers to the first write); a foreign document
 * (missing, malformed, or stamped with an unaccepted version) reads as an absent
 * record, per the per-record contract.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - Absolute unit directory path.
 * @returns the authoritative state reconstructed from the tree.
 * @remarks 中文说明：功能说明：加载 Per Record State 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：descriptor（KvUnitDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：dir（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<UnitState>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * loadPerRecordState(descriptor, dir)，并按返回类型处理结果。
 */
async function loadPerRecordState(descriptor: KvUnitDescriptor, dir: string): Promise<UnitState> {
  const versions = acceptedStamps(descriptor)
  const state: UnitState = {
    version: descriptor.version,
    global: null,
    tables: new Map(descriptor.tables.map(table => [table, new Map<string, unknown>()])),
  }
  /**
   * 变量说明：entries 用于处理 entries 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let entries: Dirent[] | undefined
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Missing directory = empty unit; the legacy bootstrap below still runs
    // (the fresh-upgrade shape is exactly an absent new tree).
  }
  /**
   * 常量说明：hasNewDocuments 用于判断是否包含 New Documents 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  const hasNewDocuments = entries === undefined
    ? false
    : (await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        /**
         * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const records = state.tables.get(entry.name)
        if (records !== undefined) {
          return loadTableRecords(records, versions, join(dir, entry.name))
        }
      }
      if (entry.name === 'global.json' && descriptor.hasGlobal) {
        const global = await readRecord(join(dir, entry.name), versions)
        if (global !== undefined) state.global = global
        return true
      }
      return false
    }))).some(Boolean)
  if (!hasNewDocuments) await bootstrapLegacyUnit(descriptor, dir, state)
  return state
}

/** The version stamps this unit reads as its own: current plus declared compatible versions. */
function acceptedStamps(descriptor: KvUnitDescriptor): readonly number[] {
  return [descriptor.version, ...descriptor.compatibleVersions ?? []]
}

/**
 * Bootstrap an empty per-record tree from a legacy whole-unit file
 * (`<root>/<name>.json`, the pre-per-record layout). Every declared-table
 * record is copied into a current-version document, while the legacy file is
 * retained unchanged. A missing, foreign (another unit's name), malformed,
 * or non-unit legacy file is left alone, and so is one whose stored unit
 * version is outside the accepted set — migrating records the owner never
 * vouched for would stamp them with the current version and turn a
 * discardable stale cache into schema failures at the domain layer. Other
 * read failures propagate.
 * @param descriptor - Static identity and shape of the unit.
 * @param dir - The per-record unit directory (`<root>/<name>`).
 * @param state - The empty tree state; bootstrapped records are added.
 * @remarks 中文说明：功能说明：处理 bootstrapLegacyUnit 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：descriptor（KvUnitDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：dir（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：state（UnitState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * bootstrapLegacyUnit(descriptor, dir, state)，并按返回类型处理结果。
 */
async function bootstrapLegacyUnit(descriptor: KvUnitDescriptor, dir: string, state: UnitState): Promise<void> {
  /**
   * 常量说明：legacyPath 用于处理 legacyPath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const legacyPath = join(dirname(dir), `${descriptor.name}.json`)
  /**
   * 变量说明：text 用于处理 text 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let text: string | undefined
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    text = await readFile(legacyPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  // The legacy document is runtime data: only `unit.name`, `unit.version`,
  // and the tables map shape are checked here — the record values are
  // migrated as-is and the domain layer's schemas judge them.
  let document: { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  try {
    document = JSON.parse(text) as { unit?: { name?: unknown; version?: unknown }; tables?: unknown }
  } catch {
    return // Malformed legacy file: not ours to interpret or delete.
  }
  if (document.unit?.name !== descriptor.name) return
  const stamped = document.unit.version
  if (typeof stamped !== 'number' || !acceptedStamps(descriptor).includes(stamped)) return
  const tables = document.tables
  if (typeof tables !== 'object' || tables === null) return
  /**
   * 常量说明：recordsByTable 用于处理 recordsByTable 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const recordsByTable = tables as Record<string, Record<string, unknown>>
  /**
   * 变量说明：table、records 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const [table, records] of Object.entries(recordsByTable)) {
    /**
     * 常量说明：target 用于处理 target 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const target = state.tables.get(table)
    if (target === undefined) continue
    /**
     * 变量说明：key、value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [key, value] of Object.entries(records)) {
      /**
       * 常量说明：path 用于处理 path 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const path = join(dir, table, `${key}.json`)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(descriptor.version, value))
      target.set(key, value)
    }
  }
}

/**
 * Read one declared table's record documents into `records`.
 * @returns whether the directory contains any `.json` document path,
 * independently of key safety, readability, or stored version.
 * @remarks 中文说明：功能说明：加载 Table Records 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：records（Map<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：version（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：dir（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<boolean>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadTableRecords(records,
 * version, dir)，并按返回类型处理结果。
 */
async function loadTableRecords(records: Map<string, unknown>, versions: readonly number[], dir: string): Promise<boolean> {
  const files = await readdir(dir, { withFileTypes: true })
  /**
   * 常量说明：hasDocuments 用于判断是否包含 Documents 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  const hasDocuments = files.some(file => file.name.endsWith('.json'))
  /**
   * 常量说明：loaded 用于处理 loaded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：file（由 TypeScript
   * 根据调用位置推断的类型）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(file)，
   * 并按返回类型处理结果。
   */
  const loaded = await Promise.all(files.map(async (file) => {
    if (!file.name.endsWith('.json')) return
    /**
     * 常量说明：key 用于处理 key 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const key = file.name.slice(0, -'.json'.length)
    if (!SAFE_KEY_RE.test(key)) return
    const record = await readRecord(join(dir, file.name), versions)
    if (record !== undefined) return [key, record] as const
  }))
  /**
   * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const record of loaded) {
    if (record !== undefined) records.set(...record)
  }
  return hasDocuments
}

/** Read one record document; a foreign (unreadable or stale) one reads as absent. */
async function readRecord(path: string, versions: readonly number[]): Promise<unknown> {
  try {
    return parseRecord(await readFile(path, 'utf8'), versions)
  } catch {
    return undefined
  }
}

/**
 * One opened `per-record`-layout unit. Stateless by design: the directory is
 * the medium, the domain layer owns the live memory, and each method here is
 * a single durable file operation. Write ordering belongs to the caller (the
 * domain layer's write chain), exactly like the `single`-layout unit.
 * @remarks 中文说明：类说明：PerRecordJsonUnit 用于集中封装 处理 PerRecordJsonUnit 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 storage/storage-json
 * 在对应插件或业务生命周期内创建和调用。
 */
export class PerRecordJsonUnit implements KvUnit {
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false
  /** In-flight durable writes; close() drains them before releasing the unit.
   * @remarks 中文说明：常量说明：inFlight 用于处理 inFlight 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  private readonly inFlight = new Set<Promise<void>>()

  /**
   * 功能说明：处理 PerRecordJsonUnit 相关流程；使用场景由所在模块及调用位置决定。
   * @param descriptor （KvUnitDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param dir （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param onClose （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new PerRecordJsonUnit(descriptor, dir, onClose) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly descriptor: KvUnitDescriptor,
    private readonly dir: string,
    private readonly onClose: () => void,
  ) {}

  /** Re-read the tree: the directory is the authoritative state.
   * @remarks 中文说明：功能说明：加载 All 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<{ tables:
   * Record<string, Record<string, unknown>>; global: un…；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 loadAll()，并按返回类型处理结果。 */
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    /**
     * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const state = await loadPerRecordState(this.descriptor, this.dir)
    /**
     * 常量说明：tables 用于处理 tables 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tables: Record<string, Record<string, unknown>> = {}
    /**
     * 变量说明：table、records 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [table, records] of state.tables) {
      tables[table] = Object.fromEntries(records)
    }
    return { tables, global: state.global }
  }

  /** Durably replace one record: its own document, atomically.
   * @remarks 中文说明：功能说明：处理 putRecord 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：table（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：key（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 putRecord(table, key,
   * value)，并按返回类型处理结果。 */
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    await this.tracked(this.writeDocument(join(this.tableDir(table), `${key}.json`), value))
  }

  /** Durably delete one record. Idempotent: a missing key is a no-op.
   * @remarks 中文说明：功能说明：删除 Record 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：table（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：key（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 deleteRecord(table, key)，
   * 并按返回类型处理结果。 */
  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    await this.tracked(rm(join(this.tableDir(table), `${key}.json`), { force: true }))
  }

  /**
   * Move one record's document aside as `<key>.json.bak.<YYYYMMDDHHmm>`. The
   * moved file no longer ends in `.json`, so every later read ignores it; the
   * bytes stay on disk for inspection. A same-minute backup of the same
   * key overwrites the previous backup (the newer bytes are the ones worth
   * keeping).
   */
  async backupRecord(table: string, key: string): Promise<string> {
    this.assertOpen()
    assertSafeKey(this.descriptor.name, key)
    const path = join(this.tableDir(table), `${key}.json`)
    const moved = `${path}.bak.${backupStamp(new Date())}`
    await this.tracked(rename(path, moved))
    return moved
  }

  /** Durably replace the global singleton. Only valid when declared. */
  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    if (!this.descriptor.hasGlobal) {
      throw new Error(`unit '${this.descriptor.name}' does not declare a global slot`)
    }
    await this.tracked(this.writeDocument(join(this.dir, 'global.json'), value))
  }

  /* jscpd:ignore-start -- the two unit classes are standalone; the drain/guard lifecycle mirrors the shared KvUnit contract */
  /** Drain in-flight writes and release the unit. Idempotent.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  async close(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled(this.inFlight)
      return
    }
    this.closed = true
    await Promise.allSettled(this.inFlight)
    this.onClose()
  }

  /**
   * 功能说明：断言 Open 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertOpen()，并按返回类型处理结果。
   */
  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `unit '${this.descriptor.name}' is closed`)
    }
  }
  /* jscpd:ignore-end */

  /** Resolve a declared table's directory; an undeclared table is a caller bug and throws.
   * @remarks 中文说明：功能说明：处理 tableDir 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：table（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 tableDir(table)，并按返回类型处理结果。 */
  private tableDir(table: string): string {
    if (!this.descriptor.tables.includes(table)) {
      throw new Error(`unit '${this.descriptor.name}' does not declare table '${table}'`)
    }
    return join(this.dir, table)
  }

  /** Durably replace one document, creating its parent directory.
   * @remarks 中文说明：功能说明：写入 Document 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：path（string）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 writeDocument(path,
   * value)，并按返回类型处理结果。 */
  private writeDocument(path: string, value: unknown): Promise<void> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return (async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeAtomic(path, serializeRecord(this.descriptor.version, value))
    })()
  }

  /** Track one durable write so close() drains it.
   * @remarks 中文说明：功能说明：处理 tracked 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：write（Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * tracked(write)，并按返回类型处理结果。 */
  private tracked(write: Promise<void>): Promise<void> {
    this.inFlight.add(write)
    // Swallow only on the tracking branch: the caller still awaits `write`
    // itself, so rejections stay observed exactly once.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    write.catch(() => {}).finally(() => this.inFlight.delete(write))
    return write
  }
}

/** Local-time `YYYYMMDDHHmm` suffix for backed-up documents. */
function backupStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** Reject a record key that would be unsafe as a path segment. */
function assertSafeKey(unit: string, key: string): void {
  if (!SAFE_KEY_RE.test(key)) {
    throw new Error(`unit '${unit}': per-record key '${key}' is not path-safe (must match ${SAFE_KEY_RE})`)
  }
}
