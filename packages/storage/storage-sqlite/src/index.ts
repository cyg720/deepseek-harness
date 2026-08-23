/**
 * ================================ 文件注释 ================================
 * 【文件职责】SQLite 存储后端插件：一个数据库文件托管所有路由单元，文档一行一条
 * （key TEXT / value TEXT JSON）。以 backend 名 sqlite 注册；注销函数先注销名字、
 * 再关闭介质。
 * 【技术维度】Cordis 插件 + 后端实现：SqliteStorageBackend 持有单个 DatabaseSync
 * 连接与打开单元表；open 校验名字、在 units 表施加单元版本戳/拒绝、确保记录表存在
 * （CREATE TABLE IF NOT EXISTS）。units Map 存 Promise，本身即"双开守卫"。
 * 【产品维度】适合较大规模数据的介质选择：单文件数据库、SQLite 自身保证单语句原子性、
 * STRICT 表严格类型；journal_mode 可配置（默认 wal）。
 * 【逻辑维度】按出现顺序：再导出（schema 版本与 JournalMode）→ name/inject →
 * Config 与 Config（path/journalMode）→ SqliteStorageBackend（ready 打开、units 表、
 * openUnit/materializeUnit、close/doClose）→ apply（注册并托管生命周期）。
 * 【关键边界】path 支持 :memory:（测试用）；文件权限 owner-only，但若其他主体能替换
 * 父目录中的数据库条目，本后端不保护机密性与完整性；关闭幂等（closing 缓存 doClose）；
 * 介质从未打开成功时 doClose 直接返回（失败已拒绝过所有调用方）。
 * 【新手阅读建议】先看 Config 理解两个配置项，再看 openUnit/materializeUnit 的
 * 版本戳与建表流程，最后看 doClose 理解关闭的各种分支。
 * ==========================================================================
 */
/**
 * SQLite storage backend for the storage hub: one database file hosts every
 * routed unit, document-per-row (`key TEXT` / `value TEXT` JSON). Registers
 * as backend `sqlite`; the disposer unregisters first, then closes the medium.
 * @module @deepseek-ai/dsh-storage-sqlite
 */
/**
 * 模块总览：本文件是后端插件的组装层；数据库打开/建表在 schema.ts，
 * 单元读写原语在 unit.ts。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { DatabaseSync } from 'node:sqlite'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { openDatabase, recordTableName, type JournalMode } from './schema.ts'
import { SqliteKvUnit } from './unit.ts'

// 对外再导出：物理布局版本与日志模式类型。
export { STORAGE_SQLITE_SCHEMA_VERSION, type JournalMode } from './schema.ts'

/** Cordis plugin name. */
/** 插件名：加载后枢纽上出现 sqlite 后端。 */
export const name = 'storage-sqlite'
/** The backend registers on the storage hub. */
/** 依赖注入声明：必须先有 storage 枢纽服务，后端才能登记。 */
export const inject = ['storage']

/** Plugin configuration. */
/**
 * 插件配置。
 */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  /**
   * SQLite 数据库文件的文件系统路径。特殊值 :memory: 打开进程内数据库（测试用）。
   * 在支持 POSIX 权限的文件系统上，缺失的目录与数据库按 owner-only 创建，已有路径
   * 的权限保留。文件系统设置错误（已存在数据库除外）会使 open 失败。
   * 若其他主体能替换父目录中的数据库条目，本后端不保护机密性与完整性。
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  /**
   * SQLite 的 journal_mode pragma。wal（默认值）适合本地磁盘；
   * 在 WAL 共享内存文件不可用的文件系统（网络挂载）上选回滚日志模式
   * （delete/truncate/persist）。
   */
  journalMode?: JournalMode
}

/** Schemastery validator for {@link Config}. */
/** schemastery 配置校验器：path 必填，journalMode 默认 wal。 */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
})

/**
 * The SQLite {@link StorageBackend}. Owns one `DatabaseSync` connection and
 * the open-unit table; `kv.open` validates names, enforces the per-unit
 * version stamp in `units`, and ensures the unit's record tables.
 */
/**
 * SQLite 后端实现。拥有单个 DatabaseSync 连接与打开单元表；kv.open 校验名字、
 * 在 units 表施加单元版本戳/拒绝、并确保单元的记录表存在。
 */
export class SqliteStorageBackend implements StorageBackend {
  /** The key-value facet; the only shape this backend serves. */
  /** kv 能力：本后端唯一提供的形态（facet）。 */
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  // 数据库打开完成的 Promise：所有原语都先 await 它（打开失败会传导给每个调用方）。
  private readonly ready: Promise<DatabaseSync>
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  /** 按名字记录"已打开或正在打开"的单元；其存在本身就是双开守卫。 */
  private readonly units = new Map<string, Promise<SqliteKvUnit>>()
  // 关闭过程的 Promise 缓存：close() 幂等就靠它——只执行一次 doClose。
  private closing: Promise<void> | undefined

  /**
   * @param config - Validated plugin configuration.
   */
  /**
   * @param config 已校验的插件配置。
   */
  constructor(config: Config) {
    this.ready = openDatabase(config.path, (config as Required<Config>).journalMode)
    // Mark the rejection handled: every primitive re-awaits `ready`, so an
    // open failure still surfaces to each caller; this guard only prevents an
    // unhandled-rejection crash when the failure precedes the first use.
    // 中文说明：先标记 ready 的拒绝"已处理"——每个原语都会重新 await ready，
    // 打开失败依然会传导给每个调用方；这个守卫只是防止"失败早于首次使用"时
    // 触发未处理拒绝崩溃。
    this.ready.catch(() => {})
  }

  // 打开单元（Promise 形式）：关闭检查 → 名字校验 → 双开检查 → 同步占位 → 物化。
  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) {
      return Promise.reject(new StorageError('closed', 'sqlite storage backend is closed'))
    }
    if (!UNIT_NAME_RE.test(descriptor.name)) {
      return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) {
        return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
      }
    }
    if (this.units.has(descriptor.name)) {
      return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    }
    // Reserve the name synchronously so a concurrent second open of the same
    // name rejects instead of racing past the guard during the awaits below.
    // 中文说明：同步占位，使同名单元的并发第二次 open 会被拒绝，
    // 而不是在下面 await 期间绕过守卫。
    const pending = this.materializeUnit(descriptor)
    this.units.set(descriptor.name, pending)
    // 物化失败时清理占位（打开成功则占位保留到单元 close）。
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  // 物化单元：等数据库就绪 → 检查/写入 units 版本戳 → 确保记录表存在 → 构造单元。
  private async materializeUnit(descriptor: KvUnitDescriptor): Promise<SqliteKvUnit> {
    const db = await this.ready
    const row = db.prepare('SELECT version FROM units WHERE name = ?').get(descriptor.name) as
      | { version: number }
      | undefined
    if (row === undefined) {
      // 首次出现：登记单元与它的版本戳。
      db.prepare('INSERT INTO units (name, version) VALUES (?, ?)').run(descriptor.name, descriptor.version)
    } else if (row.version !== descriptor.version) {
      // 已盖章但版本不符：拒绝（不兼容的旧格式）。
      throw new StorageError(
        'version-mismatch',
        `kv unit '${descriptor.name}' is stamped version ${row.version} on the medium, incompatible with descriptor version ${descriptor.version}`,
      )
    }
    for (const table of descriptor.tables) {
      // Both segments passed UNIT_NAME_RE, so the identifier is safe in DDL.
      // 中文说明：两个片段都过了 UNIT_NAME_RE，标识符在 DDL 里是安全的。
      db.exec(`
        CREATE TABLE IF NOT EXISTS "${recordTableName(descriptor.name, table)}" (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT
      `)
    }
    return new SqliteKvUnit(db, descriptor, () => {
      this.units.delete(descriptor.name)
    })
  }

  /**
   * Close every open unit and release the database. Idempotent; concurrent
   * and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  /**
   * 关闭所有打开的单元并释放数据库。幂等：并发与重复调用都在拆卸完成后解析。
   * @returns 介质释放完成后解析。
   */
  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  // 实际关闭：取数据库句柄 → 逐个关闭单元（含仍在途打开的）→ 关闭连接。
  private async doClose(): Promise<void> {
    let db: DatabaseSync
    try {
      db = await this.ready
    } catch {
      // The medium never opened; that failure already rejected the opener and
      // every unit call, so there is nothing left to release here.
      // 中文说明：介质从未打开成功；那次失败已经拒绝了打开者与每个单元调用，
      // 这里没有需要释放的东西，直接返回。
      return
    }
    for (const pending of [...this.units.values()]) {
      const unit = await pending.catch(() => undefined)
      await unit?.close()
    }
    db.close()
  }
}

/**
 * Register the SQLite backend as `sqlite` on the storage hub. The disposer
 * unregisters the name first, then closes the backend.
 * @param ctx - Plugin context (must inject `storage`).
 * @param config - Validated plugin configuration.
 */
/**
 * 把 SQLite 后端以 sqlite 名字注册到存储枢纽。注销函数先注销名字、再关闭后端。
 * @param ctx 插件上下文（必须注入 storage）。
 * @param config 已校验的插件配置。
 */
export function apply(ctx: Context, config: Config) {
  const backend = new SqliteStorageBackend(config)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register('sqlite', backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-sqlite.registerBackend')
  ctx.provide(storageBackendServiceKey('sqlite'), backend)
}
