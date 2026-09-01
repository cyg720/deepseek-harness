/**
 * Schema + open-time helpers for the SQLite storage backend: the physical
 * layout version, the database open/configure sequence (permissions, pragmas,
 * version stamp/reject), and the unit metadata tables. Unit record tables are
 * created per descriptor in `unit.ts`.
 * @module @deepseek-ai/dsh-storage-sqlite/schema
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】SQLite 存储后端的"schema 与打开期助手"：物理布局版本、数据库的
 * 打开/配置序列（权限、pragma、版本盖章/拒绝）、单元元数据表（units、unit_globals）。
 * 单元的记录表（u_<单元>_<表>）在 unit.ts 中按描述符创建。
 * 【技术维度】用 node:sqlite 的 DatabaseSync（同步 API）；物理布局版本存于
 * PRAGMA user_version，与每个单元自己的 version（units 行里的戳）正交；
 * 版本不符一律拒绝（本未发布格式不做迁移）。外键开启；journal_mode 按配置设置。
 * 【产品维度】SQLite 后端以"单文件数据库托管所有路由单元"：元数据表记录单元身份
 * 与版本戳，保证重开后能校验格式兼容性；STRICT 表保证列类型严格。
 * 【逻辑维度】按出现顺序：STORAGE_SQLITE_SCHEMA_VERSION（布局版本）→ JournalMode
 * （日志模式）→ createDatabaseFile（独占建库文件，权限 0600）→ openDatabase（打开 +
 * 配置 + 建元数据表）→ configureDatabase（pragma/版本检查/盖章）→ recordTableName
 * （物理表名派生）。
 * 【关键边界】新库最后才盖章：盖章即"布局已完整"的断言，之前任何失败都让介质保持
 * 未盖章状态（障碍清除后重开会从头重试物化）；journal_mode 排除 memory/off（静默
 * 丢弃日志持久性，与 KV 后端契约的持久性条款矛盾）。
 * 【新手阅读建议】先看 openDatabase/configureDatabase 的打开序列（权限 → pragma →
 * 版本检查 → 建表 → 盖章），再看 recordTableName 理解物理表命名。
 * ==========================================================================
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { StorageError } from '@deepseek-ai/dsh-storage'

/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`.
 * Orthogonal to each unit's own `version` (stamped per unit in the `units`
 * row). Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export const STORAGE_SQLITE_SCHEMA_VERSION = 1

/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/* jscpd:ignore-start -- deliberately mirrors the session-query-sqlite open
   sequence. Each package owns a distinct database identity and schema, so a
   shared helper would couple otherwise independent storage providers (see the
   domain KV storage Agent Note's reuse audit). */
/**
 * Exclusively create a missing database file with owner-only permissions.
 * Existing files retain their modes, and errors other than `EEXIST` propagate.
 * `DatabaseSync` reopens by path, so this does not protect confidentiality or
 * integrity when another principal can replace the database entry in its
 * parent directory.
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open the database and apply its schema and pragmas. Missing directories and
 * database files are created owner-only (`:memory:` skips filesystem setup).
 * A zero `user_version` is stamped with {@link STORAGE_SQLITE_SCHEMA_VERSION};
 * every other non-current version rejects rather than being migrated in place.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @param journalMode - validated journal pragma.
 * @returns the open handle with pragmas applied and the unit metadata tables ensured.
 */
export async function openDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configureDatabase(db, actual, journalMode)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configureDatabase(db: DatabaseSync, path: string, journalMode: JournalMode): void {
  db.exec('PRAGMA foreign_keys = ON')
  // The validated union is safe to interpolate into a non-bindable PRAGMA.
  db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
  // `PRAGMA user_version` always returns exactly one row { user_version }.
  const { user_version: onDisk } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (onDisk !== 0 && onDisk !== STORAGE_SQLITE_SCHEMA_VERSION) {
    throw new StorageError(
      'version-mismatch',
      `storage database at "${path}" has schema version ${onDisk}, incompatible with this build (${STORAGE_SQLITE_SCHEMA_VERSION})`,
    )
  }
  /* jscpd:ignore-end */
  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      name    TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS unit_globals (
      unit  TEXT PRIMARY KEY REFERENCES units(name),
      value TEXT NOT NULL
    ) STRICT
  `)
  if (onDisk === 0) {
    // Stamp fresh databases LAST: the stamp asserts the layout is complete,
    // so a failure above must leave the medium unstamped (a re-open after
    // the obstruction is cleared retries materialization from scratch).
    db.exec(`PRAGMA user_version = ${STORAGE_SQLITE_SCHEMA_VERSION}`)
  }
}

/**
 * Physical table name for one unit table. Both segments are validated against
 * `UNIT_NAME_RE` before reaching this, so the result is safe to interpolate
 * into DDL and prepared-statement text.
 * @param unit - Validated unit name.
 * @param table - Validated table name.
 * @returns the `u_<unit>_<table>` identifier.
 */
export function recordTableName(unit: string, table: string): string {
  return `u_${unit}_${table}`
}
