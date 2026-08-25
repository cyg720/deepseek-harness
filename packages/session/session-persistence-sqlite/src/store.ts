/**
 * SQLite storage primitives: transactional append-batch packing, physical
 * reads, schema validation, revisions, repair, and lifecycle closure.
 * @module @deepseek-ai/dsh-session-persistence-sqlite/store
 */
/*
 * 文件职责：实现 store.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import {
  /** 中文说明：type SessionEvent 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionEvent,
  /** 中文说明：type SessionHeader 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionHeader,
  /** 中文说明：type SessionId 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionId,
} from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  /** 中文说明：type PersistenceBackend 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type PersistenceBackend,
  /** 中文说明：type SessionPersistenceRevision 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionPersistenceRevision as PersistenceRevision,
  /** 中文说明：type SessionPersistenceSnapshot 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionPersistenceSnapshot,
  /** 中文说明：type StoredPrefix 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type StoredPrefix,
  /** 中文说明：type StoredSuffix 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type StoredSuffix,
} from '@deepseek-ai/dsh-session-persistence'
import {
  MAX_PACKED_ROW_MEMBERS,
  packChunkRuns,
} from './codec.ts'
import {
  bindRecord,
  decodeRow,
  scanRows,
  /** 中文说明：type BoundRecord 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type BoundRecord,
} from './compression.ts'
import {
  /** 中文说明：type EventRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type EventRow,
  /** 中文说明：type JournalMode 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type JournalMode,
  decodeEventRow,
  decodeSessionRow,
  decodeStoreIdentity,
  openDatabase,
  validateSchemaForMutation,
  rowToMeta,
  /** 中文说明：type SessionRow 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionRow,
} from './schema.ts'
import { sql } from './sql.ts'

/** Storage options resolved by the service provider. */
/* 中文说明：interface SqliteStoreOptions 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export interface SqliteStoreOptions {
  readonly path: string
  readonly journalMode: JournalMode
  readonly busyTimeoutMs: number
}

/** SQLite implementation of the coordinator's physical backend hooks. */
/* 中文说明：class SqliteStore 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export class SqliteStore implements PersistenceBackend<number> {
  readonly name = 'session-persistence-sqlite'
  private db!: DatabaseSync
  private databaseConstructor!: typeof import('node:sqlite')['DatabaseSync']
  private storeIdentity!: string
  private databasePath!: string
  private opened = false
  private pathReady: Promise<void> | undefined
  private ready: Promise<void> | undefined

  constructor(private readonly options: SqliteStoreOptions) {}

  /**
   * Validate filesystem ownership without importing or opening Node SQLite.
   * @returns settlement of the store's one path-validation operation.
   */
  validatePath(): Promise<void> {
    this.pathReady ??= this.preparePath(this.options.path)
    return this.pathReady
  }

  /**
   * Lazily open and validate the database on first persistence use.
   * @returns settlement of the store's one database-open operation.
   */
  open(): Promise<void> {
    this.ready ??= this.openDb()
    return this.ready
  }

  private async preparePath(path: string): Promise<void> {
    /** 中文说明：变量 actual 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const actual = path === ':memory:' ? path : resolve(path)
    if (actual !== ':memory:') {
      await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
      await validateParentDirectory(dirname(actual))
      await validateDatabaseFileIfPresent(actual)
    }
    this.databasePath = actual
  }

  private async openDb(): Promise<void> {
    await this.validatePath()
    if (this.databasePath !== ':memory:') {
      await createDatabaseFile(this.databasePath)
      await validateDatabaseFile(this.databasePath)
    }
    const { DatabaseSync } = await loadNodeSqlite()
    this.databaseConstructor = DatabaseSync
    this.db = await openDatabase(
      DatabaseSync,
      this.databasePath,
      this.options.journalMode,
      this.options.busyTimeoutMs,
    )
    try {
      /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const row = this.db.prepare(sql('select-store-id')).get()
      if (row === undefined) {
        throw new Error(`session database at "${this.databasePath}" has no valid store identity`)
      }
      /** 中文说明：变量 storeId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let storeId: string
      try {
        storeId = decodeStoreIdentity(row)
      } catch (error: unknown) {
        throw new Error(`session database at "${this.databasePath}" has no valid store identity`, { cause: error })
      }
      if (this.databasePath === ':memory:') {
        this.storeIdentity = `memory:store:${storeId}`
      } else {
        /** 中文说明：变量 identity 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const identity = statSync(this.databasePath, { bigint: true })
        this.storeIdentity = `file:${identity.dev}:${identity.ino}:${identity.birthtimeNs}:store:${storeId}`
      }
      this.opened = true
    } catch (error: unknown) {
      this.db.close()
      throw error
    }
  }

  async loadStored(id: SessionId, signal?: AbortSignal): Promise<StoredPrefix<number> | undefined> {
    await this.observe(signal)
    /** 中文说明：函数值 snapshot 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const snapshot = this.readTransaction(() => {
      /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const row = this.rowFor(id)
      if (row === undefined) return undefined
      /** 中文说明：变量 eventRows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const eventRows = this.db.prepare(sql('select-events')).all(id).map(decodeEventRow)
      return { row, eventRows }
    })
    signal?.throwIfAborted()
    if (snapshot === undefined) return undefined
    /** 中文说明：变量 scanned 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scanned = scanRows(snapshot.eventRows)
    return {
      meta: rowToMeta(snapshot.row),
      events: scanned.preserved,
      revision: sqliteRevision(this.storeIdentity, snapshot.row),
      ...scanned.tornFrom === undefined ? {} : { tornMarker: scanned.tornFrom },
    }
  }

  async readStoredRevision(id: SessionId, signal?: AbortSignal): Promise<PersistenceRevision | undefined> {
    await this.observe(signal)
    /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const row = this.rowFor(id)
    signal?.throwIfAborted()
    return row === undefined ? undefined : sqliteRevision(this.storeIdentity, row)
  }

  async loadStoredFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<StoredSuffix | undefined> {
    await this.observe(signal)
    /** 中文说明：函数值 snapshot 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
    const snapshot = this.readTransaction(() => {
      /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const row = this.rowFor(id)
      if (row === undefined) return undefined
      return { row, ...this.physicalSpanFrom(id, fromSeq) }
    })
    signal?.throwIfAborted()
    if (snapshot === undefined) return undefined
    const { preserved } = scanRows(snapshot.eventRows, snapshot.base)
    return { meta: rowToMeta(snapshot.row), events: preserved.filter(event => event.seq >= fromSeq) }
  }

  async appendBatch(
    meta: SessionHeader,
    events: readonly SessionEvent[],
    isMaterialized: boolean,
  ): Promise<void> {
    await this.open()
    if (events.length === 0) return
    this.db.exec(sql('begin-immediate'))
    try {
      validateSchemaForMutation(this.databaseConstructor, this.db, this.databasePath)
      /** 中文说明：变量 tailRows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const tailRows = this.tailRows(meta.id)
      /** 中文说明：变量 currentLast 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const currentLast = this.logicalLastEvent(meta.id, tailRows)
      /** 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const expected = currentLast === undefined ? 0 : currentLast.seq + 1
      /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = events[0] as SessionEvent
      if (first.seq !== expected) {
        throw new Error(`session ${meta.id} append starts at seq ${first.seq}, stored next seq is ${expected}`)
      }
      if (!isMaterialized) this.writeRow(meta)

      /** 中文说明：变量 insert 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const insert = this.insertStatement()
      /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
      for (const record of packChunkRuns(events)) this.insertRecord(insert, meta.id, bindRecord(record))
      this.incrementRevision(meta.id)
      this.db.exec(sql('commit'))
    } catch (error: unknown) {
      this.rollback(error, 'append')
    }
  }

  async commitRepair(
    meta: SessionHeader,
    tornMarker: number | undefined,
    closers: readonly SessionEvent[],
  ): Promise<void> {
    await this.open()
    if (tornMarker === undefined && closers.length === 0) return
    this.db.exec(sql('begin-immediate'))
    try {
      validateSchemaForMutation(this.databaseConstructor, this.db, this.databasePath)
      /** 中文说明：变量 row 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const row = this.rowFor(meta.id)
      if (row === undefined) throw new Error(`session ${meta.id} metadata row is missing`)
      /** 中文说明：变量 currentRows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const currentRows = this.db.prepare(sql('select-events')).all(meta.id).map(decodeEventRow)
      /** 中文说明：变量 current 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const current = scanRows(currentRows)
      if (tornMarker !== undefined) {
        if (current.tornFrom !== tornMarker) {
          throw new Error(`session ${meta.id} repair is stale: physical tail no longer starts at seq ${tornMarker}`)
        }
        this.db.prepare(sql('delete-events-from'))
          .run(meta.id, tornMarker)
      } else if (current.tornFrom !== undefined) {
        throw new Error(`session ${meta.id} repair omitted current torn tail at seq ${current.tornFrom}`)
      }
      if (closers.length > 0) {
        /** 中文说明：变量 expected 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const expected = current.preserved.at(-1)?.seq === undefined
          ? 0
          : (current.preserved.at(-1) as SessionEvent).seq + 1
        if (closers[0]?.seq !== expected) {
          throw new Error(`session ${meta.id} repair is stale: closer starts at seq ${closers[0]?.seq}, stored next seq is ${expected}`)
        }
        /** 中文说明：变量 insert 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const insert = this.insertStatement()
        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const closer of closers) this.insertRecord(insert, meta.id, bindRecord(closer))
      }
      this.incrementRevision(meta.id)
      this.db.exec(sql('commit'))
    } catch (error: unknown) {
      this.rollback(error, 'repair')
    }
  }

  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    await this.observe(signal)
    /** 中文说明：变量 rows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = this.sessionRows()
    signal?.throwIfAborted()
    return rows.map(rowToMeta)
  }

  /**
   * Return every materialized header with its source-qualified revision.
   * @param signal - optional cancellation before or after the metadata query.
   * @returns stored headers and revisions without loading event rows.
   */
  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    await this.observe(signal)
    /** 中文说明：变量 rows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = this.sessionRows()
    signal?.throwIfAborted()
    return rows.map(row => ({
      header: rowToMeta(row),
      revision: sqliteRevision(this.storeIdentity, row),
    }))
  }

  async close(): Promise<void> {
    if (this.ready === undefined) {
      if (this.pathReady !== undefined) await Promise.allSettled([this.pathReady])
      return
    }
    await Promise.allSettled([this.ready])
    if (!this.opened) return
    this.opened = false
    this.db.close()
  }

  private rowFor(id: SessionId): SessionRow | undefined {
    /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = this.db.prepare(sql('select-session')).get(id)
    return value === undefined ? undefined : decodeSessionRow(value)
  }

  private async observe(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted()
    await this.open()
    signal?.throwIfAborted()
  }

  private readTransaction<T>(read: () => T): T {
    this.db.exec(sql('begin'))
    try {
      /** 中文说明：变量 value 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const value = read()
      this.db.exec(sql('commit'))
      return value
    } catch (error: unknown) {
      this.rollback(error, 'read')
    }
  }

  private sessionRows(): SessionRow[] {
    return this.db.prepare(sql('select-sessions')).all().map(decodeSessionRow)
  }

  private rollback(error: unknown, operation: string): never {
    try {
      this.db.exec(sql('rollback'))
    } catch (rollbackError: unknown) {
      /* v8 ignore next -- requires SQLite to fail both an operation and its immediate rollback. */
      throw new AggregateError([error, rollbackError], `${this.name} ${operation} failed and rollback also failed`)
    }
    throw error
  }

  private incrementRevision(id: SessionId): void {
    /** 中文说明：变量 updated 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const updated = this.db.prepare(sql('update-session-revision'))
      .run(id)
    /* v8 ignore next -- materialized writes follow coordinator create(); other writes upsert in this transaction. */
    if (Number(updated.changes) !== 1) throw new Error(`session ${id} metadata row is missing`)
  }

  private tailRows(id: SessionId): EventRow[] {
    /** 中文说明：变量 tail 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const tail = this.db.prepare(sql('select-tail-events')).all(id, 2).map(decodeEventRow).reverse()
    if (tail.length === 0) return []
    return this.physicalSpanFrom(id, (tail[0] as EventRow).seq).eventRows
  }

  /** Select the bounded physical span that may represent `fromSeq`. */
  private physicalSpanFrom(
    id: SessionId,
    fromSeq: number,
  ): { readonly base: number; readonly eventRows: EventRow[] } {
    /** 中文说明：变量 packedFloor 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packedFloor = Math.max(0, fromSeq - MAX_PACKED_ROW_MEMBERS + 1)
    /** 中文说明：变量 packedPredecessors 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const packedPredecessors = this.db.prepare(sql('select-packed-predecessors'))
      .all(id, packedFloor, fromSeq)
      .map(decodeEventRow)
    /** 中文说明：变量 base 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let base = fromSeq
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const predecessor of packedPredecessors) {
      try {
        /** 中文说明：变量 last 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const last = decodeRow(predecessor).at(-1)
        if (last !== undefined && last.seq >= fromSeq) base = Math.min(base, predecessor.seq)
      } catch {
        // A malformed bounded predecessor may cover fromSeq; include it so the scanner fails closed.
        base = Math.min(base, predecessor.seq)
      }
    }
    /** 中文说明：变量 eventRows 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventRows = this.db.prepare(sql('select-events-from')).all(id, base).map(decodeEventRow)
    return { base, eventRows }
  }

  private logicalLastEvent(id: SessionId, tailRows: readonly EventRow[]): SessionEvent | undefined {
    if (tailRows.length === 0) return undefined
    const { preserved, tornFrom } = scanRows(tailRows, (tailRows[0] as EventRow).seq)
    if (tornFrom !== undefined) throw new Error(`session ${id} has an invalid physical tail at seq ${tornFrom}`)
    return preserved.at(-1)
  }

  private insertStatement(): StatementSync {
    return this.db.prepare(sql('insert-event'))
  }

  private insertRecord(insert: StatementSync, id: SessionId, record: BoundRecord): void {
    insert.run(
      id,
      record.seq,
      record.type,
      record.time,
      record.data,
      record.sourceEventSeqs,
      record.surfaceOp,
      record.ignorable,
    )
  }

  private writeRow(meta: SessionHeader): void {
    this.db.prepare(sql('upsert-session')).run(
      meta.id,
      meta.version,
      meta.createdAt,
      meta.cwd ?? null,
      meta.parentSession ?? null,
      meta.seedLength ?? null,
      meta.origin ?? null,
      meta.delegationDepth ?? null,
      meta.agentPreset ?? null,
      randomUUID(),
    )
  }
}

/** 中文说明：函数 sqliteRevision 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function sqliteRevision(storeIdentity: string, row: SessionRow): PersistenceRevision {
  return SessionPersistenceRevision(
    `${storeIdentity}:incarnation:${row.incarnation}:revision:${row.revision}`,
  )
}

/** 中文说明：函数 createDatabaseFile 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    /** 中文说明：变量 handle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/** 中文说明：函数 validateParentDirectory 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function validateParentDirectory(path: string): Promise<void> {
  /** 中文说明：变量 parent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = await lstat(path)
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error(`session database parent "${path}" must be a real directory`)
  }
  /** 中文说明：变量 uid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const uid = process.getuid?.()
  /* v8 ignore start -- Windows exposes neither process.getuid nor meaningful
   * uid/mode bits; POSIX tests cover owner and mode rejection. */
  if (uid !== undefined && (parent.uid !== uid || (parent.mode & 0o022) !== 0)) {
    throw new Error(`session database parent "${path}" must be owned by the current user and not group/world-writable`)
  }
  /* v8 ignore stop */
}

/** 中文说明：函数 validateDatabaseFile 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function validateDatabaseFile(path: string): Promise<void> {
  /** 中文说明：变量 file 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const file = await lstat(path)
  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error(`session database "${path}" must be a regular file, not a symbolic link`)
  }
  /** 中文说明：变量 uid 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const uid = process.getuid?.()
  /* v8 ignore start -- Windows exposes neither process.getuid nor meaningful
   * uid/mode bits; POSIX tests cover owner and mode rejection. */
  if (uid !== undefined && (file.uid !== uid || (file.mode & 0o077) !== 0)) {
    throw new Error(`session database "${path}" must be owned by the current user and accessible only by that user`)
  }
  /* v8 ignore stop */
}

/** 中文说明：函数 validateDatabaseFileIfPresent 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function validateDatabaseFileIfPresent(path: string): Promise<void> {
  try {
    await validateDatabaseFile(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** 中文说明：变量 nodeSqlite 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let nodeSqlite: Promise<typeof import('node:sqlite')> | undefined

/** Load Node SQLite once so concurrent stores share one warning-filter lifetime. */
/* 中文说明：函数 loadNodeSqlite 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function loadNodeSqlite(): Promise<typeof import('node:sqlite')> {
  nodeSqlite ??= importNodeSqlite()
  return nodeSqlite
}

/** Import Node 22's SQLite dependency without its process-wide experimental warning. */
/* 中文说明：函数 importNodeSqlite 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
async function importNodeSqlite(): Promise<typeof import('node:sqlite')> {
  /** 中文说明：变量 emitWarning 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const emitWarning = Reflect.get(process, 'emitWarning')
  /* v8 ignore start -- Node 22 alone emits this warning; primary coverage runs on Node 24. */
  /** 中文说明：函数值 filteredEmitWarning 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const filteredEmitWarning = (warning: string | Error, ...args: unknown[]): void => {
    /** 中文说明：变量 message 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = warning instanceof Error ? warning.message : warning
    /** 中文说明：变量 first 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = args[0]
    /** 中文说明：变量 type 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const type = warning instanceof Error
      ? warning.name
      : typeof first === 'string'
        ? first
        : typeof first === 'object' && first !== null && 'type' in first
          ? first.type
          : undefined
    if (message === 'SQLite is an experimental feature and might change at any time'
      && type === 'ExperimentalWarning') return
    Reflect.apply(emitWarning, process, [warning, ...args])
  }
  Reflect.set(process, 'emitWarning', filteredEmitWarning)
  try {
    return await import('node:sqlite')
  } finally {
    Reflect.set(process, 'emitWarning', emitWarning)
  }
  /* v8 ignore stop */
}
