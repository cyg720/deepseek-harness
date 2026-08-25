/**
 * 文件职责：验证 sqlite.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionPersistenceSqlite, {
  DEFAULT_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
} from '@deepseek-ai/dsh-session-persistence-sqlite'
import {
  runCoordinatorContract,
  /** 中文说明：type CoordinatorFixture 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
  type CoordinatorFixture,
} from '../../session-persistence/tests/coordinator-contract.ts'
import {
  meta,
  runPersistenceContract,
} from '../../session-persistence/tests/contract.ts'
import { MAX_PACKED_DATA_BYTES } from '../src/codec.ts'
import {
  decodeEventRow,
  decodeSessionRow,
  decodeStoreIdentity,
  openDatabase,
  validateSchemaForMutation,
  rowToMeta,
  SESSION_PERSISTENCE_SQLITE_APPLICATION_ID,
  /** 中文说明：type SessionRow 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
  type SessionRow,
} from '../src/schema.ts'
import { SqliteStore } from '../src/store.ts'
import { sql } from '../src/sql.ts'
import { testSql } from './test-sql.ts'

/** 中文说明：变量 dirs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const dirs: string[] = []
afterEach(async () => {
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** 中文说明：函数 freshDbPath 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function freshDbPath(prefix = 'dsh-sqlite-'): Promise<string> {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(directory)
  return join(directory, 'sessions.db')
}

/** 中文说明：函数 backendFailure 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function backendFailure(path: string): Promise<unknown> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  try {
    await ctx.plugin(SessionPersistenceSqlite, { path })
    await ctx.sessionPersistence.list()
    return undefined
  } catch (error: unknown) {
    return error
  } finally {
    await ctx.fiber.dispose()
  }
}

/** 中文说明：函数 errorMessage 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 中文说明：函数 databaseWithJournalFailure 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function databaseWithJournalFailure(
  nextFailure: () => Error | undefined,
): typeof DatabaseSync {
  return class JournalFailureDatabase extends DatabaseSync {
    override prepare(source: string) {
      if (source !== sql('journal-mode-wal')) return super.prepare(source)
      /** 中文说明：变量 statement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const statement = super.prepare(sql('journal-mode-wal'))
      /** 中文说明：变量 get 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const get = statement.get.bind(statement)
      Object.defineProperty(statement, 'get', {
        value: () => {
          /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const failure = nextFailure()
          if (failure !== undefined) throw failure
          return get()
        },
      })
      return statement
    }
  }
}

/** 中文说明：函数 chunk 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function chunk(seq: number, text = `token-${seq}`): SessionEvent {
  return {
    type: 'assistant/chunk',
    seq,
    time: 1_000 + seq,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text },
    },
  }
}

/** 中文说明：函数 chunkLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function chunkLog(count: number): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    ...Array.from({ length: count }, (_, index) => chunk(index + 2)),
    { type: 'step/end', seq: count + 2, time: count + 3, data: { turn: 1, step: 1 } },
    {
      type: 'turn/end',
      seq: count + 3,
      time: count + 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

/** 中文说明：函数 measureWriteTraffic 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function measureWriteTraffic(
  path: string,
  events: readonly SessionEvent[],
): Promise<{
  readonly walBytes: number
  readonly idleWalBytes: number
  readonly rows: number
  readonly largest: number
  readonly inserted: number
  readonly changed: number
  readonly removed: number
}> {
  /** 中文说明：interface PhysicalRow 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
  interface PhysicalRow {
    readonly rowid: number
    readonly seq: number
    readonly type: string
    readonly time: number
    readonly data: string | Uint8Array
    readonly source_event_seqs: Uint8Array | null
    readonly surface_op: string | null
    readonly ignorable: number | null
  }
  /** 中文说明：函数值 sameValue 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const sameValue = (left: string | Uint8Array | null, right: string | Uint8Array | null): boolean => (
    typeof left === 'string' || left === null
      ? left === right
      : right instanceof Uint8Array && Buffer.from(left).equals(Buffer.from(right))
  )
  /** 中文说明：函数值 sameRow 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const sameRow = (left: PhysicalRow, right: PhysicalRow): boolean => (
    left.rowid === right.rowid
      && left.seq === right.seq
      && left.type === right.type
      && left.time === right.time
      && sameValue(left.data, right.data)
      && sameValue(left.source_event_seqs, right.source_event_seqs)
      && left.surface_op === right.surface_op
      && left.ignorable === right.ignorable
  )
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionPersistenceSqlite, { path, writeBatchMaxDelayMs: 200 })
  try {
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('traffic')
    await ctx.sessionPersistence.create(header)
    /** 中文说明：变量 previous 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let previous = new Map<number, PhysicalRow>()
    /** 中文说明：变量 inserted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let inserted = 0
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let changed = 0
    /** 中文说明：变量 removed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let removed = 0
    /** 中文说明：变量 probe 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const probe = new DatabaseSync(path, { readOnly: true })
    try {
      /** 中文说明：变量 selectRows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const selectRows = probe.prepare(testSql('select-event-rows'))
      /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
      for (let offset = 0; offset < events.length; offset += 40) {
        await ctx.sessionPersistence.append(header.id, events.slice(offset, offset + 40))
        /** 中文说明：变量 current 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const current = new Map((selectRows.all(header.id) as unknown as PhysicalRow[])
          .map(row => [row.seq, row]))
        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const [seq, row] of current) {
          /** 中文说明：变量 old 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const old = previous.get(seq)
          if (old === undefined) inserted += 1
          else if (!sameRow(old, row)) changed += 1
        }
        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const seq of previous.keys()) if (!current.has(seq)) removed += 1
        previous = current
      }
    } finally {
      probe.close()
    }
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path, { readOnly: true })
    /** 中文说明：变量 measured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const measured = db.prepare(testSql('measure-write-traffic')).get() as { rows: number; largest: number }
    db.close()
    /** 中文说明：变量 walBytes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const walBytes = (await stat(`${path}-wal`)).size
    await new Promise(resolve => setTimeout(resolve, 250))
    return {
      walBytes,
      idleWalBytes: (await stat(`${path}-wal`)).size,
      rows: measured.rows,
      largest: measured.largest,
      inserted,
      changed,
      removed,
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

runPersistenceContract('sqlite', async () => {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const fiber = await ctx.plugin(SessionPersistenceSqlite, { path: ':memory:' })
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => { await fiber.dispose() },
  }
})

runCoordinatorContract('sqlite', async (): Promise<CoordinatorFixture> => {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sqlite-coord-'))
  /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const path = join(directory, 'sessions.db')
  return {
    mount: async ctx => ctx.plugin(SessionPersistenceSqlite, { path }),
    corruptTail: async (id) => {
      /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const db = new DatabaseSync(path)
      /** 中文说明：变量 last 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const last = db.prepare(testSql('select-last-event'))
        .get(id) as { seq: number; type: string; data: string }
      /** 中文说明：变量 logicalLength 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const logicalLength = last.type === 'text-chunks'
        ? (JSON.parse(last.data) as { texts: string[] }).texts.length
        : 1
      /** 中文说明：变量 next 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const next = last.seq + logicalLength
      db.prepare(testSql('insert-corrupt-event'))
        .run(id, next, 'assistant/chunk', 99, '{not valid json', null)
      db.close()
    },
    cleanup: async () => { await rm(directory, { recursive: true, force: true }) },
  }
})

describe('SessionPersistenceSqlite physical packing', () => {
  it('loads from cordis.yml and packs through the assembled service', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-loader-')
    /** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configPath = join(path, '..', 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-sqlite'",
      '  config:',
      `    path: ${JSON.stringify(path)}`,
      '',
    ].join('\n'))

    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(join(path, '..')).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'sqlite',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-session') return SessionStore
        if (specifier === '@deepseek-ai/dsh-session-persistence-sqlite') {
          return SessionPersistenceSqlite
        }
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('loader')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = chunkLog(4)
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, events)
    expect((await ctx.sessionPersistence.inspect(header.id)).events).toEqual(events)
    await ctx.fiber.dispose()

    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    expect(db.prepare(testSql('count-packed-events')).get())
      .toEqual({ count: 1 })
    db.close()
  })

  it('packs each append once without rewriting earlier rows and seeks inside packed rows', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(SessionPersistenceSqlite, { path })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('packed')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = chunkLog(100)
    await ctx.sessionPersistence.create(header)
    await ctx.sessionPersistence.append(header.id, events.slice(0, 3))
    await ctx.sessionPersistence.append(header.id, events.slice(3, 4))
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = new DatabaseSync(path, { readOnly: true })
    /** 中文说明：变量 originalRows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originalRows = before.prepare(testSql('select-event-rowids')).all()
    before.close()
    await ctx.sessionPersistence.append(header.id, events.slice(4))

    /** 中文说明：变量 inspected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspected = await ctx.sessionPersistence.inspect(header.id)
    expect(inspected.events).toEqual(events)
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const fromSeq of [0, 2, 25, 101, 104, 105]) {
      expect((await ctx.sessionPersistence.readFrom(header.id, fromSeq)).events)
        .toEqual(events.filter(event => event.seq >= fromSeq))
    }
    await fiber.dispose()

    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    expect(db.prepare(testSql('select-user-version')).get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.prepare(testSql('count-events')).get()).toEqual({ count: 7 })
    expect(db.prepare(testSql('count-packed-events')).get())
      .toEqual({ count: 1 })
    expect(db.prepare(testSql('select-event-rowids')).all().slice(0, originalRows.length))
      .toEqual(originalRows)
    db.close()
  })

  it.runIf(process.platform !== 'win32')('bounds paced-stream WAL extent without rewriting committed rows', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = chunkLog(1_000)
    /** 中文说明：变量 measured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const measured = await measureWriteTraffic(await freshDbPath('dsh-sqlite-traffic-'), events)

    expect(measured).toMatchObject({ rows: 31, inserted: 31, changed: 0, removed: 0 })
    expect(measured.inserted).toBe(measured.rows)
    expect(measured.largest).toBeLessThanOrEqual(MAX_PACKED_DATA_BYTES)
    expect(measured.idleWalBytes).toBe(measured.walBytes)
  })

  it('includes a packed predecessor when an overlapping scalar tail hides it', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-overlap-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('overlap')
    await store.appendBatch(header, [chunk(0), chunk(1), chunk(2)], false)

    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    db.prepare(testSql('insert-corrupt-event'))
      .run(header.id, 1, 'assistant/chunk', 2, JSON.stringify(chunk(1).data), null)
    db.close()

    expect((await store.loadStoredFrom(header.id, 2))?.events).toEqual([chunk(2)])

    /** 中文说明：变量 malformed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const malformed = new DatabaseSync(path)
    malformed.prepare(testSql('delete-session-events')).run(header.id)
    malformed.prepare(testSql('insert-corrupt-event'))
      .run(header.id, 0, 'text-chunks', 1, '{not json', 0)
    malformed.close()
    expect((await store.loadStoredFrom(header.id, 2))?.events).toEqual([])
    await store.close()
  })

  it('waits for a competing process within the configured busy timeout', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-busy-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: 1_000 })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('busy')
    await store.appendBatch(header, [chunk(0)], false)

    /** 中文说明：变量 holder 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const holder = spawn(process.execPath, ['--input-type=module', '-e', String.raw`
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      process.stdout.write('locked\n');
      setTimeout(() => { db.exec('COMMIT'); db.close(); }, 100);
    `, path], { stdio: ['ignore', 'pipe', 'pipe'] })
    /** 中文说明：函数值 exited 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const exited = new Promise<number | null>((resolve, reject) => {
      holder.once('error', reject)
      holder.once('exit', resolve)
    })
    try {
      await once(holder.stdout, 'data')
      await expect(store.appendBatch(header, [chunk(1)], true)).resolves.toBeUndefined()
      /** 中文说明：变量 code 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const code = await exited
      expect(code).toBe(0)
      expect((await store.loadStored(header.id))?.events).toEqual([chunk(0), chunk(1)])
    } finally {
      if (holder.exitCode === null) holder.kill()
      await store.close()
    }
  })

  it('rejects an older SQLite physical schema', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-old-schema-')
    /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = await openDatabase(DatabaseSync, path, 'wal', DEFAULT_BUSY_TIMEOUT_MS)
    seed.exec(testSql('set-user-version-16'))
    seed.close()
    await chmod(path, 0o600)
    await expect(openDatabase(DatabaseSync, path, 'wal', DEFAULT_BUSY_TIMEOUT_MS))
      .rejects.toThrow(/schema version 16.*incompatible/)
  })

  it('rejects a stale physical append without replacing the winning tail', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-stale-')
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta(SessionId('stale'))
    await first.appendBatch(header, [chunk(0)], false)
    await second.appendBatch(header, [chunk(1)], true)
    await expect(first.appendBatch(header, [chunk(1)], true)).rejects.toThrow(/stored next seq is 2/)
    expect((await first.loadStored(header.id))?.events).toEqual([chunk(0), chunk(1)])
    await first.close()
    await second.close()
  })

  it('rejects a stale repair without deleting a newer winning tail', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-stale-repair-')
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 winner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const winner = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta(SessionId('stale-repair'))
    await stale.appendBatch(header, [chunk(0)], false)
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    db.prepare(testSql('insert-corrupt-event')).run(header.id, 1, 'assistant/chunk', 2, '{not json', null)
    db.close()
    expect((await stale.loadStored(header.id))?.tornMarker).toBe(1)
    await winner.commitRepair(header, 1, [])
    await winner.appendBatch(header, [chunk(1), chunk(2)], true)
    await expect(stale.commitRepair(header, 1, [])).rejects.toThrow(/repair is stale/)
    expect((await stale.loadStored(header.id))?.events).toEqual([chunk(0), chunk(1), chunk(2)])
    await stale.close()
    await winner.close()
  })
})

describe('SessionPersistenceSqlite schema ownership', () => {
  it('accepts every configured journal mode and SQLite memory mode result', async () => {
    /** 中文说明：变量 resources 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resources = {
      wal: 'journal-mode-wal',
      delete: 'journal-mode-delete',
      truncate: 'journal-mode-truncate',
      persist: 'journal-mode-persist',
    } as const
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const mode of ['wal', 'delete', 'truncate', 'persist'] as const) {
      ;(await openDatabase(DatabaseSync, ':memory:', mode, DEFAULT_BUSY_TIMEOUT_MS)).close()
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = await freshDbPath(`dsh-sqlite-journal-${mode}-`)
      /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const db = await openDatabase(DatabaseSync, path, mode, DEFAULT_BUSY_TIMEOUT_MS)
      expect(db.prepare(sql(resources[mode])).get()).toEqual({ journal_mode: mode })
      expect(db.prepare(sql('select-trusted-schema')).get()).toEqual({ trusted_schema: 0 })
      expect(db.prepare(sql('select-mmap-size')).get()).toEqual({ mmap_size: 0 })
      expect(db.prepare(sql('select-synchronous')).get()).toEqual({ synchronous: 2 })
      db.close()
    }
  })

  it('retries a busy journal-mode transition within its retry budget', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-journal-busy-')
    /** 中文说明：变量 attempts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempts = 0
    /** 中文说明：函数值 BusyOnceDatabase 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const BusyOnceDatabase = databaseWithJournalFailure(() => {
      attempts += 1
      return attempts === 1
        ? Object.assign(new Error('database is locked'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 5,
          errstr: 'database is locked',
        })
        : undefined
    })

    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = await openDatabase(BusyOnceDatabase, path, 'wal', 100)
    expect(attempts).toBe(2)
    expect(db.prepare(sql('journal-mode-wal')).get()).toEqual({ journal_mode: 'wal' })
    expect(db.prepare(sql('select-trusted-schema')).get()).toEqual({ trusted_schema: 0 })
    expect(db.prepare(sql('select-mmap-size')).get()).toEqual({ mmap_size: 0 })
    expect(db.prepare(sql('select-synchronous')).get()).toEqual({ synchronous: 2 })
    db.close()
  })

  it('does not retry journal failures outside the available busy budget', async () => {
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const { errcode, timeout } of [
      { errcode: 5, timeout: 0 },
      { errcode: 6, timeout: 100 },
    ]) {
      /** 中文说明：变量 attempts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let attempts = 0
      /** 中文说明：函数值 FailingDatabase 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const FailingDatabase = databaseWithJournalFailure(() => {
        attempts += 1
        return Object.assign(new Error(`SQLite error ${errcode}`), { errcode })
      })
      await expect(openDatabase(
        FailingDatabase,
        await freshDbPath(`dsh-sqlite-journal-failure-${errcode}-`),
        'wal',
        timeout,
      )).rejects.toThrow(`SQLite error ${errcode}`)
      expect(attempts).toBe(1)
    }
  })

  it('starts no journal retry after its open-relative cutoff', async () => {
    /** 中文说明：变量 attempts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempts = 0
    /** 中文说明：函数值 BusyDatabase 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const BusyDatabase = databaseWithJournalFailure(() => {
      attempts += 1
      return Object.assign(new Error('database is locked'), { errcode: 5 })
    })
    /** 中文说明：变量 clock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const clock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(100)
    try {
      await expect(openDatabase(
        BusyDatabase,
        await freshDbPath('dsh-sqlite-journal-cutoff-'),
        'wal',
        100,
      )).rejects.toThrow('database is locked')
    } finally {
      clock.mockRestore()
    }
    expect(attempts).toBe(1)
  })

  it('paces repeated busy journal-mode attempts', async () => {
    /** 中文说明：变量 attempts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let attempts = 0
    /** 中文说明：函数值 BusyDatabase 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const BusyDatabase = databaseWithJournalFailure(() => {
      attempts += 1
      return Object.assign(new Error('database is locked'), { errcode: 5 })
    })
    await expect(openDatabase(
      BusyDatabase,
      await freshDbPath('dsh-sqlite-journal-paced-'),
      'wal',
      50,
    )).rejects.toThrow('database is locked')
    expect(attempts).toBeGreaterThan(1)
    expect(attempts).toBeLessThanOrEqual(6)
  })

  it('rejects unversioned, incompatible, and foreign-application databases', async () => {
    /** 中文说明：变量 unversionedPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unversionedPath = await freshDbPath('dsh-sqlite-unversioned-')
    /** 中文说明：变量 unversioned 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unversioned = new DatabaseSync(unversionedPath)
    unversioned.exec(testSql('create-unrelated-table'))
    unversioned.close()
    await expect(openDatabase(DatabaseSync, unversionedPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/unversioned schema/)

    /** 中文说明：变量 incompatiblePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const incompatiblePath = await freshDbPath('dsh-sqlite-incompatible-')
    /** 中文说明：变量 incompatible 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const incompatible = new DatabaseSync(incompatiblePath)
    incompatible.exec(testSql('set-user-version-16'))
    incompatible.close()
    await expect(openDatabase(DatabaseSync, incompatiblePath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/incompatible with this build/)

    /** 中文说明：变量 foreignPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreignPath = await freshDbPath('dsh-sqlite-foreign-')
    /** 中文说明：变量 foreign 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec(testSql('set-user-version-17'))
    foreign.exec(testSql('set-application-id-12345'))
    foreign.close()
    await expect(openDatabase(DatabaseSync, foreignPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/has application id 12345/)
  })

  it('rejects changed columns and non-strict owned tables', async () => {
    /** 中文说明：变量 changedPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changedPath = await freshDbPath('dsh-sqlite-columns-')
    ;(await openDatabase(DatabaseSync, changedPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).close()
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = new DatabaseSync(changedPath)
    changed.exec(testSql('add-unexpected-column'))
    changed.close()
    await expect(openDatabase(DatabaseSync, changedPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/required schema objects/)

    /** 中文说明：变量 nonStrictPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nonStrictPath = await freshDbPath('dsh-sqlite-nonstrict-')
    ;(await openDatabase(DatabaseSync, nonStrictPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).close()
    /** 中文说明：变量 nonStrict 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nonStrict = new DatabaseSync(nonStrictPath)
    nonStrict.exec(testSql('replace-events-with-nonstrict-table'))
    nonStrict.close()
    await expect(openDatabase(DatabaseSync, nonStrictPath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/required schema objects/)

    /** 中文说明：变量 loosePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loosePath = await freshDbPath('dsh-sqlite-loose-')
    /** 中文说明：变量 loose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loose = new DatabaseSync(loosePath)
    loose.exec(testSql('create-loose-schema'))
    loose.close()
    await expect(openDatabase(DatabaseSync, loosePath, 'wal', DEFAULT_BUSY_TIMEOUT_MS)).rejects.toThrow(/required schema objects/)
  })

  it('rejects schema ownership changes observed at mutation time', async () => {
    /** 中文说明：变量 changedVersion 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changedVersion = await openDatabase(DatabaseSync, ':memory:', 'wal', DEFAULT_BUSY_TIMEOUT_MS)
    changedVersion.exec(testSql('set-user-version-16'))
    expect(() => { validateSchemaForMutation(DatabaseSync, changedVersion, ':memory:') })
      .toThrow(/schema changed before mutation/)
    changedVersion.close()

    /** 中文说明：变量 changedApplication 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changedApplication = await openDatabase(DatabaseSync, ':memory:', 'wal', DEFAULT_BUSY_TIMEOUT_MS)
    changedApplication.exec(testSql('set-application-id-12345'))
    expect(() => { validateSchemaForMutation(DatabaseSync, changedApplication, ':memory:') })
      .toThrow(/application id changed before mutation/)
    changedApplication.close()
  })

  it('validates creation time and restores every optional header field', () => {
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base: SessionRow = {
      id: 'stored-header',
      version: 0,
      created_at: 1,
      cwd: '/project',
      parent_session: 'parent',
      seed_length: 4,
      origin: 'subagent',
      incarnation: '00000000-0000-4000-8000-000000000000',
      revision: 1,
      delegation_depth: 2,
      agent_preset: 'minimal',
    }
    expect(rowToMeta(decodeSessionRow(base))).toMatchObject({
      cwd: '/project',
      parentSession: 'parent',
      seedLength: 4,
      origin: 'subagent',
      delegationDepth: 2,
      agentPreset: 'minimal',
    })
    expect(() => decodeSessionRow({ ...base, created_at: -1 })).toThrow(/created_at/)
    expect(() => decodeSessionRow({ ...base, origin: 'external' })).toThrow(/origin/)
    expect(() => decodeSessionRow({ ...base, delegation_depth: -1 })).toThrow(/delegation_depth/)
  })

  it('rejects malformed SQLite row primitives generically', () => {
    /** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const base: SessionRow = {
      id: 'stored-header',
      version: 0,
      created_at: 1,
      cwd: '/project',
      parent_session: null,
      seed_length: null,
      origin: null,
      incarnation: '00000000-0000-4000-8000-000000000000',
      revision: 1,
      delegation_depth: null,
      agent_preset: null,
    }
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const [value, message] of [
      [null, /object/],
      [{ ...base, id: 1 }, /id.*string/],
      [{ ...base, id: '' }, /id.*empty/],
      [{ ...base, version: '0' }, /version.*safe integer/],
      [{ ...base, cwd: 'relative' }, /cwd.*absolute/],
      [{ ...base, cwd: 1 }, /cwd.*string or null/],
      [{ ...base, incarnation: 'invalid' }, /incarnation.*UUID/],
      [{ ...base, seed_length: '1' }, /seed_length.*safe integer or null/],
      [{ ...base, agent_preset: 1 }, /agent_preset.*string or null/],
    ] as const) {
      expect(() => decodeSessionRow(value)).toThrow(message)
    }

    /** 中文说明：变量 eventRow 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const eventRow = {
      seq: 0, type: 'turn/start', time: 1, data: '{}',
      source_event_seqs: null, surface_op: null, ignorable: null,
    }
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const [value, message] of [
      [null, /object/],
      [{ ...eventRow, seq: '0' }, /seq.*safe integer/],
      [{ ...eventRow, type: '' }, /type.*empty/],
      [{ ...eventRow, time: '1' }, /time.*safe integer/],
      [{ ...eventRow, data: 1 }, /data.*string or blob/],
      [{ ...eventRow, source_event_seqs: 1 }, /source_event_seqs.*blob or null/],
      [{ ...eventRow, ignorable: 2 }, /ignorable.*0, 1, or null/],
    ] as const) {
      expect(() => decodeEventRow(value)).toThrow(message)
    }
    expect(() => decodeStoreIdentity({ store_id: 'invalid' })).toThrow(/store_id.*UUID/)
  })

  it('rejects invalid durable metadata before exposing a session header', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-metadata-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('invalid-metadata')
    await store.appendBatch(header, [chunk(0)], false)
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    db.prepare(testSql('update-invalid-session-metadata')).run(header.id)
    db.close()
    await expect(store.list()).rejects.toThrow(/seed_length|origin|delegation_depth/)
    await expect(store.loadStored(header.id)).rejects.toThrow(/seed_length|origin|delegation_depth/)
    await store.close()
  })

  it('uses the shared persistence application identity', () => {
    expect(SESSION_PERSISTENCE_SQLITE_APPLICATION_ID).toBe(0x44534850)
  })
})

describe('SessionPersistenceSqlite edge behavior', () => {
  it('keeps a fresh database unopened until the first persistence operation', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-lazy-')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionPersistenceSqlite, { path })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    /** 中文说明：变量 emitWarning 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const emitWarning = Reflect.get(process, 'emitWarning')
    expect(await ctx.sessionPersistence.list()).toEqual([])
    expect(Reflect.get(process, 'emitWarning')).toBe(emitWarning)
    expect(typeof (await stat(path)).size).toBe('number')
    await ctx.fiber.dispose()
  })

  it('disposes after path validation without opening the database', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-unused-')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionPersistenceSqlite, { path })
    await ctx.fiber.dispose()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })

    /** 中文说明：变量 untouchedPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const untouchedPath = await freshDbPath('dsh-sqlite-never-validated-')
    /** 中文说明：变量 untouched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const untouched = new SqliteStore({
      path: untouchedPath,
      journalMode: 'wal',
      busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS,
    })
    await untouched.close()
    await expect(stat(untouchedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses constructor defaults and exposes locate and prepare directly', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 persistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let persistence!: SessionPersistenceSqlite
    await ctx.plugin(Object.assign((inner: Context) => {
      persistence = new SessionPersistenceSqlite(inner, { path: ':memory:' })
    }, { inject: ['sessions'] }))

    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('direct-provider')
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = chunkLog(3)
    expect(persistence.locate(header)).toBeUndefined()
    await persistence.create(header)
    await persistence.append(header.id, events)
    /** 中文说明：变量 preparation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparation = await persistence.prepare(header.id)
    expect(preparation.session.header).toEqual(header)
    preparation[Symbol.dispose]()
    await ctx.fiber.dispose()
  })

  it('keeps empty mutations inert and rolls back a repair without metadata', async () => {
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({
      path: ':memory:',
      journalMode: 'wal',
      busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS,
    })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('empty-store')
    await store.appendBatch(header, [], false)
    await store.commitRepair(header, undefined, [])
    expect(await store.readStoredRevision(header.id)).toBeUndefined()
    await expect(store.commitRepair(header, 0, [])).rejects.toThrow(/metadata row is missing/)
    await store.close()
  })

  it('rejects omitted torn markers and stale closer positions', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-repair-validation-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('repair-validation')
    await store.appendBatch(header, [chunk(0)], false)
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    db.prepare(testSql('insert-corrupt-event')).run(header.id, 1, 'assistant/chunk', 2, '{not json', null)
    db.close()
    await expect(store.commitRepair(header, undefined, [chunk(1)])).rejects.toThrow(/omitted current torn tail/)
    await store.commitRepair(header, 1, [])
    await expect(store.commitRepair(header, undefined, [chunk(2)])).rejects.toThrow(/closer starts at seq 2/)

    /** 中文说明：变量 cleared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleared = new DatabaseSync(path)
    cleared.prepare(testSql('delete-session-events')).run(header.id)
    cleared.close()
    await store.commitRepair(header, undefined, [chunk(0)])
    expect((await store.loadStored(header.id))?.events).toEqual([chunk(0)])
    await store.close()
  })

  it('rejects malformed physical tail rows before appending', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-tail-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const header = meta('invalid-tail')
    await store.appendBatch(header, [chunk(0)], false)
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(path)
    db.prepare(testSql('insert-corrupt-event'))
      .run(header.id, 1, 'assistant/chunk', 2, '{not json', null)
    db.close()

    await expect(store.appendBatch(header, [chunk(2)], true)).rejects.toThrow(/invalid physical tail/)
    await store.close()
  })

  it('rejects missing and empty store identities', async () => {
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const mode of ['missing', 'empty'] as const) {
      /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const path = await freshDbPath(`dsh-sqlite-identity-${mode}-`)
      /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const db = await openDatabase(DatabaseSync, path, 'wal', DEFAULT_BUSY_TIMEOUT_MS)
      if (mode === 'missing') db.exec(testSql('delete-persistence-state'))
      else db.exec(testSql('empty-store-id'))
      db.close()
      await chmod(path, 0o600)

      expect(errorMessage(await backendFailure(path))).toMatch(/no valid store identity/)
    }
  })

  it('rejects invalid paths during service initialization', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-invalid-path-')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await expect(ctx.plugin(SessionPersistenceSqlite, { path: `${path}\0` })).rejects.toMatchObject({
      code: 'ERR_INVALID_ARG_VALUE',
    })
    await ctx.fiber.dispose()
  })

  it('rejects non-files and symbolic links', async () => {
    /** 中文说明：变量 directoryPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directoryPath = await freshDbPath('dsh-sqlite-directory-')
    await mkdir(directoryPath)
    expect(errorMessage(await backendFailure(directoryPath)))
      .toMatch(/must be a regular file/)

    /** 中文说明：变量 linkPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const linkPath = await freshDbPath('dsh-sqlite-link-')
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = join(linkPath, '..', 'target.db')
    await writeFile(target, '')
    await symlink(target, linkPath)
    expect(errorMessage(await backendFailure(linkPath)))
      .toMatch(/not a symbolic link/)

    /** 中文说明：变量 parentLinkPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentLinkPath = await freshDbPath('dsh-sqlite-parent-link-')
    /** 中文说明：变量 realParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realParent = join(parentLinkPath, '..', 'real-parent')
    /** 中文说明：变量 linkedParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const linkedParent = join(parentLinkPath, '..', 'linked-parent')
    await mkdir(realParent, { mode: 0o700 })
    await symlink(realParent, linkedParent)
    expect(errorMessage(await backendFailure(join(linkedParent, 'sessions.db'))))
      .toMatch(/must be a real directory/)
  })

  it.runIf(
    process.getuid !== undefined && process.getuid() !== 0,
  )('rejects permissive files and writable parents', async () => {
    /** 中文说明：变量 permissivePath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const permissivePath = await freshDbPath('dsh-sqlite-permissive-')
    await writeFile(permissivePath, '')
    await chmod(permissivePath, 0o644)
    expect(errorMessage(await backendFailure(permissivePath)))
      .toMatch(/accessible only by that user/)

    /** 中文说明：变量 writableParentPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const writableParentPath = await freshDbPath('dsh-sqlite-parent-')
    await chmod(join(writableParentPath, '..'), 0o770)
    expect(errorMessage(await backendFailure(writableParentPath)))
      .toMatch(/not group\/world-writable/)
  })

  it('surfaces database creation failures after path validation', async () => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = await freshDbPath('dsh-sqlite-create-failure-')
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = new SqliteStore({ path, journalMode: 'wal', busyTimeoutMs: DEFAULT_BUSY_TIMEOUT_MS })
    await store.validatePath()
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = join(path, '..')
    await rm(parent, { recursive: true })
    await writeFile(parent, 'not a directory')
    await expect(store.open()).rejects.toThrow(/ENOENT|ENOTDIR/)
    await store.close()
  })
})
