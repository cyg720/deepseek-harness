/**
 * 文件职责：验证 coordinator-contract.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
/**
 * Shared write-path orchestration contract for backends using {@link PersistenceCoordinator}.
 * Unlike the public storage-semantics suite in `contract.ts`, it covers SessionStore event wiring,
 * lazy creation, fork seed persistence, four adoption/collision cases, crash-tail repair, reload,
 * flush, and disposal quiescence through public APIs rather than storage primitives.
 *
 * Each real backend supplies a shared storage scope and optional torn-tail injector; backend specs
 * retain only storage-mechanics tests, while these scenarios run once per backend.
 * @module @deepseek-ai/dsh-session-persistence/tests/coordinator-contract
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { meta, oneTurnLog, appendLog } from './contract.ts'

/**
 * The backend-specific capabilities the orchestration suite needs beyond the
 * public service API. A fresh fixture is created per test (isolated storage);
 * the suite mounts/disposes backend instances on it and cleans it up at the end.
 */
/* 中文说明：interface CoordinatorFixture 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
export interface CoordinatorFixture {
  /** Mount the real backend through `ctx.plugin` over shared storage and return only that fiber. */
  mount: (ctx: Context) => Promise<Fiber>

  /**
   * Inject a never-committed partial record after the durable region so `loadCore` reaches
   * `commitRepair`. Omit only when the backend structurally cannot produce torn tails.
   */
  corruptTail?: (id: SessionId, cwd: string | undefined) => Promise<void>

  /** Tear down the storage scope (remove the temp dir / file). */
  cleanup: () => Promise<void>
}

/** A constant absolute cwd; jsonl keys directories off it, memory/sqlite ignore it. */
/* 中文说明：常量 WORK 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const WORK = '/w'
/** 中文说明：常量 OTHER 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const OTHER = '/other'

/** Append a whole event log to a live session, event by event (drives session/event). */
/* 中文说明：函数 send 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function send(session: Session, events: readonly SessionEvent[]): void {
  appendLog(session, events)
}

/** A valid persisted log from immediately before messages gained wrappers and identities. */
/* 中文说明：函数 legacyMessageLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function legacyMessageLog(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    {
      type: 'user/message',
      seq: 1,
      time: 2,
      data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'step/start', seq: 2, time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: 3,
      time: 4,
      data: {
        turn: 1,
        step: 1,
        content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }],
        provenance: { provider: 'mock', model: 'mock' },
      },
      surfaceOp: 'append',
    },
    {
      type: 'tool/call',
      seq: 4,
      time: 5,
      data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{}' },
    },
    {
      type: 'tool/result',
      seq: 5,
      time: 6,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-1',
        content: [{ type: 'text', text: 'full result' }],
        isError: false,
      },
      sourceEventSeqs: [4],
      surfaceOp: 'append',
    },
    {
      type: 'tool/result',
      seq: 6,
      time: 8,
      data: {
        turn: 1,
        step: 1,
        callId: 'call-1',
        content: [{ type: 'text', text: 'pruned' }],
        isError: false,
      },
      sourceEventSeqs: [5],
      surfaceOp: { op: 'replace', start: 5, end: 5 },
    },
    { type: 'step/end', seq: 7, time: 9, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 8, time: 10, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
}

/** A complete log in the durable event vocabulary of the react-loop refactor base. */
/* 中文说明：函数 preReactLoopLog 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function preReactLoopLog(): SessionEvent[] {
  /** 中文说明：变量 prompt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const prompt = createUserMessage({
    content: [{ type: 'text', text: 'old prompt' }],
    source: { kind: 'user' },
  })
  /** 中文说明：变量 steering 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const steering = createUserMessage({
    content: [{ type: 'text', text: 'old steering' }],
    source: { kind: 'user' },
  })
  return [
    {
      type: 'turn/start', seq: 0, time: 1,
      data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    { type: 'user/message', seq: 1, time: 2, data: prompt, surfaceOp: 'append' },
    { type: 'step/start', seq: 2, time: 3, data: { turn: 1, step: 1 } },
    {
      type: 'steering/message', seq: 3, time: 4,
      data: { turn: 1, message: steering },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: 4, time: 5, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 6, time: 7, data: { turn: 2, trigger: { kind: 'retry' } } },
    { type: 'step/start', seq: 7, time: 8, data: { turn: 2, step: 1 } },
    { type: 'step/end', seq: 8, time: 9, data: { turn: 2, step: 1 } },
    {
      type: 'turn/end', seq: 9, time: 10,
      data: {
        turn: 2,
        reason: {
          kind: 'error',
          step: 1,
          failure: { message: 'old provider failure', code: 'SERVER' },
        },
      },
    },
    {
      type: 'turn/start', seq: 10, time: 11,
      data: { turn: 3, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    { type: 'turn/end', seq: 11, time: 12, data: { turn: 3, reason: { kind: 'aborted' } } },
    {
      type: 'turn/start', seq: 12, time: 13,
      data: { turn: 4, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    { type: 'turn/end', seq: 13, time: 14, data: { turn: 4, reason: { kind: 'disposed' } } },
    {
      type: 'turn/start', seq: 14, time: 15,
      data: { turn: 5, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    { type: 'step/start', seq: 15, time: 16, data: { turn: 5, step: 1 } },
    { type: 'step/end', seq: 16, time: 17, data: { turn: 5, step: 1 } },
    {
      type: 'turn/end', seq: 17, time: 18,
      data: { turn: 5, reason: { kind: 'error', step: 1, message: 'old thrown value' } },
    },
    {
      type: 'turn/start', seq: 18, time: 19,
      data: { turn: 6, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    {
      type: 'turn/end', seq: 19, time: 20,
      data: {
        turn: 6,
        reason: {
          kind: 'error',
          step: 0,
          failure: {
            message: 'old detailed provider failure',
            code: 'RATE_LIMIT',
            status: 429,
            providerRetryAfterMs: 1000,
            requestId: 'request-1',
          },
        },
      },
    },
    {
      type: 'turn/start', seq: 20, time: 21,
      data: { turn: 7, trigger: { kind: 'message', source: { kind: 'user' } } },
    },
    {
      type: 'turn/end', seq: 21, time: 22,
      data: { turn: 7, reason: { kind: 'error', step: 0, message: 'old coded error', code: 'CODED' } },
    },
  ] as unknown as SessionEvent[]
}

/** A live session created inside its OWN fiber, so it survives a backend reload. */
/* 中文说明：函数 liveSessionInFiber 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function liveSessionInFiber(
  ctx: Context, id: string, cwd: string | undefined,
): Promise<Session> {
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let session!: Session
  await ctx.plugin(Object.assign((inner: Context) => {
    session = inner.sessions.create(SessionId(id), cwd !== undefined ? { meta: { cwd } } : undefined)
  }, { inject: ['sessions'] }))
  return session
}

/**
 * Run the coordinator orchestration suite against a backend. `makeFixture()`
 * MUST return a fresh fixture (isolated storage) each call.
 */
/* 中文说明：函数 runCoordinatorContract 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
export function runCoordinatorContract(name: string, makeFixture: () => Promise<CoordinatorFixture>): void {
  describe(`PersistenceCoordinator orchestration: ${name}`, () => {
    /** Mount SessionStore + a backend instance on a fresh context over the fixture's storage. */
    /* 中文说明：函数 freshCtx 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
    async function freshCtx(fix: CoordinatorFixture): Promise<{ ctx: Context; fiber: Fiber }> {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await fix.mount(ctx)
      return { ctx, fiber }
    }

    // --- write path: live session → flush → reload ---

    it('persists a live session driven through the store, surviving reload', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(SessionId('live'), { meta: { cwd: WORK } })
        send(session, oneTurnLog())
        await ctx.sessions.flush(session)

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('live'))
        expect(loaded.events).toHaveLength(6)
        expect(loaded.meta.cwd).toBe(WORK)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rejects crash-repair load while a live session owns the persisted prefix', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let session!: Session
      /** 中文说明：函数值 sessionFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const sessionFiber = await ctx.plugin(Object.assign((inner: Context) => {
        session = inner.sessions.create(SessionId('live-load'), { meta: { cwd: WORK } })
      }, { inject: ['sessions'] }))
      try {
        session.append('turn/start', { turn: 1 })
        await ctx.sessions.flush(session)

        await expect(ctx.sessionPersistence.load(session.id))
          .rejects.toThrow(`cannot load session "${session.id}" while its live turn is open`)

        send(session, oneTurnLog().slice(1))
        await ctx.sessions.flush(session)
        await sessionFiber.dispose()

        await vi.waitFor(async () => {
          /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const loaded = await ctx.sessionPersistence.load(session.id)
          expect(loaded.events.map(event => event.type)).toEqual(oneTurnLog().map(event => event.type))
          expect(loaded.events.at(-1)).toMatchObject({
            type: 'turn/end',
            data: { reason: { kind: 'completed' } },
          })
        })
      } finally {
        await sessionFiber.dispose()
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rechecks live ownership after a cold load enters the per-id chain', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('queued-load-live-race')
        /** 中文说明：变量 header 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const header = meta(id, WORK)
        /** 中文说明：变量 start 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const start: SessionEvent = {
          type: 'turn/start',
          seq: 0,
          time: 1,
          data: { turn: 1 },
        }
        await ctx.sessionPersistence.create(header)
        await ctx.sessionPersistence.append(id, [start])

        /** 中文说明：变量 loading 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loading = ctx.sessionPersistence.load(id)
        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(id, { seed: [start], meta: header })
        await expect(loading).rejects.toThrow(/live turn is open/)

        live.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(live)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(id)
        // The constructor's end-seed event persisted between the stored
        // turn/start and the turn/end appended live.
        expect(loaded.events.map(event => event.type)).toEqual(['turn/start', 'session/end-seed', 'turn/end'])
        expect(loaded.events.at(-1)).toMatchObject({
          type: 'turn/end',
          data: { reason: { kind: 'completed' } },
        })
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('does not load an unmaterialized empty live session', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(SessionId('empty-live'), { meta: { cwd: WORK } })
        await expect(ctx.sessionPersistence.load(session.id)).rejects.toThrow(/not found/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('round-trips the seed boundary (seedLength) through persistence', async () => {
      // A forked child records how many leading events were inherited via the seed; the
      // boundary must survive a reload (so a resume/replay can tell the inherited prefix from
      // the child's own events). JSONL stores it in the header; SQLite uses `seed_length`.
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let session!: Session
        /** 中文说明：函数值 sessionFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const sessionFiber = await ctx.plugin(Object.assign((inner: Context) => {
          session = inner.sessions.create(SessionId('forked-child'), { meta: { cwd: WORK, seedLength: 3 } })
        }, { inject: ['sessions'] }))
        send(session, oneTurnLog())
        await ctx.sessions.flush(session)
        await sessionFiber.dispose()

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('forked-child'))
        expect(loaded.meta.seedLength).toBe(3)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('round-trips the delegation depth through persistence', async () => {
      // A subagent child's recursion budget lives in its header; a reload that
      // dropped it would reset the child to top-level and un-bound maxDepth
      // (JSONL stores it in the header line; SQLite uses `delegation_depth`).
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let session!: Session
        /** 中文说明：函数值 sessionFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const sessionFiber = await ctx.plugin(Object.assign((inner: Context) => {
          session = inner.sessions.create(SessionId('delegated-child'), {
            meta: { cwd: WORK, parentSession: SessionId('root'), delegationDepth: 2 },
          })
        }, { inject: ['sessions'] }))
        send(session, oneTurnLog())
        await ctx.parallel('session/flush', session)
        await sessionFiber.dispose()

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('delegated-child'))
        expect(loaded.meta.delegationDepth).toBe(2)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('source-frozen events cannot be mutated after buffering and persist unchanged', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(SessionId('mutate'), { meta: { cwd: WORK } })
        session.append('turn/start', { turn: 1 })
        /** 中文说明：变量 ev 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const ev = session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'original' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        expect(() => {
          ;(ev.data as { content: { type: 'text'; text: string }[] }).content[0]!.text = 'HACKED'
        }).toThrow(TypeError)
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('mutate'))
        /** 中文说明：函数值 message 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const message = loaded.events.find(event => event.type === 'user/message')
        expect(message?.type === 'user/message' && (message.data.content[0] as { text: string }).text).toBe('original')
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('load and inspect return immutable identified-message snapshots', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('immutable-read')
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(id, { meta: { cwd: WORK } })
        send(session, oneTurnLog())
        await ctx.sessions.flush(session)

        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const snapshot of [
          await ctx.sessionPersistence.load(id),
          await ctx.sessionPersistence.inspect(id),
        ]) {
          /** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
          const event = snapshot.events.find(candidate => candidate.type === 'user/message')
          if (event?.type !== 'user/message') throw new Error('fixture lacks user/message')
          expect(Object.isFrozen(event.data)).toBe(true)
          expect(Object.isFrozen(event.data.content)).toBe(true)
          expect(() => {
            ;(event.data as { id: string }).id = 'rewritten'
          }).toThrow(TypeError)
          expect(() => {
            ;(event.data.content[0] as { type: 'text'; text: string }).text = 'rewritten'
          }).toThrow(TypeError)
        }
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('loads pre-identity message logs into resumable current sessions', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('legacy-message-load')
        await ctx.sessionPersistence.create(meta(id, WORK))
        await ctx.sessionPersistence.append(id, legacyMessageLog())

        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const snapshot of [
          await ctx.sessionPersistence.inspect(id),
          await ctx.sessionPersistence.load(id),
        ]) {
          /** 中文说明：变量 messages 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const messages: { id: string }[] = []
          /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
          for (const event of snapshot.events) {
            if (event.type === 'user/message') messages.push(event.data)
            else if (event.type === 'assistant/message'
              || event.type === 'tool/result') messages.push(event.data.message)
          }
          expect(messages.map(message => message.id)).toEqual([
            `legacy-message:${id}:1`,
            `legacy-message:${id}:3`,
            `legacy-message:${id}:5`,
            `legacy-message:${id}:5`,
          ])
          expect(messages.every(message => Object.isFrozen(message))).toBe(true)

          /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const resumed = Session.create(id, snapshot.events, snapshot.meta)
          expect(resumed.deriveMessages().map(message => message.id)).toEqual([
            `legacy-message:${id}:1`,
            `legacy-message:${id}:3`,
            `legacy-message:${id}:5`,
          ])
        }

        /** 中文说明：变量 replacementSuffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const replacementSuffix = await ctx.sessionPersistence.readFrom(id, 6)
        expect(replacementSuffix.events[0]).toMatchObject({
          type: 'tool/result',
          seq: 6,
          data: { message: { id: `legacy-message:${id}:5` } },
        })
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('loads pre-react-loop session logs into resumable current sessions', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('pre-react-loop-load')
        /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const log = preReactLoopLog()
        /** 中文说明：变量 legacySteering 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const legacySteering = log[3] as unknown as { data: { message: { id: string } } }
        await ctx.sessionPersistence.create(meta(id, WORK))
        await ctx.sessionPersistence.append(id, log)

        /** 中文说明：变量 snapshots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const snapshots = [
          await ctx.sessionPersistence.inspect(id),
          await ctx.sessionPersistence.readFrom(id, 0),
          await ctx.sessionPersistence.load(id),
        ]
        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const snapshot of snapshots) {
          expect(snapshot.events.some(event => (event.type as string) === 'steering/message')).toBe(false)
          expect(snapshot.events.filter(event => event.type === 'turn/start').map(event => event.data))
            .toEqual([
              { turn: 1 }, { turn: 2 }, { turn: 3 }, { turn: 4 }, { turn: 5 }, { turn: 6 }, { turn: 7 },
            ])
          expect(snapshot.events.filter(event => event.type === 'turn/end').map(event => event.data)).toEqual([
            { turn: 1, reason: { kind: 'completed' } },
            {
              turn: 2,
              reason: { kind: 'error', error: { message: 'old provider failure', code: 'SERVER' } },
            },
            { turn: 3, reason: { kind: 'aborted', reason: { kind: 'legacy' } } },
            { turn: 4, reason: { kind: 'aborted', reason: { kind: 'disposed' } } },
            {
              turn: 5,
              reason: { kind: 'error', error: { message: 'old thrown value', code: 'UNKNOWN' } },
            },
            {
              turn: 6,
              reason: {
                kind: 'error',
                error: {
                  message: 'old detailed provider failure',
                  code: 'RATE_LIMIT',
                  status: 429,
                  providerRetryAfterMs: 1000,
                  requestId: 'request-1',
                },
              },
            },
            {
              turn: 7,
              reason: { kind: 'error', error: { message: 'old coded error', code: 'CODED' } },
            },
          ])

          /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const resumed = Session.create(id, snapshot.events, snapshot.meta)
          expect(resumed.deriveMessages().map(message => message.content)).toEqual([
            [{ type: 'text', text: 'old prompt' }],
            [{ type: 'text', text: 'old steering' }],
          ])
        }

        /** 中文说明：变量 suffix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const suffix = await ctx.sessionPersistence.readFrom(id, 3)
        expect(suffix.events[0]).toMatchObject({
          type: 'user/message',
          seq: 3,
          data: { id: legacySteering.data.message.id },
        })
        expect(suffix.events.filter(event => event.type === 'turn/end')
          .every(event => !Object.hasOwn(event.data, 'step'))).toBe(true)

        /** 中文说明：变量 flatId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const flatId = SessionId('pre-react-loop-flat-steering')
        await ctx.sessionPersistence.create(meta(flatId, WORK))
        await ctx.sessionPersistence.append(flatId, [{
          type: 'steering/message',
          seq: 0,
          time: 1,
          data: {
            turn: 1,
            content: [{ type: 'text', text: 'flat steering' }],
            source: { kind: 'user' },
          },
          surfaceOp: 'append',
        } as unknown as SessionEvent])
        expect((await ctx.sessionPersistence.inspect(flatId)).events[0]).toMatchObject({
          type: 'user/message',
          data: {
            id: `legacy-message:${flatId}:0`,
            role: 'user',
            content: [{ type: 'text', text: 'flat steering' }],
          },
        })

        /** 中文说明：变量 extendedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const extendedId = SessionId('current-extended-turn-end')
        await ctx.sessionPersistence.create(meta(extendedId, WORK))
        await ctx.sessionPersistence.append(extendedId, [
          { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
          {
            type: 'turn/end', seq: 1, time: 2,
            data: { turn: 1, reason: { kind: 'extension-reason' } },
          } as unknown as SessionEvent,
        ])
        expect((await ctx.sessionPersistence.inspect(extendedId)).events[1]).toMatchObject({
          type: 'turn/end',
          data: { reason: { kind: 'extension-reason' } },
        })
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rejects malformed persisted message events before returning them', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('invalid-message-read')
        await ctx.sessionPersistence.create(meta(id, WORK))
        await ctx.sessionPersistence.append(id, [{
          type: 'user/message',
          seq: 0,
          time: 1,
          surfaceOp: 'append',
          data: {
            id: 'wrong-role',
            role: 'assistant',
            content: [{ type: 'text', text: 'wrong' }],
            source: { kind: 'user' },
          },
        } as unknown as SessionEvent])

        await expect(ctx.sessionPersistence.inspect(id))
          .rejects.toThrow('message must have role "user"')
        await expect(ctx.sessionPersistence.load(id))
          .rejects.toThrow('message must have role "user"')

        /** 中文说明：变量 malformedLegacy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const malformedLegacy: { id: string; event: SessionEvent; message: string }[] = [
          {
            id: 'invalid-old-turn-start',
            event: {
              type: 'turn/start', seq: 0, time: 1,
              data: { turn: 1, trigger: null },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/start',
          },
          {
            id: 'invalid-old-steering',
            event: {
              type: 'steering/message', seq: 0, time: 1, surfaceOp: 'append',
              data: { turn: 1, content: [], source: { kind: 'user' }, extra: true },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop steering/message',
          },
          {
            id: 'invalid-old-steering-data',
            event: {
              type: 'steering/message', seq: 0, time: 1, surfaceOp: 'append', data: null,
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop steering/message',
          },
          {
            id: 'invalid-old-turn-end',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: { kind: 'completed', extra: true } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'invalid-old-turn-end-reason',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: null },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'unsupported-intermediate-turn-end-step',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, step: 1, reason: { kind: 'completed' } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'invalid-old-turn-end-aborted',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: { kind: 'aborted', extra: true } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'invalid-old-turn-end-disposed',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: { kind: 'disposed', extra: true } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'invalid-old-turn-end-error-step',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: { kind: 'error', step: -1, message: 'bad step' } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
          {
            id: 'invalid-old-turn-end-error-code',
            event: {
              type: 'turn/end', seq: 0, time: 1,
              data: { turn: 1, reason: { kind: 'error', step: 0, message: 'bad code', code: 1 } },
            } as unknown as SessionEvent,
            message: 'malformed pre-react-loop turn/end',
          },
        ]
        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const malformed of malformedLegacy) {
          /** 中文说明：变量 malformedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const malformedId = SessionId(malformed.id)
          await ctx.sessionPersistence.create(meta(malformedId, WORK))
          await ctx.sessionPersistence.append(malformedId, [malformed.event])
          await expect(ctx.sessionPersistence.inspect(malformedId)).rejects.toThrow(malformed.message)
          await expect(ctx.sessionPersistence.readFrom(malformedId, 0)).rejects.toThrow(malformed.message)
        }

        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const type of ['tool/result'] as const) {
          /** 中文说明：变量 malformedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const malformedId = SessionId(`invalid-${type}`)
          await ctx.sessionPersistence.create(meta(malformedId, WORK))
          await ctx.sessionPersistence.append(malformedId, [{
            type,
            seq: 0,
            time: 1,
            surfaceOp: 'append',
            data: { message: null },
          } as unknown as SessionEvent])
          await expect(ctx.sessionPersistence.inspect(malformedId))
            .rejects.toThrow('lacks an identified message')
        }

        // A known log-only event with non-object data is not a legacy message
        // candidate; both whole-log and seek reads preserve it unchanged.
        const primitiveId = SessionId('non-object-log-only-event')
        const primitive = {
          type: 'session/end-seed',
          seq: 0,
          time: 1,
          data: null,
        } as unknown as SessionEvent
        await ctx.sessionPersistence.create(meta(primitiveId, WORK))
        await ctx.sessionPersistence.append(primitiveId, [primitive])
        await expect(ctx.sessionPersistence.inspect(primitiveId))
          .resolves.toMatchObject({ events: [primitive] })
        await expect(ctx.sessionPersistence.readFrom(primitiveId, 0))
          .resolves.toMatchObject({ events: [primitive] })

        /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
        for (const type of ['user/message', 'assistant/message'] as const) {
          /** 中文说明：变量 missingContentId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
          const missingContentId = SessionId(`invalid-${type}-without-content`)
          await ctx.sessionPersistence.create(meta(missingContentId, WORK))
          await ctx.sessionPersistence.append(missingContentId, [{
            type,
            seq: 0,
            time: 1,
            surfaceOp: 'append',
            data: {},
          } as unknown as SessionEvent])
          await expect(ctx.sessionPersistence.readFrom(missingContentId, 0))
            .rejects.toThrow('lacks an identified message')
        }
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('append snapshots the batch: mutating the caller array/events after the call is ignored', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = meta('snapshot', WORK)
        await ctx.sessionPersistence.create(m)
        /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const events = structuredClone(oneTurnLog()) // seqs 0..5
        /** 中文说明：变量 userMsg 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const userMsg = events[1] // the user/message event
        /** 中文说明：变量 p 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const p = ctx.sessionPersistence.append(m.id, events)
        // Mutate the caller's array AND an event object after the call but before
        // the queued op runs: the snapshot taken at call time must shield the copy.
        events.push({ type: 'turn/start', seq: 6, time: 99, data: { turn: 2 } })
        if (userMsg?.type === 'user/message') {
          (userMsg.data as { content: unknown[] }).content = [{ type: 'text', text: 'MUTATED' }]
        }
        await p
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(m.id)
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5]) // not 0..6
        /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const persisted = JSON.stringify(loaded.events)
        expect(persisted).toContain('hi') // original content
        expect(persisted).not.toContain('MUTATED')
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- fork / resume ---

    it('fork: a seeded new session persists its seed once (no double-write on a no-op flush)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 seed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const seed = oneTurnLog()
        // A fork: a brand-new id whose seed came from elsewhere.
        /** 中文说明：变量 forked 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const forked = ctx.sessions.create(SessionId('forked'), { seed, meta: { cwd: WORK } })
        await ctx.sessions.flush(forked) // onCreated persisted the seed
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('forked'))
        // Fork is where the marker earns its keep: the inherited prefix may
        // carry a bracket the still-running parent owns.
        expect(loaded.events.slice(0, seed.length)).toEqual(seed)
        expect(loaded.events.at(-1)).toMatchObject({ type: 'session/end-seed', seq: seed.length })
        // A flush with no NEW events must not double-write.
        await ctx.sessions.flush(forked)
        /** 中文说明：变量 reloaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reloaded = await ctx.sessionPersistence.load(SessionId('forked'))
        expect(reloaded.events).toEqual(loaded.events)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('resume: a re-created session seeded with the loaded log does not re-append its seed and continues the seq', async () => {
      // Separate backend lifecycles distinguish persisted-seed adoption from an in-memory continuation.
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await freshCtx(fix)
      try {
        /** 中文说明：变量 s1 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const s1 = first.ctx.sessions.create(SessionId('resumed'), { meta: { cwd: WORK } })
        send(s1, oneTurnLog())
        await first.ctx.sessions.flush(s1)
      } finally {
        await first.fiber.dispose()
      }

      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await second.ctx.sessionPersistence.load(SessionId('resumed'))
        /** 中文说明：变量 s2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const s2 = second.ctx.sessions.create(SessionId('resumed'), { seed: loaded.events, meta: { cwd: WORK } })
        await second.ctx.sessions.flush(s2) // let onCreated adopt
        s2.append('turn/start', { turn: 2 })
        s2.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
        await second.ctx.sessions.flush(s2)

        /** 中文说明：变量 reloaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reloaded = await second.ctx.sessionPersistence.load(SessionId('resumed'))
        // 0-5 the resumed seed, 6 end-seed, 7-8 the new turn.
        expect(reloaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
        expect(reloaded.events[6]).toMatchObject({ type: 'session/end-seed' })
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- HMR ---

    it('HMR: applying the plugin seeds existing live sessions', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      // A session exists BEFORE the persistence plugin is applied.
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = ctx.sessions.create(SessionId('pre-existing'), { meta: { cwd: WORK } })
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await fix.mount(ctx)
      try {
        // The plugin seeded it on apply; a subsequent flush persists its events.
        await ctx.sessions.flush(session)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('pre-existing'))
        expect(loaded.events.length).toBeGreaterThanOrEqual(2)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('HMR: dispose drains remaining buffers', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fiber = await fix.mount(ctx)
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = await liveSessionInFiber(ctx, 'drain', WORK)
      session.append('turn/start', { turn: 1 })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'buffered' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      // No explicit flush — dispose must drain.
      await fiber.dispose()

      // A fresh backend instance reads what the disposed one drained.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await second.ctx.sessionPersistence.load(SessionId('drain'))
        expect(loaded.events.length).toBeGreaterThanOrEqual(2)
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })

    it('HMR: reloading the backend adopts a still-live, already-materialized session', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      // The session lives in its OWN fiber so it survives the backend reload.
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = await liveSessionInFiber(ctx, 'hmr-adopt', WORK)
      try {
        // Backend instance 1 materializes the session.
        /** 中文说明：变量 backend1 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const backend1 = await fix.mount(ctx)
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)

        // Hot-reload: dispose instance 1, mount instance 2 over the same storage while the
        // session stays live. The new instance has no coordinator state but must adopt the
        // materialized prefix, then persist another turn rather than rejecting it as a collision.
        await backend1.dispose()
        await fix.mount(ctx)
        session.append('turn/start', { turn: 2 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'again' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
        await expect(ctx.sessions.flush(session)).resolves.not.toThrow()

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('hmr-adopt'))
        expect(loaded.events.filter(e => e.type === 'turn/start')).toHaveLength(2)
      } finally {
        await ctx.fiber.dispose()
        await fix.cleanup()
      }
    })

    it('HMR: adoption persists the live SUFFIX that was ahead of the stored prefix', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = await liveSessionInFiber(ctx, 'hmr-suffix', WORK)
      try {
        // Instance 1 flushes turn 1.
        /** 中文说明：变量 backend1 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const backend1 = await fix.mount(ctx)
        session.append('turn/start', { turn: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)

        // Append turn 2 to the LIVE session, then dispose instance 1 WITHOUT
        // flushing turn 2: it is now ONLY in the live session's events; the new
        // backend never buffered it via session/event.
        await backend1.dispose()
        session.append('turn/start', { turn: 2 })
        session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })

        // Instance 2 adopts the stored prefix (turn 1) and MUST also persist the
        // live suffix (turn 2) carried in the session's events.
        await fix.mount(ctx)
        await ctx.sessions.flush(session)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('hmr-suffix'))
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3])
        expect(loaded.events.filter(e => e.type === 'turn/start')).toHaveLength(2)
      } finally {
        await ctx.fiber.dispose()
        await fix.cleanup()
      }
    })

    it('HMR adoption does NOT crash-repair an active open turn as interrupted (truncate without closers)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = await liveSessionInFiber(ctx, 'hmr-open', WORK)
      try {
        /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const first = await fix.mount(ctx)
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        await ctx.sessions.flush(session)

        // Crash-tail a torn fragment past the (open) committed turn, then reload.
        await first.dispose()
        if (fix.corruptTail) await fix.corruptTail(SessionId('hmr-open'), WORK)
        /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const second = await fix.mount(ctx)
        // The live session is still the authority: it appends the REAL step/turn
        // end. Adoption must truncate the torn tail but NOT synthesize closers.
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)

        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('hmr-open'))
        expect(loaded.events.map(e => e.type)).toEqual(['turn/start', 'step/start', 'step/end', 'turn/end'])
        expect(loaded.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
        await second.dispose()
      } finally {
        await ctx.fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- collision / id reuse ---

    it('a NEW live session colliding on a persisted id is rejected, not silently adopted', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await freshCtx(fix)
      try {
        /** 中文说明：变量 s1 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const s1 = first.ctx.sessions.create(SessionId('collide'), { meta: { cwd: WORK } })
        send(s1, oneTurnLog())
        await first.ctx.sessions.flush(s1)
      } finally {
        await first.fiber.dispose()
      }

      // A fresh backend + a NEW live session with the same id but NO explicit resume. onCreated
      // treats it as new; create() rejects because a log already exists, and `flush()` surfaces
      // that initialization rejection.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        /** 中文说明：变量 s2 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const s2 = second.ctx.sessions.create(SessionId('collide'), { meta: { cwd: WORK } })
        s2.append('turn/start', { turn: 1 })
        await expect(second.ctx.sessions.flush(s2))
          .rejects.toThrow(/already has a persisted log|id collision/)
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })

    it('an abandoned lazy session (never materialized) releases its id for reuse', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // A live session created then disposed BEFORE its first append: cursor 0,
        // never materialized. A new live session reusing the id must reclaim it.
        /** 中文说明：变量 firstSession 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let firstSession!: Session
        /** 中文说明：函数值 firstFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const firstFiber = await ctx.plugin(Object.assign((inner: Context) => {
          firstSession = inner.sessions.create(SessionId('abandoned'), { meta: { cwd: WORK } })
        }, { inject: ['sessions'] }))
        await ctx.sessions.flush(firstSession) // register the lazy state
        await firstFiber.dispose() // disposed before any append → never materialized

        /** 中文说明：变量 reuse 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let reuse!: Session
        await ctx.plugin(Object.assign((inner: Context) => {
          reuse = inner.sessions.create(SessionId('abandoned'), { meta: { cwd: WORK } })
        }, { inject: ['sessions'] }))
        await expect(ctx.sessions.flush(reuse)).resolves.toBe(true)
        reuse.append('turn/start', { turn: 1 })
        reuse.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(reuse)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('abandoned'))
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1])
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('session disposal drains buffered events before retiring ownership', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let first!: Session
        /** 中文说明：函数值 firstFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const firstFiber = await ctx.plugin(Object.assign((inner: Context) => {
          first = inner.sessions.create(SessionId('buffered'), { meta: { cwd: WORK } })
        }, { inject: ['sessions'] }))
        await ctx.sessions.flush(first)
        // Append a turn but do NOT flush — events sit in the write-behind buffer.
        first.append('turn/start', { turn: 1 })
        first.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await firstFiber.dispose()

        // Disposal is an observe-only notification. Poll storage rather than
        // assuming the owning fiber awaits the coordinator's detached drain.
        await vi.waitFor(async () => {
          expect((await ctx.sessionPersistence.list()).map(meta => meta.id)).toContain(SessionId('buffered'))
        })
        expect((await ctx.sessionPersistence.load(SessionId('buffered'))).events.map(event => event.seq)).toEqual([0, 1])

        /** 中文说明：变量 reuse 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let reuse!: Session
        await ctx.plugin(Object.assign((inner: Context) => {
          reuse = inner.sessions.create(SessionId('buffered'), { meta: { cwd: WORK } })
        }, { inject: ['sessions'] }))
        await expect(ctx.sessions.flush(reuse)).rejects.toThrow(/persisted log|id collision/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('initFor is idempotent: re-emitting session/created does not re-initialize', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(SessionId('idem'), { meta: { cwd: WORK } })
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'x' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)
        // Re-emit session/created for the SAME live session (idempotent initFor).
        ctx.emit(scopeTarget(session, undefined), 'session/created', session)
        await ctx.sessions.flush(session)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('idem'))
        expect(loaded.events).toHaveLength(3) // not doubled
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- ownerless-state claim (public create()/load() then a live session arrives) ---

    it('a live session claims cursor-0 ownerless state created via the public API and persists its seed', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // create() registers ownerless state with cursor 0 (lazy, nothing persisted).
        await ctx.sessionPersistence.create(meta('lazy-claim', WORK))
        // A live session with that id arrives and claims it (cursor 0 matches
        // trivially), persisting its seed.
        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(SessionId('lazy-claim'), { seed: oneTurnLog(), meta: { cwd: WORK } })
        await expect(ctx.sessions.flush(live)).resolves.toBe(true)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('lazy-claim'))
        // Seeded 0-5 plus the constructor's end-seed event at 6.
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6])
        expect(loaded.events.at(-1)).toMatchObject({ type: 'session/end-seed' })
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a fresh session reusing a previously-loaded id is rejected (ownerless guard)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // Materialize a log, then load() it WITHOUT a live session — ownerless
        // state, cursor at the persisted length.
        await ctx.sessionPersistence.create(meta('preview', WORK))
        await ctx.sessionPersistence.append(SessionId('preview'), oneTurnLog())
        await ctx.sessionPersistence.load(SessionId('preview'))

        // A FRESH (empty-seed) live session reusing that id must be rejected: its
        // seq 0..cursor-1 events would otherwise be filtered as already-persisted.
        /** 中文说明：变量 fresh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let fresh!: Session
        await ctx.plugin(Object.assign((inner: Context) => {
          fresh = inner.sessions.create(SessionId('preview'), { meta: { cwd: WORK } })
        }, { inject: ['sessions'] }))
        await expect(ctx.sessions.flush(fresh))
          .rejects.toThrow(/do not match this live session|already has a persisted log|id collision/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a live session whose complete seed matches loaded ownerless state claims it without appending', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 id 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const id = SessionId('claim-exact')
        /** 中文说明：变量 completeSeed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const completeSeed = [
          ...oneTurnLog(),
          { type: 'session/end-seed', seq: 6, time: 7, data: {} },
        ] as SessionEvent[]
        await ctx.sessionPersistence.create(meta(id, WORK))
        await ctx.sessionPersistence.append(id, completeSeed)
        const { events } = await ctx.sessionPersistence.load(id)

        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(id, { seed: events, meta: { cwd: WORK } })
        await expect(ctx.sessions.flush(live)).resolves.toBe(true)
        expect((await ctx.sessionPersistence.load(id)).events).toEqual(events)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a live session whose seed matches the loaded prefix claims ownerless state and persists the suffix', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // Materialize and load (ownerless, cursor = 6).
        /** 中文说明：变量 storedMeta 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const storedMeta = meta('claim', WORK)
        await ctx.sessionPersistence.create(storedMeta)
        await ctx.sessionPersistence.append(SessionId('claim'), oneTurnLog())
        const { events, meta: durableMeta } = await ctx.sessionPersistence.load(SessionId('claim'))

        // A live session SEEDED with the loaded log PLUS a new turn claims the
        // ownerless state and persists only the suffix.
        /** 中文说明：变量 cont 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        let cont!: Session
        /** 中文说明：函数值 contFiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const contFiber = await ctx.plugin(Object.assign((inner: Context) => {
          cont = inner.sessions.create(SessionId('claim'), { seed: [
            ...events,
            { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
            { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
          ], meta: { cwd: WORK, createdAt: 2000 } })
        }, { inject: ['sessions'] }))
        await ctx.sessions.flush(cont)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('claim'))
        // 6-7 the claimed suffix; 8 end-seed after the whole seed.
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
        expect(loaded.events.at(-1)).toMatchObject({ type: 'session/end-seed' })
        expect(loaded.meta).toEqual(durableMeta)
        expect(loaded.meta.createdAt).toBe(1000)

        await contFiber.dispose()
        await vi.waitFor(async () => {
          expect((await ctx.sessionPersistence.load(SessionId('claim'))).meta).toEqual(durableMeta)
        })
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a live session at a DIFFERENT cwd cannot claim cursor-0 ownerless state (cwd scope)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // create() registers ownerless state at cwd /a (cursor 0 — claims would
        // otherwise match trivially on the seed).
        await ctx.sessionPersistence.create(meta('wrong-cwd-claim', OTHER))
        // A live session reusing the id but at cwd WORK must NOT claim it — the
        // cwd scope is the fence (without it, WORK events would append under the
        // OTHER header). Rejected as a collision.
        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(SessionId('wrong-cwd-claim'), { seed: oneTurnLog(), meta: { cwd: WORK } })
        await expect(ctx.sessions.flush(live)).rejects.toThrow(/different cwd|id collision/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a live session at a DIFFERENT cwd cannot claim loaded-prefix ownerless state (cwd scope)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // Materialize + load at cwd OTHER (ownerless, cursor = 6).
        await ctx.sessionPersistence.create(meta('wrong-cwd-load', OTHER))
        await ctx.sessionPersistence.append(SessionId('wrong-cwd-load'), oneTurnLog())
        const { events } = await ctx.sessionPersistence.load(SessionId('wrong-cwd-load'))
        // A live session whose SEED matches the loaded prefix but whose cwd is
        // WORK must still be rejected — the cwd guard runs before the seed check.
        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(SessionId('wrong-cwd-load'), { seed: events, meta: { cwd: WORK } })
        await expect(ctx.sessions.flush(live)).rejects.toThrow(/different cwd|id collision/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('a no-cwd ownerless state cannot be claimed by a live session WITH a cwd (cwd scope, undefined side)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // Ownerless state created WITHOUT a cwd (the `_no-cwd` project directory).
        await ctx.sessionPersistence.create(meta('no-cwd-state'))
        // A live session reusing the id but WITH cwd WORK is a cwd mismatch
        // (undefined vs WORK) and must be rejected.
        /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const live = ctx.sessions.create(SessionId('no-cwd-state'), { seed: oneTurnLog(), meta: { cwd: WORK } })
        await expect(ctx.sessions.flush(live)).rejects.toThrow(/different cwd|id collision/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- append adopts a storage-only session (fresh instance, no prior create/load) ---

    it('append adopts a storage-only session (fresh instance) and continues the seq', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = meta('adopt-append', WORK)
        await first.ctx.sessionPersistence.create(m)
        await first.ctx.sessionPersistence.append(m.id, oneTurnLog())
      } finally {
        await first.fiber.dispose()
      }

      // A fresh instance appends a second turn WITHOUT a prior create/load: append
      // must adopt the stored session (cursor = stored length) and continue.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        await second.ctx.sessionPersistence.append(SessionId('adopt-append'), [
          { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
          { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
        ])
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await second.ctx.sessionPersistence.load(SessionId('adopt-append'))
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- small public-API edges that the coordinator owns uniformly ---

    it('append of an empty batch is a no-op (stays lazy)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = meta('empty-batch', WORK)
        await ctx.sessionPersistence.create(m)
        await ctx.sessionPersistence.append(m.id, [])
        expect((await ctx.sessionPersistence.list()).map(h => h.id)).not.toContain(m.id)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('load and inspect reject a missing session', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        await expect(ctx.sessionPersistence.load(SessionId('nope'))).rejects.toThrow(/not found/)
        await expect(ctx.sessionPersistence.inspect(SessionId('nope'))).rejects.toThrow(/not found/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('create rejects a duplicate id (in memory and on a persisted log)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = meta('dup', WORK)
        await first.ctx.sessionPersistence.create(m)
        // Same in-memory state.
        await expect(first.ctx.sessionPersistence.create(m)).rejects.toThrow(/already exists in this backend/)
        await first.ctx.sessionPersistence.append(m.id, oneTurnLog())
      } finally {
        await first.fiber.dispose()
      }

      // A fresh instance over the same storage sees the persisted log.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        await expect(second.ctx.sessionPersistence.create(meta('dup', WORK)))
          .rejects.toThrow(/already has a persisted log on disk/)
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rejects a newer format version on load, naming the upgrade direction', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = { version: 99, id: SessionId('v99'), createdAt: 1, cwd: WORK }
        await ctx.sessionPersistence.create(m)
        await ctx.sessionPersistence.append(m.id, oneTurnLog())
        /** 中文说明：函数值 failure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const failure = await ctx.sessionPersistence.load(m.id).then(() => undefined, (error: unknown) => error as Error)
        expect(failure?.name).toBe('SessionFormatUnsupportedError')
        expect(failure?.message).toMatch(/written by a newer harness.*upgrade the harness/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rejects an older format version on load without claiming an upgrade path', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = { version: -1, id: SessionId('v-older'), createdAt: 1, cwd: WORK }
        await ctx.sessionPersistence.create(m)
        await ctx.sessionPersistence.append(m.id, oneTurnLog())
        /** 中文说明：函数值 failure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const failure = await ctx.sessionPersistence.load(m.id).then(() => undefined, (error: unknown) => error as Error)
        expect(failure?.name).toBe('SessionFormatUnsupportedError')
        expect(failure?.message).toMatch(/older than the supported v0.*no upgrade path/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('rejects an unknown event type on load', async () => {
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 required 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const required = meta('unknown-required', WORK)
        await ctx.sessionPersistence.create(required)
        await ctx.sessionPersistence.append(required.id, [
          ...oneTurnLog(),
          { type: 'future/event', seq: oneTurnLog().length, time: 99, data: { payload: 1 } } as unknown as SessionEvent,
        ])
        /** 中文说明：函数值 failure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
        const failure = await ctx.sessionPersistence.load(required.id).then(() => undefined, (error: unknown) => error as Error)
        expect(failure?.name).toBe('SessionFormatUnsupportedError')
        expect(failure?.message).toMatch(/event type "future\/event".*unknown to this harness/)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('round-trips a header with parentSession (fork lineage)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = { version: SESSION_FORMAT_VERSION, id: SessionId('forked-child'), createdAt: 1, cwd: WORK, parentSession: SessionId('the-parent') }
        await ctx.sessionPersistence.create(m)
        await ctx.sessionPersistence.append(m.id, oneTurnLog())
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(m.id)
        expect(loaded.meta.parentSession).toBe('the-parent')
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    it('flush before init resolves uses cursor 0', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      const { ctx, fiber } = await freshCtx(fix)
      try {
        // Append directly to a live session and flush IMMEDIATELY, before the
        // async onCreated init has necessarily set state (exercises the
        // state-undefined cursor path).
        /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const session = ctx.sessions.create(SessionId('flush-nostate'), { meta: { cwd: WORK } })
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: 'q' }], source: { kind: 'user' },
        }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        await ctx.sessions.flush(session)
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await ctx.sessionPersistence.load(SessionId('flush-nostate'))
        expect(loaded.events).toHaveLength(3)
      } finally {
        await fiber.dispose()
        await fix.cleanup()
      }
    })

    // --- crash-tail repair THROUGH the coordinator (real storage torn tail) ---

    it('torn-tail load: a never-committed tail is truncated and the open turn closed during load (commitRepair w/ tornMarker)', async () => {
      /** 中文说明：变量 fix 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const fix = await makeFixture()
      if (!fix.corruptTail) {
        // A memory-style store has no torn tails (every write is atomic in RAM),
        // so there is no tornMarker path to exercise. Assert that explicitly
        // instead of silently skipping, then bail.
        expect(fix.corruptTail).toBeUndefined()
        await fix.cleanup()
        return
      }
      /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const first = await freshCtx(fix)
      try {
        /** 中文说明：变量 m 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const m = meta('torn', WORK)
        await first.ctx.sessionPersistence.create(m)
        await first.ctx.sessionPersistence.append(m.id, oneTurnLog()) // committed 0..5 (balanced)
        // A second turn whose real events are durable but never closed (open turn).
        await first.ctx.sessionPersistence.append(m.id, [
          { type: 'turn/start', seq: 6, time: 7, data: { turn: 2 } },
          { type: 'step/start', seq: 7, time: 8, data: { turn: 2, step: 1 } },
        ])
      } finally {
        await first.fiber.dispose()
      }
      // Inject a torn fragment past the committed region (never-committed tail).
      await fix.corruptTail(SessionId('torn'), WORK)

      // A FRESH instance loads: the torn tail is truncated (tornMarker !==
      // undefined) AND the open turn 2 is closed with synthetic step/end +
      // turn/end {interrupted} — commitRepair runs with BOTH a torn marker and
      // closers. The preserved real events (0..7) are never truncated.
      /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const second = await freshCtx(fix)
      try {
        /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const loaded = await second.ctx.sessionPersistence.load(SessionId('torn'))
        expect(loaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        expect(loaded.events.map(e => e.type)).toEqual([
          'turn/start', 'user/message', 'step/start', 'assistant/message', 'step/end', 'turn/end', // turn 1
          'turn/start', 'step/start', 'step/end', 'turn/end', // turn 2: real + synthetic closers
        ])
        /** 中文说明：变量 last 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const last = loaded.events.at(-1)!
        expect(last.type === 'turn/end' && last.data.reason).toEqual({ kind: 'interrupted' })

        // The repair is durable: the next append continues at the balanced length
        // (seq 10) and a reload round-trips identically.
        await second.ctx.sessionPersistence.append(SessionId('torn'), [
          { type: 'turn/start', seq: 10, time: 9, data: { turn: 3 } },
          { type: 'turn/end', seq: 11, time: 10, data: { turn: 3, reason: { kind: 'completed' } } },
        ])
        /** 中文说明：变量 reloaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reloaded = await second.ctx.sessionPersistence.load(SessionId('torn'))
        expect(reloaded.events.map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      } finally {
        await second.fiber.dispose()
        await fix.cleanup()
      }
    })
  })
}
