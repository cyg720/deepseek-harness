/**
 * 文件职责：验证 differential.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionPersistenceSqlite from '@deepseek-ai/dsh-session-persistence-sqlite'
import { meta } from '../../session-persistence/tests/contract.ts'
import { testSql } from './test-sql.ts'

/** 中文说明：type BackendName 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
type BackendName = 'jsonl-zstd' | 'sqlite'

/** 中文说明：interface MountedBackend 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
interface MountedBackend {
  readonly persistence: SessionPersistence
  dispose(): Promise<void>
}

/** 中文说明：变量 directories 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const directories: string[] = []
afterEach(async () => {
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** 中文说明：函数 freshDirectory 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function freshDirectory(prefix: string): Promise<string> {
  /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

/** 中文说明：函数 mount 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mount(name: BackendName, root: string): Promise<MountedBackend> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  switch (name) {
    case 'jsonl-zstd': {
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'jsonl') })
      return { persistence: ctx.sessionPersistence, dispose: async () => { await fiber.dispose() } }
    }
    case 'sqlite': {
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await ctx.plugin(SessionPersistenceSqlite, { path: join(root, 'sessions.db') })
      return { persistence: ctx.sessionPersistence, dispose: async () => { await fiber.dispose() } }
    }
  }
}

/** 中文说明：函数 closedChunkLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function closedChunkLog(
  entries: readonly { readonly chunk: StreamChunk; readonly time: number; readonly ignorable?: true }[],
): SessionEvent[] {
  /** 中文说明：函数值 chunks 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const chunks = entries.map(({ chunk, time, ignorable }, index): SessionEvent => ({
    type: 'assistant/chunk',
    seq: index + 2,
    time,
    data: { turn: 1, step: 1, chunk },
    ...ignorable === true ? { ignorable } : {},
  }))
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
    ...chunks,
    { type: 'step/end', seq: chunks.length + 2, time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'turn/end',
      seq: chunks.length + 3,
      time: 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    },
  ]
}

/** 中文说明：函数 packingMatrixLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function packingMatrixLog(): SessionEvent[] {
  /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries: { chunk: StreamChunk; time: number; ignorable?: true }[] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      chunk: { type: 'text-delta' as const, index: 0, text: `text-${index}` },
      time: 1_000 + index,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      chunk: { type: 'reasoning-delta' as const, index: 1, text: `reason-${index}` },
      time: 990 - index,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      chunk: {
        type: 'tool-call-delta' as const,
        index: 2,
        id: CallId('named-call'),
        name: 'write',
        argumentsDelta: `{${index}`,
      },
      time: 2_000 + index,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      chunk: {
        type: 'tool-call-delta' as const,
        index: 3,
        id: CallId('unnamed-call'),
        argumentsDelta: `${index}}`,
      },
      time: 3_000 + index,
    })),
    { chunk: { type: 'block-start', index: 4, blockType: 'text' }, time: 4_000 },
    { chunk: { type: 'text-delta', index: 4, text: 'short-a' }, time: 4_001 },
    { chunk: { type: 'text-delta', index: 4, text: 'short-b' }, time: 4_002 },
    { chunk: { type: 'text-delta', index: 5, text: 'scalar-envelope' }, time: 4_003, ignorable: true },
    { chunk: { type: 'finish', reason: { kind: 'stop' } }, time: 4_004 },
  ]
  return closedChunkLog(entries)
}

/** 中文说明：函数 storageTagCollisionLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function storageTagCollisionLog(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    ...['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].map((type, index) => ({
      type,
      seq: index + 1,
      time: index + 2,
      data: { future: true },
      ignorable: true as const,
    }) as unknown as SessionEvent),
    { type: 'turn/end', seq: 4, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

/** 中文说明：函数 batches 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function batches(events: readonly SessionEvent[], sizes: readonly number[]): SessionEvent[][] {
  /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const result: SessionEvent[][] = []
  /** 中文说明：变量 offset 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let offset = 0
  /** 中文说明：变量 index 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let index = 0
  while (offset < events.length) {
    /** 中文说明：变量 size 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const size = sizes[index % sizes.length] as number
    result.push(events.slice(offset, offset + size))
    offset += size
    index += 1
  }
  return result
}

/** 中文说明：函数 verifyBackend 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function verifyBackend(
  name: BackendName,
  root: string,
  events: readonly SessionEvent[],
  sizes: readonly number[],
): Promise<void> {
  /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const header = { ...meta('differential', '/work'), delegationDepth: 0 }
  /** 中文说明：变量 mounted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let mounted = await mount(name, root)
  try {
    await mounted.persistence.create(header)
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const batch of batches(events, sizes)) {
      await mounted.persistence.append(header.id, batch)
    }
    expect(await mounted.persistence.inspect(header.id), name).toEqual({ meta: header, events })
    expect(await mounted.persistence.list(), name).toEqual([header])
    /** 中文说明：变量 revision 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const revision = (await mounted.persistence.listSnapshots())[0]?.revision
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (let fromSeq = 0; fromSeq <= events.length + 1; fromSeq += 1) {
      expect((await mounted.persistence.readFrom(header.id, fromSeq)).events, `${name} seq ${fromSeq}`)
        .toEqual(events.slice(fromSeq))
    }
    expect((await mounted.persistence.listSnapshots())[0]?.revision, name).toBe(revision)
  } finally {
    await mounted.dispose()
  }

  mounted = await mount(name, root)
  try {
    expect(await mounted.persistence.inspect(header.id), `${name} reopen`).toEqual({ meta: header, events })
  } finally {
    await mounted.dispose()
  }
}

/** 中文说明：变量 streamChunkArbitrary 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const streamChunkArbitrary: fc.Arbitrary<StreamChunk> = fc.oneof(
  fc.record({ type: fc.constant<'text-delta'>('text-delta'), index: fc.nat(2), text: fc.string() }),
  fc.record({ type: fc.constant<'reasoning-delta'>('reasoning-delta'), index: fc.nat(2), text: fc.string() }),
  fc.record({
    type: fc.constant<'tool-call-delta'>('tool-call-delta'),
    index: fc.nat(2),
    id: fc.constantFrom(CallId('call-1'), CallId('call-2')),
    argumentsDelta: fc.string(),
  }),
  fc.record({
    type: fc.constant<'tool-call-delta'>('tool-call-delta'),
    index: fc.nat(2),
    id: fc.constantFrom(CallId('call-1'), CallId('call-2')),
    name: fc.constantFrom('read', 'write'),
    argumentsDelta: fc.string(),
  }),
  fc.record({
    type: fc.constant<'block-start'>('block-start'),
    index: fc.nat(2),
    blockType: fc.constant<'text'>('text'),
  }),
  fc.record({ type: fc.constant<'finish'>('finish'), reason: fc.constant({ kind: 'stop' as const }) }),
)

/** 中文说明：变量 randomWorkload 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const randomWorkload = fc.record({
  entries: fc.array(fc.record({
    chunk: streamChunkArbitrary,
    time: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 0, max: 10_000 }) },
      { weight: 1, arbitrary: fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }) },
    ),
    ignorable: fc.option(fc.constant<true>(true), { nil: undefined }),
  }), { maxLength: 30 }),
  batchSizes: fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 8 }),
}).map(({ entries, batchSizes }) => ({
  events: JSON.parse(JSON.stringify(closedChunkLog(entries.map(({ chunk, time, ignorable }) => ({
    chunk,
    time,
    ...ignorable === true ? { ignorable } : {},
  }))))) as SessionEvent[],
  batchSizes,
}))

describe('SQLite cross-backend differential behavior', () => {
  it('preserves ignorable logical events whose names match physical storage tags', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = storageTagCollisionLog()
    /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const directory = await freshDirectory('dsh-sqlite-storage-tag-collision-')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = join(directory, 'sqlite')
    await verifyBackend('sqlite', root, events, [2, 1])
    /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const db = new DatabaseSync(join(root, 'sessions.db'), { readOnly: true })
    try {
      expect(db.prepare(testSql('count-physical-types')).all()).toEqual([])
      expect(db.prepare(testSql('count-ignorable-events')).get()).toEqual({ count: 3 })
    } finally {
      db.close()
    }
  })

  it('matches JSONL/Zstandard for every packed kind, scalar fallback, suffix, partition, and reopen', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = packingMatrixLog()
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const [partitionIndex, sizes] of [[events.length], [1], [2, 1, 5, 3]].entries()) {
      /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const directory = await freshDirectory(`dsh-sqlite-matrix-${partitionIndex}-`)
      /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
      for (const name of ['jsonl-zstd', 'sqlite'] as const) {
        /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const root = join(directory, name)
        await verifyBackend(name, root, events, sizes)
        if (name === 'sqlite') {
          /** 中文说明：变量 db 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const db = new DatabaseSync(join(root, 'sessions.db'), { readOnly: true })
          try {
            expect(db.prepare(testSql('count-physical-types')).all()).toEqual([
              [
                { type: 'reasoning-chunks', count: 1 },
                { type: 'text-chunks', count: 1 },
                { type: 'tool-call-chunks', count: 2 },
              ],
              [],
              [
                { type: 'reasoning-chunks', count: 1 },
                { type: 'text-chunks', count: 1 },
                { type: 'tool-call-chunks', count: 1 },
              ],
            ][partitionIndex])
            expect(db.prepare(testSql('count-ignorable-events')).get())
              .toEqual({ count: 1 })
          } finally {
            db.close()
          }
        }
      }
    }
  }, 30_000)

  it('matches JSONL/Zstandard across randomized logical logs and append partitions', async () => {
    await fc.assert(fc.asyncProperty(randomWorkload, async ({ events, batchSizes }) => {
      /** 中文说明：变量 directory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const directory = await freshDirectory('dsh-sqlite-property-')
      /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
      for (const name of ['jsonl-zstd', 'sqlite'] as const) {
        await verifyBackend(name, join(directory, name), events, batchSizes)
      }
    }), { numRuns: 100, seed: 0x5A17E })
  }, 60_000)

})
