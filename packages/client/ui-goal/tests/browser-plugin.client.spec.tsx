// @vitest-environment jsdom
/**
 * 文件职责：验证目标进度的 browser-plugin.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止目标进度用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * ui-goal browser half on a real cordis Context with fake slots/api/
 * sessions faces: the plugin registers the GoalBar dock entry at
 * conversation.input.dock, the inject face's four verbs read the CAS ref
 * from the session's CURRENT projected value at call time (no fence — the
 * Remote method's compare-and-set is the guard), a missing projection short-circuits
 * to the no-current-goal error without touching the wire, and a Remote failure
 * reaches the strip verbatim. Registration disposal rides the
 * plugin fiber (HMR safety). The node half and the invariant companion are
 * exercised over the same Context.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationEventRegistry } from '@deepseek-ai/dsh-client-runtime/src/client/conversation/event-registry.ts'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GoalBarActions } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { GoalDock } from '../src/client/GoalBar.tsx'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId

/** 中文说明：函数 makeProjection 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeProjection(revision = 3): GoalProjection {
  return {
    goal: {
      id: 'g-1' as GoalProjection['goal']['id'],
      revision,
      objective: 'Ship it',
      phase: 'active',
      maxGoalRounds: 8,
    },
    roundsStarted: 1,
    createdAt: 10,
    updatedAt: 20,
  }
}

/** Boot the plugin over fake faces; Goal Remote methods record arguments and answer per the script. */
/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench(options: {
  projection?: GoalProjection | null | undefined
  failWith?: { code: string; message: string; details: object }
} = {}) {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
  const calls: { method: string; args: unknown[] }[] = []
  /** 中文说明：测试局部值 conversationEvents，由紧邻初始化决定。 */
  const conversationEvents = new ConversationEventRegistry(ctx)
  /** 中文说明：函数 answer 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function answer<T>(method: string, value: T) {
    return (...args: unknown[]) => {
      calls.push({ method, args })
      if (options.failWith !== undefined) return Promise.resolve({ ok: false, error: options.failWith })
      return Promise.resolve({ ok: true, value })
    }
  }
  /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
  const ref = { id: 'g-1', revision: 3 }
  /** 中文说明：测试局部值 goals，由紧邻初始化决定。 */
  const goals = (prefix: string) => ({
    edit: answer(`${prefix}/edit`, { ref }),
    pause: answer(`${prefix}/pause`, { ref }),
    resume: answer(`${prefix}/resume`, { ref }),
    clear: answer(`${prefix}/clear`, ref),
  })
  /** 中文说明：测试局部值 activeGoals，由紧邻初始化决定。 */
  let activeGoals: ReturnType<typeof goals> | undefined = goals('goals')
  /** 中文说明：类型或类 RemoteService 约束本文件数据或组件职责。 */
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.goals', {
    get edit() { return activeGoals?.edit },
    get pause() { return activeGoals?.pause },
    get resume() { return activeGoals?.resume },
    get clear() { return activeGoals?.clear },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.chat.node': { kind: 'keyed', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    binding: (id: SessionId) => ({
      sessionId: id,
      session: { projections: { faceOf: (key: string) => ({
        getSnapshot: () => (key === 'goal' ? options.projection : undefined),
        subscribe: () => () => {},
      }) } },
      ctx,
    }),
  })
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    definitions: () => conversationEvents.entries(),
    remountGoals: () => { activeGoals = goals('remounted-goals') },
    unmountGoals: () => { activeGoals = undefined },
    entry: () => {
      /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        inject: entry.inject as unknown as ((sessionId: SessionId) => GoalBarActions) | undefined,
      }
    },
    chatEntry: () => ctx.slots.entries('conversation.chat.node')[0],
  }
}

describe('ui-goal browser plugin', () => {
  it('registers the GoalBar dock, command input Definition, and keyed Chat renderer', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toMatchObject({ id: 'goal', order: 10, locale: 'goal' })
    expect(b.entry()?.inject).toBeTypeOf('function')
    expect(b.definitions().map(definition => definition.kind)).toEqual(['goal-command-input'])
    expect(b.chatEntry()?.options).toMatchObject({ key: 'command-input' })
    expect(b.chatEntry()?.locale).toBe('goal')
  })

  it('verbs read the CAS ref from the current projected value at call time', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench({ projection: makeProjection(5) })
    await b.fiber.await()
    /** 中文说明：测试局部值 verbs，由紧邻初始化决定。 */
    const verbs = b.entry()!.inject!(sid('s1'))
    // The strip forwards the Remote value verbatim; `answered` is the fake's
    // reply, unrelated to the CAS ref the call carries.
    /** 中文说明：测试局部值 answered，由紧邻初始化决定。 */
    const answered = { id: 'g-1', revision: 3 }
    expect(await verbs.onEdit('New objective')).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onPause()).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onResume()).toEqual({ ok: true, value: { ref: answered } })
    expect(await verbs.onClear()).toEqual({ ok: true, value: answered })
    expect(b.calls.map(c => c.method)).toEqual(['goals/edit', 'goals/pause', 'goals/resume', 'goals/clear'])
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = { id: 'g-1', revision: 5 }
    expect(b.calls[0]?.args).toEqual(['s1', ref, { objective: 'New objective' }])
    expect(b.calls[1]?.args).toEqual(['s1', ref])
    expect(b.calls[2]?.args).toEqual(['s1', ref])
    expect(b.calls[3]?.args).toEqual(['s1', ref])
  })

  it('verbs read a remounted Remote namespace at action time', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    /** 中文说明：测试局部值 verbs，由紧邻初始化决定。 */
    const verbs = b.entry()!.inject!(sid('s1'))
    b.remountGoals()

    expect(await verbs.onPause()).toEqual({ ok: true, value: { ref: { id: 'g-1', revision: 3 } } })
    expect(b.calls).toMatchObject([{ method: 'remounted-goals/pause' }])
  })

  it('rejects every verb once the Remote namespace is gone', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench({ projection: makeProjection() })
    await b.fiber.await()
    /** 中文说明：测试局部值 verbs，由紧邻初始化决定。 */
    const verbs = b.entry()!.inject!(sid('s1'))
    b.unmountGoals()

    // A missing namespace is an assembly fault, not a call outcome: this plugin
    // declares remote.goals in `inject`, so cordis disposes the dock entry along
    // with the namespace. Only a React closure that outlived that disposal can
    // reach these verbs, so no consumer-side guard renders it as an error.
    /** 中文说明：测试局部值 verb，由紧邻初始化决定。 */
    for (const verb of [() => verbs.onEdit('x'), () => verbs.onPause(), () => verbs.onResume(), () => verbs.onClear()]) {
      await expect(verb()).rejects.toThrow(TypeError)
    }
    expect(b.calls).toHaveLength(0)
  })

  it('a null or absent projection short-circuits every verb without touching the wire', async () => {
    /** 中文说明：测试局部值 projection，由紧邻初始化决定。 */
    for (const projection of [null, undefined]) {
      /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
      const b = await bench({ projection })
      await b.fiber.await()
      /** 中文说明：测试局部值 verbs，由紧邻初始化决定。 */
      const verbs = b.entry()!.inject!(sid('s1'))
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      for (const result of [await verbs.onEdit('x'), await verbs.onPause(), await verbs.onResume(), await verbs.onClear()]) {
        expect(result).toEqual({ ok: false, error: { code: 'no-current-goal', message: 'no current goal to mutate', details: {} } })
      }
      expect(b.calls).toHaveLength(0)
    }
  })

  it('forwards a Remote failure to the strip verbatim', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench({ projection: makeProjection(), failWith: { code: 'internal', message: 'stale revision', details: {} } })
    await b.fiber.await()
    /** 中文说明：测试局部值 verbs，由紧邻初始化决定。 */
    const verbs = b.entry()!.inject!(sid('s1'))
    expect(await verbs.onEdit('x')).toEqual({ ok: false, error: { code: 'internal', message: 'stale revision', details: {} } })
  })

  it('drops the dock entry when the plugin fiber unloads (HMR safety)', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    await b.fiber.await()
    expect(b.entry()).toBeDefined()
    expect(b.chatEntry()).toBeDefined()
    expect(b.definitions()).toHaveLength(1)
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.chatEntry()).toBeUndefined()
    expect(b.definitions()).toHaveLength(0)
  })
})

describe('GoalDock adapter', () => {
  it('renders the projected goal snapshot and nothing for absent/null', () => {
    /** 中文说明：测试局部值 projection，由紧邻初始化决定。 */
    const projection = makeProjection()
    /** 中文说明：测试局部值 useProjection，由紧邻初始化决定。 */
    const useProjection = vi.fn(() => projection)
    /** 中文说明：测试局部值 actions，由紧邻初始化决定。 */
    const actions: GoalBarActions = {
      onEdit: () => Promise.resolve({ ok: true, value: undefined }),
      onPause: () => Promise.resolve({ ok: true, value: undefined }),
      onResume: () => Promise.resolve({ ok: true, value: undefined }),
      onClear: () => Promise.resolve({ ok: true, value: undefined }),
    }
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    const t = makeTranslate(zh, commonZh)
    /** 中文说明：测试局部值 dockProps，由紧邻初始化决定。 */
    const dockProps = (up: () => GoalProjection | null | undefined) =>
      ({ useProjection: up, ...actions, t }) as unknown as Parameters<typeof GoalDock>[0]
    /** 中文说明：测试局部值 shown，由紧邻初始化决定。 */
    const shown = render(<GoalDock {...dockProps(useProjection)} />)
    expect(shown.getByText('Ship it')).toBeTruthy()
    cleanup()

    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = render(<GoalDock {...dockProps(() => null)} />)
    expect(empty.container.firstChild).toBeNull()
    cleanup()

    /** 中文说明：测试局部值 absent，由紧邻初始化决定。 */
    const absent = render(<GoalDock {...dockProps(() => undefined)} />)
    expect(absent.container.firstChild).toBeNull()
  })
})

describe('ui-goal node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
