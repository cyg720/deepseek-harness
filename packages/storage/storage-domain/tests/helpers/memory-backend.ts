/**
 * In-memory {@link StorageBackend} test double implementing the full KvUnit
 * primitive set. Shared test infrastructure: the domain suite uses it to
 * exercise open/route/write semantics without touching disk, and the
 * workspace package's tests import it by relative path (it lives under
 * `tests/`, never `src/`, so it stays out of the published surface).
 *
 * Fidelity to the backend contract (`dsh-storage` `src/backend.ts`): version
 * stamping and `version-mismatch` on reopen, `malformed` never (memory cannot
 * corrupt), per-call atomicity trivially, `closed` after close, delete
 * idempotence. Media survive across backends through the shared `media` map
 * passed into the constructor, which simulates process restarts; stamp
 * `versions` directly to fabricate an on-medium version and force a
 * `version-mismatch` without a prior open.
 * @module
 */
/**
 * 文件职责：验证 memory-backend.ts 覆盖的持久化存储行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的持久化存储能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'

/** One unit's medium: tables of records plus the global slot (`null` = never written). */
/** 中文说明：interface MemoryMedium 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
export interface MemoryMedium {
  tables: Map<string, Map<string, unknown>>
  global: unknown
}

/**
 * Shared media pool. Construct one and hand it to several
 * {@link MemoryStorageBackend} instances to simulate reopening the same
 * medium after a restart; `versions` holds the stamped unit versions and is
 * writable by tests to inject a mismatching on-medium version, and
 * `failNextWrites` injects write-primitive failures.
 */
/** 中文说明：class MemoryMediaPool 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
export class MemoryMediaPool {
  /** Unit name → its records; a missing entry is a never-materialized unit. */
  readonly media = new Map<string, MemoryMedium>()
  /** Unit name → stamped version; tests may pre-stamp to force `version-mismatch`. */
  readonly versions = new Map<string, number>()
  /**
   * When positive, that many subsequent write primitives (putRecord /
   * deleteRecord / setGlobal) reject without touching the medium, decrementing
   * per rejection. Negative path: callers assert their state is
   * untouched after a durability failure.
   */
  failNextWrites = 0

  /** Consume one injected failure, throwing in a rejected write's place. */
  consumeInjectedFailure(): void {
    if (this.failNextWrites > 0) {
      this.failNextWrites -= 1
      throw new Error('injected write failure')
    }
  }
}

/** In-memory KV unit over one pooled medium. */
/** 中文说明：class MemoryKvUnit 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
class MemoryKvUnit implements KvUnit {
  private closed = false

  constructor(
    private readonly pool: MemoryMediaPool,
    private readonly medium: MemoryMedium,
    private readonly descriptor: KvUnitDescriptor,
    private readonly onClose: () => void,
  ) {}

  private assertOpen(): void {
    if (this.closed) {
      throw new StorageError('closed', `memory unit '${this.descriptor.name}' is closed`)
    }
  }

  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    this.assertOpen()
    /** 中文说明：变量 tables 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tables: Record<string, Record<string, unknown>> = {}
    /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
    for (const table of this.descriptor.tables) {
      tables[table] = Object.fromEntries(this.medium.tables.get(table) ?? [])
    }
    return { tables, global: this.medium.global }
  }

  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    /** 中文说明：变量 records 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let records = this.medium.tables.get(table)
    if (records === undefined) {
      records = new Map()
      this.medium.tables.set(table, records)
    }
    records.set(key, value)
  }

  async deleteRecord(table: string, key: string): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.tables.get(table)?.delete(key)
  }

  async setGlobal(value: unknown): Promise<void> {
    this.assertOpen()
    this.pool.consumeInjectedFailure()
    this.medium.global = value
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onClose()
  }
}

/**
 * In-memory storage backend with a `kv` facet. Pass a shared
 * {@link MemoryMediaPool} to let a second instance reopen the same media;
 * omit it for a throwaway isolated pool.
 */
/** 中文说明：class MemoryStorageBackend 定义本测试所需的数据或行为，用于表达持久化存储场景。 */
export class MemoryStorageBackend implements StorageBackend {
  readonly kv: KvFacet
  private readonly openUnits = new Set<string>()
  private closed = false

  /**
   * @param pool - Media shared across instances; a fresh private pool when omitted.
   */
  constructor(readonly pool: MemoryMediaPool = new MemoryMediaPool()) {
    this.kv = {
      open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
        if (this.closed) {
          throw new StorageError('closed', 'memory backend is closed')
        }
        // Double-open is a caller bug per the backend contract; no dedicated
        // StorageError code exists for it, so a plain Error is correct.
        if (this.openUnits.has(descriptor.name)) {
          throw new Error(`memory unit '${descriptor.name}' is already open (double-open is a caller bug)`)
        }
        /** 中文说明：变量 stamped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const stamped = this.pool.versions.get(descriptor.name)
        if (stamped === undefined) {
          this.pool.versions.set(descriptor.name, descriptor.version)
        } else if (stamped !== descriptor.version) {
          throw new StorageError(
            'version-mismatch',
            `memory unit '${descriptor.name}' is stamped v${stamped}, descriptor wants v${descriptor.version}`,
          )
        }
        /** 中文说明：变量 medium 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let medium = this.pool.media.get(descriptor.name)
        if (medium === undefined) {
          medium = { tables: new Map(), global: null }
          this.pool.media.set(descriptor.name, medium)
        }
        this.openUnits.add(descriptor.name)
        return new MemoryKvUnit(this.pool, medium, descriptor, () => this.openUnits.delete(descriptor.name))
      },
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.openUnits.clear()
  }
}
