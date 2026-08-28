/**
 * Opt-in SQLite persistence provider. Logical sessions remain unchanged;
 * the physical backend packs eligible chunk runs into schema-19 rows.
 * @module @deepseek-ai/dsh-session-persistence-sqlite
 */
/*
 * 文件职责：实现 index.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  Session,
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionPreparation,
} from '@deepseek-ai/dsh-session'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  type BorrowedSessionSource,
  PersistenceCoordinator,
  SessionPersistence,
  /** 中文说明：type SessionInspection 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionInspection,
  /** 中文说明：type SessionLocation 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionLocation,
  /** 中文说明：type SessionPersistenceSnapshot 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type { JournalMode } from './schema.ts'
import { SqliteStore } from './store.ts'

export { SCHEMA_VERSION } from './schema.ts'

/** Default wait for another SQLite connection's write reservation. */
/* 中文说明：常量 DEFAULT_BUSY_TIMEOUT_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000
/** Largest busy timeout accepted by SQLite's signed millisecond interface. */
/* 中文说明：常量 MAX_BUSY_TIMEOUT_MS 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
export const MAX_BUSY_TIMEOUT_MS = 2_147_483_647

/** Plugin configuration. */
/* 中文说明：interface Config 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
  /** Durable SQLite journal mode; defaults to `wal`. */
  journalMode?: JournalMode
  /** Maximum wait for another SQLite connection's lock; defaults to 5,000 ms. */
  busyTimeoutMs?: number
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/**
 * SQLite `SessionPersistence` provider with a schema-owned physical codec.
 */
/* 中文说明：class SqliteSessionPersistence 定义本模块所需的数据或行为，用于表达会话持久化场景。 */
export class SqliteSessionPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  override readonly name = 'session-persistence-sqlite'

  static inject = ['sessions']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.number().step(1).min(0).max(MAX_BUSY_TIMEOUT_MS).default(DEFAULT_BUSY_TIMEOUT_MS),
    preparedSessionCacheSize: z.number().step(1).min(1).default(DEFAULT_PREPARED_SESSION_CACHE_SIZE),
    writeBatchMaxDelayMs: z.number().step(1).min(1).max(MAX_WRITE_BATCH_DELAY_MS)
      .default(DEFAULT_WRITE_BATCH_MAX_DELAY_MS),
  })

  private readonly store: SqliteStore
  private readonly coordinator: PersistenceCoordinator<number>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    /** 中文说明：变量 preparedSessionCacheSize 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparedSessionCacheSize = config.preparedSessionCacheSize
      ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE
    /** 中文说明：变量 writeBatchMaxDelayMs 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writeBatchMaxDelayMs = config.writeBatchMaxDelayMs
      ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS
    this.store = new SqliteStore({
      path: config.path,
      journalMode: config.journalMode ?? 'wal',
      busyTimeoutMs: config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    })
    this.coordinator = new PersistenceCoordinator(this.ctx, this.store, {
      preparedSessionCacheSize,
      writeBatchMaxDelayMs,
    })
  }

  /** Reject self-contained path and ownership failures without loading Node SQLite. */
  protected async [Service.init](): Promise<void> {
    await this.store.validatePath()
  }

  /** SQLite has one database, not an independent per-session artifact. */
  locate(_meta: SessionHeader): SessionLocation | undefined {
    return undefined
  }

  create(meta: SessionHeader): Promise<void> {
    return this.coordinator.create(meta)
  }

  override ensureMaterialized(session: Session): Promise<void> {
    return this.coordinator.ensureMaterialized(session)
  }

  append(id: SessionId, events: readonly SessionEvent[]): Promise<void> {
    return this.coordinator.append(id, events)
  }

  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    return this.coordinator.prepare(id, signal)
  }

  load(id: SessionId): Promise<SessionInspection> {
    return this.coordinator.load(id)
  }

  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    return this.coordinator.inspect(id, signal)
  }

  override borrowSession(id: SessionId, signal?: AbortSignal): Promise<BorrowedSessionSource> {
    return this.coordinator.borrowSession(id, signal)
  }

  readFrom(
    id: SessionId,
    fromSeq: number,
    signal?: AbortSignal,
  ): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }

  list(signal?: AbortSignal): Promise<SessionHeader[]> {
    return this.store.list(signal)
  }

  listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    return this.store.listSnapshots(signal)
  }
}

export default SqliteSessionPersistence
