/**
 * SQLite schema ownership and durable-row validation.
 * @module @deepseek-ai/dsh-session-persistence-sqlite/schema
 */
/*
 * 文件职责：实现 schema.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import {
  SessionId,
  /** 中文说明：type SessionHeader 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import { sql } from './sql.ts'

/** Current physical-record schema with packed and compressed event rows. */
export const SCHEMA_VERSION = 19
/** Application id reserved for DeepSeek Harness SQLite session databases. */
/* 中文说明：常量 SESSION_PERSISTENCE_SQLITE_APPLICATION_ID 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const SESSION_PERSISTENCE_SQLITE_APPLICATION_ID = 0x44534850

/** A materialized session's metadata and monotonic revision. */
/* 中文说明：interface SessionRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export interface SessionRow {
  readonly id: string
  readonly version: number
  readonly created_at: number
  readonly cwd: string | null
  readonly parent_session: string | null
  readonly seed_length: number | null
  readonly origin: 'subagent' | null
  readonly incarnation: string
  readonly revision: number
  readonly delegation_depth: number | null
  readonly agent_preset: string | null
}

/** One physical event row; packed rows may represent multiple logical events. */
/* 中文说明：interface EventRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export interface EventRow {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: string | Uint8Array
  readonly source_event_seqs: Uint8Array | null
  readonly surface_op: string | null
  readonly is_packed: 0 | 1
}

/** Durable journal modes accepted by the backend. */
/* 中文说明：type JournalMode 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** 中文说明：interface SchemaObjectRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
interface SchemaObjectRow {
  readonly type: string
  readonly name: string
  readonly tbl_name: string
  readonly sql: string
}

/** 中文说明：常量 UUID 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
/** 中文说明：常量 JOURNAL_BUSY_RETRY_INTERVAL_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const JOURNAL_BUSY_RETRY_INTERVAL_MS = 10
/** 中文说明：type DatabaseSyncConstructor 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
type DatabaseSyncConstructor = typeof import('node:sqlite')['DatabaseSync']

/**
 * Open and validate a SQLite session database.
 * @param Database - lazily imported Node SQLite constructor.
 * @param path - SQLite path, including `:memory:`.
 * @param journalMode - validated journal pragma.
 * @param busyTimeoutMs - validated maximum wait for a competing SQLite lock.
 * @returns the configured database handle.
 * @throws when connection settings, schema ownership, or SQLite setup cannot be validated.
 */
/*
 * 中文说明：函数 openDatabase 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param Database 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param path 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param journalMode 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param busyTimeoutMs 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function openDatabase(
  Database: DatabaseSyncConstructor,
  path: string,
  journalMode: JournalMode,
  busyTimeoutMs: number,
): Promise<DatabaseSync> {
  /** 中文说明：变量 deadline 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const deadline = performance.now() + busyTimeoutMs
  /** 中文说明：变量 db 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const db = new Database(path, { timeout: busyTimeoutMs })
  try {
    configureConnectionSecurity(db, path)
    configureDatabase(Database, db, path)
    await selectJournalMode(db, path, journalMode, deadline)
    configureDurability(db, path)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

/** 中文说明：函数 configureConnectionSecurity 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function configureConnectionSecurity(db: DatabaseSync, path: string): void {
  db.exec(sql('trusted-schema-off'))
  /** 中文说明：变量 trustedSchema 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const trustedSchema = integerField(db.prepare(sql('select-trusted-schema')).get(), 'trusted_schema')
  /* v8 ignore next 3 -- supported SQLite versions return the fixed setting. */
  if (trustedSchema !== 0) {
    throw new Error(`session database at "${path}" retained trusted_schema=${trustedSchema}, expected 0`)
  }
  db.exec(sql('mmap-off'))
  if (path === ':memory:') return
  /** 中文说明：变量 mmapSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const mmapSize = integerField(db.prepare(sql('select-mmap-size')).get(), 'mmap_size')
  /* v8 ignore next 3 -- supported file-backed SQLite connections return the fixed setting. */
  if (mmapSize !== 0) {
    throw new Error(`session database at "${path}" retained mmap_size=${mmapSize}, expected 0`)
  }
}

/** 中文说明：函数 configureDatabase 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function configureDatabase(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  db.exec(sql('page-size'))
  db.exec(sql('foreign-keys-on'))
  /** 中文说明：变量 began 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let began = false
  try {
    db.exec(sql('begin-immediate'))
    began = true
    /** 中文说明：变量 onDisk 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const onDisk = integerField(db.prepare(sql('select-user-version')).get(), 'user_version')
    /** 中文说明：变量 applicationId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const applicationId = integerField(db.prepare(sql('select-application-id')).get(), 'application_id')
    /** 中文说明：变量 userObjectCount 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const userObjectCount = integerField(db.prepare(sql('select-user-object-count')).get(), 'count')
    if (onDisk === 0 && (applicationId !== 0 || userObjectCount > 0)) {
      throw new Error(`session database at "${path}" has an unversioned schema or application identity`)
    }
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new Error(
        `session database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    if (onDisk !== 0 && applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID) {
      throw new Error(
        `session database at "${path}" has application id ${applicationId}, expected ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}`,
      )
    }
    if (onDisk === 0) initializeDatabase(db)
    validateRequiredSchema(Database, db, path)
    db.exec(sql('commit'))
    began = false
  } catch (error: unknown) {
    /* v8 ignore else -- a failed begin leaves no transaction to roll back. */
    if (began) {
      /* v8 ignore next 5 -- retain the original ownership failure if rollback fails too. */
      try {
        db.exec(sql('rollback'))
      } catch {
        // The original database-ownership failure remains actionable.
      }
    }
    throw error
  }
}

/** 中文说明：函数 selectJournalMode 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function selectJournalMode(
  db: DatabaseSync,
  path: string,
  journalMode: JournalMode,
  deadline: number,
): Promise<void> {
  /** 中文说明：变量 result 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let result: unknown
  while (true) {
    try {
      result = db.prepare(sql(journalResource(journalMode))).get()
      break
    } catch (error: unknown) {
      /** 中文说明：变量 remainingMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const remainingMs = Math.max(0, Math.ceil(deadline - performance.now()))
      if (!isSqliteBusy(error) || remainingMs === 0) throw error
      await delay(Math.min(JOURNAL_BUSY_RETRY_INTERVAL_MS, remainingMs))
      if (performance.now() >= deadline) throw error
    }
  }
  /** 中文说明：变量 selected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const selected = stringField(result, 'journal_mode').toLowerCase()
  /** 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const expected = path === ':memory:' ? 'memory' : journalMode
  /* v8 ignore next 3 -- SQLite returns the selected mode from these fixed, valid pragmas. */
  if (selected !== expected) {
    throw new Error(`session database at "${path}" selected journal mode ${selected}, expected ${expected}`)
  }
}

/** 中文说明：函数 configureDurability 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function configureDurability(db: DatabaseSync, path: string): void {
  db.exec(sql('synchronous-full'))
  /** 中文说明：变量 synchronous 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const synchronous = integerField(db.prepare(sql('select-synchronous')).get(), 'synchronous')
  /* v8 ignore next 3 -- supported SQLite versions return the fixed setting. */
  if (synchronous !== 2) {
    throw new Error(`session database at "${path}" retained synchronous=${synchronous}, expected FULL (2)`)
  }
}

/** 中文说明：函数 isSqliteBusy 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function isSqliteBusy(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && Reflect.get(error, 'errcode') === 5
}

/** 中文说明：函数 journalResource 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function journalResource(mode: JournalMode):
  | 'journal-mode-wal'
  | 'journal-mode-delete'
  | 'journal-mode-truncate'
  | 'journal-mode-persist' {
  switch (mode) {
    case 'wal': return 'journal-mode-wal'
    case 'delete': return 'journal-mode-delete'
    case 'truncate': return 'journal-mode-truncate'
    case 'persist': return 'journal-mode-persist'
  }
}

/** 中文说明：函数 initializeDatabase 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function initializeDatabase(db: DatabaseSync): void {
  db.exec(sql('schema'))
  db.prepare(sql('insert-persistence-state')).run(randomUUID())
  db.exec(sql('set-application-id'))
  db.exec(sql('set-user-version-19'))
}

/** 中文说明：变量 canonicalSchema 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let canonicalSchema: readonly SchemaObjectRow[] | undefined

/** 中文说明：函数 expectedSchema 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function expectedSchema(Database: DatabaseSyncConstructor): readonly SchemaObjectRow[] {
  if (canonicalSchema !== undefined) return canonicalSchema
  /** 中文说明：变量 reference 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const reference = new Database(':memory:')
  try {
    reference.exec(sql('foreign-keys-on'))
    reference.exec(sql('schema'))
    canonicalSchema = schemaObjects(reference)
    return canonicalSchema
  } finally {
    reference.close()
  }
}

/** 中文说明：函数 schemaObjects 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function schemaObjects(db: DatabaseSync): SchemaObjectRow[] {
  return db.prepare(sql('select-schema-objects')).all().map((value) => {
    /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const row = record(value, 'schema object')
    return {
      type: stringField(row, 'type'),
      name: stringField(row, 'name'),
      tbl_name: stringField(row, 'tbl_name'),
      sql: normalizeSql(stringField(row, 'sql')),
    }
  })
}

/** 中文说明：函数 normalizeSql 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function normalizeSql(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim()
}

/** 中文说明：函数 validateRequiredSchema 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function validateRequiredSchema(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  if (JSON.stringify(schemaObjects(db)) !== JSON.stringify(expectedSchema(Database))) {
    throw new Error(`session database at "${path}" does not contain the required schema objects`)
  }
}

/**
 * Recheck schema ownership inside the caller's mutation transaction.
 * @param Database - constructor used to validate the canonical schema.
 * @param db - open owned database with an active immediate transaction.
 * @param path - database location used in ownership diagnostics.
 * @throws when another writer changed the application identity, schema, or version.
 */
/*
 * 中文说明：函数 validateSchemaForMutation 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param Database 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param db 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param path 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 */
export function validateSchemaForMutation(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  /** 中文说明：变量 version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const version = integerField(db.prepare(sql('select-user-version')).get(), 'user_version')
  /** 中文说明：变量 applicationId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const applicationId = integerField(db.prepare(sql('select-application-id')).get(), 'application_id')
  if (applicationId !== SESSION_PERSISTENCE_SQLITE_APPLICATION_ID) {
    throw new Error(
      `session database application id changed before mutation (expected ${SESSION_PERSISTENCE_SQLITE_APPLICATION_ID}, got ${applicationId})`,
    )
  }
  validateRequiredSchema(Database, db, path)
  if (version !== SCHEMA_VERSION) {
    throw new Error(`session database schema changed before mutation (expected ${SCHEMA_VERSION}, got ${version})`)
  }
}

/**
 * Decode and validate one durable session row.
 * @param value - value returned by SQLite.
 * @returns a validated session row.
 */
/*
 * 中文说明：函数 decodeSessionRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeSessionRow(value: unknown): SessionRow {
  /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const row = record(value, 'stored session metadata')
  /** 中文说明：变量 id 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const id = nonemptyStringField(row, 'id')
  /** 中文说明：变量 version 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const version = safeIntegerField(row, 'version')
  /** 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cwd = nullableStringField(row, 'cwd')
  if (cwd !== null && !isAbsolute(cwd)) throw new Error('stored session cwd must be absolute')
  /** 中文说明：变量 parent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = nullableStringField(row, 'parent_session')
  /** 中文说明：变量 origin 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const origin = nullableStringField(row, 'origin')
  if (origin !== null && origin !== 'subagent') throw new Error('stored session origin must be subagent or null')
  /** 中文说明：变量 incarnation 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const incarnation = nonemptyStringField(row, 'incarnation')
  if (!UUID.test(incarnation)) throw new Error('stored session incarnation must be a UUID')
  return {
    id,
    version,
    created_at: nonnegativeSafeIntegerField(row, 'created_at'),
    cwd,
    parent_session: parent,
    seed_length: nullableNonnegativeSafeIntegerField(row, 'seed_length'),
    origin,
    delegation_depth: nullableNonnegativeSafeIntegerField(row, 'delegation_depth'),
    agent_preset: nullableStringField(row, 'agent_preset'),
    incarnation,
    revision: nonnegativeSafeIntegerField(row, 'revision'),
  }
}

/**
 * Decode and validate one durable event row before JSON interpretation.
 * @param value - value returned by SQLite.
 * @returns a validated physical event row.
 */
/*
 * 中文说明：函数 decodeEventRow 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeEventRow(value: unknown): EventRow {
  /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const row = record(value, 'stored event')
  const isPacked = safeIntegerField(row, 'is_packed')
  if (isPacked !== 0 && isPacked !== 1) {
    throw new Error('stored event is_packed must be 0 or 1')
  }
  return {
    seq: nonnegativeSafeIntegerField(row, 'seq'),
    type: nonemptyStringField(row, 'type'),
    time: safeIntegerField(row, 'time'),
    data: stringOrBlobField(row, 'data'),
    source_event_seqs: nullableBlobField(row, 'source_event_seqs'),
    surface_op: nullableStringField(row, 'surface_op'),
    is_packed: isPacked,
  }
}

/**
 * Validate the singleton identity read from durable storage.
 * @param value - value returned by SQLite.
 * @returns the UUID store identity.
 */
/*
 * 中文说明：函数 decodeStoreIdentity 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param value 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function decodeStoreIdentity(value: unknown): string {
  /** 中文说明：变量 identity 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const identity = nonemptyStringField(value, 'store_id')
  if (!UUID.test(identity)) throw new Error('stored store_id must be a UUID')
  return identity
}

/**
 * Reconstruct an immutable session header from a validated metadata row.
 * @param row - validated stored metadata row.
 * @returns the session header.
 */
/*
 * 中文说明：函数 rowToMeta 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param row 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function rowToMeta(row: SessionRow): SessionHeader {
  return {
    version: row.version,
    id: SessionId(row.id),
    createdAt: row.created_at,
    ...row.cwd === null ? {} : { cwd: row.cwd },
    ...row.parent_session === null ? {} : { parentSession: SessionId(row.parent_session) },
    ...row.seed_length === null ? {} : { seedLength: row.seed_length },
    ...row.origin === null ? {} : { origin: row.origin },
    ...row.delegation_depth === null ? {} : { delegationDepth: row.delegation_depth },
    ...row.agent_preset === null ? {} : { agentPreset: row.agent_preset },
  }
}

/** 中文说明：函数 record 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

/** 中文说明：函数 stringField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stringField(value: unknown, key: string): string {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string`)
  return field
}

/** 中文说明：函数 nonemptyStringField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nonemptyStringField(value: unknown, key: string): string {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = stringField(value, key)
  if (field.length === 0) throw new Error(`stored ${key} must not be empty`)
  return field
}

/** 中文说明：函数 nullableStringField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nullableStringField(value: unknown, key: string): string | null {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (field === null) return null
  if (typeof field !== 'string') throw new Error(`stored ${key} must be a string or null`)
  return field
}

/** 中文说明：函数 stringOrBlobField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function stringOrBlobField(value: unknown, key: string): string | Uint8Array {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (typeof field === 'string' || field instanceof Uint8Array) return field
  throw new Error(`stored ${key} must be a string or blob`)
}

/** 中文说明：函数 nullableBlobField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nullableBlobField(value: unknown, key: string): Uint8Array | null {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (field === null || field instanceof Uint8Array) return field
  throw new Error(`stored ${key} must be a blob or null`)
}

/** 中文说明：函数 integerField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function integerField(value: unknown, key: string): number {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (!Number.isSafeInteger(field)) throw new Error(`stored ${key} must be a safe integer`)
  return field as number
}

/** 中文说明：函数 safeIntegerField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function safeIntegerField(value: unknown, key: string): number {
  return integerField(value, key)
}

/** 中文说明：函数 nonnegativeSafeIntegerField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nonnegativeSafeIntegerField(value: unknown, key: string): number {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = integerField(value, key)
  if (field < 0) throw new Error(`stored ${key} must be non-negative`)
  return field
}

/** 中文说明：函数 nullableSafeIntegerField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nullableSafeIntegerField(value: unknown, key: string): number | null {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = record(value, 'SQLite row')[key]
  if (field === null) return null
  if (!Number.isSafeInteger(field)) throw new Error(`stored ${key} must be a safe integer or null`)
  return field as number
}

/** 中文说明：函数 nullableNonnegativeSafeIntegerField 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function nullableNonnegativeSafeIntegerField(value: unknown, key: string): number | null {
  /** 中文说明：变量 field 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const field = nullableSafeIntegerField(value, key)
  if (field !== null && field < 0) throw new Error(`stored ${key} must be non-negative or null`)
  return field
}
