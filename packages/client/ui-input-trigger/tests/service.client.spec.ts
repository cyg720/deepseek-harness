/**
 * Slash pipeline spec over the split architecture. InputTriggerService keeps only
 * the source roster (duplicate throw, disposal dropping live menu groups in
 * every session controller) and per-session controller resolution; all
 * interaction — track → menu store, pick execution via the scoped input
 * events, keyboard arbitration, space/enter adjudication, and the
 * scope-birth roster warm — is InputTriggerController behavior, tested on a real
 * session scope (createScope).
 */
/*
 * 文件职责：验证输入触发菜单的 service.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染和可控服务替身。
 * 产品维度：防止输入触发菜单用户流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createScope, scopeOf } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { InputTriggerController, InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  BeginCommandRequest, ClientSessionContext, CommandClaim, InsertReferenceRequest, PickOutcome,
  ReferenceInsert, InputTriggerCandidate, InputTriggerPick, InputTriggerSource, SourceRoster, TriggerChar,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/** 中文说明：测试局部值 sid，由紧邻初始化决定。 */
const sid = (k: string): SessionId => k as SessionId

/** 中文说明：类型或类 PendingFetch 约束本文件数据或组件职责。 */
interface PendingFetch {
  resolve: (items: readonly InputTriggerCandidate[]) => void
  reject: (err: unknown) => void
  query: string
  signal: AbortSignal
  session: ClientSessionContext
}

/** Deferred-candidates source: settle each fetch by hand; warm is a spy. */
/* 中文说明：函数 deferredSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function deferredSource(trigger: TriggerChar, name: string, over: Partial<InputTriggerSource> = {}) {
  /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
  const pending: PendingFetch[] = []
  /** 中文说明：测试局部值 warm，由紧邻初始化决定。 */
  const warm = vi.fn()
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source: InputTriggerSource = {
    trigger,
    name,
    candidates: (session, req) => new Promise<readonly InputTriggerCandidate[]>((resolve, reject) => {
      pending.push({ resolve, reject, query: req.query, signal: req.signal, session })
    }),
    onPick: () => undefined,
    warm,
    ...over,
  }
  return { source, pending, warm }
}

/** Source whose candidates resolve immediately; picks are recorded. */
/* 中文说明：函数 readySource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function readySource(
  trigger: TriggerChar, name: string, items: readonly InputTriggerCandidate[], onPick?: (pick: InputTriggerPick) => PickOutcome,
) {
  /** 中文说明：测试局部值 picks，由紧邻初始化决定。 */
  const picks: InputTriggerPick[] = []
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source: InputTriggerSource = {
    trigger,
    name,
    candidates: () => Promise.resolve(items),
    onPick: (pick) => {
      picks.push(pick)
      return onPick?.(pick)
    },
  }
  return { source, picks }
}

/** 中文说明：测试局部值 claimOf，由紧邻初始化决定。 */
const claimOf = (token: string): CommandClaim =>
  ({ token, submit: () => Promise.resolve({ kind: 'success' }) })

/** One microtask hop: lets settled candidate promises flow into the store. */
/* 中文说明：测试局部值 tick，由紧邻初始化决定。 */
const tick = () => Promise.resolve()

/** Direct controller bench: real scope tag + live roster array. */
/* 中文说明：函数 controllerBench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function controllerBench(sources: InputTriggerSource[] = [], key = 'a') {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = new Context()
  /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
  const scope = createScope(root, sid(key))
  /** 中文说明：测试局部值 roster，由紧邻初始化决定。 */
  const roster: SourceRoster = {
    sources: trigger => sources.filter(s => s.trigger === trigger),
    all: () => sources,
  }
  /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
  const controller = new InputTriggerController({ actx: scope.ctx, sessionId: sid(key), roster })
  return { root, actx: scope.ctx, controller, sources }
}

/** Real-service bench: a sessions face resolving scope tags to session ids. */
/* 中文说明：函数 serviceBench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function serviceBench() {
  /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
  const root = new Context()
  root.provide('sessions', {
    scopeOf: (c: Context) => scopeOf(c),
  })
  await root.plugin(InputTriggerService).await()
  /** 中文说明：测试局部值 inputTriggers，由紧邻初始化决定。 */
  const inputTriggers = root.get('inputTriggers') as InputTriggerService
  /** 中文说明：测试局部值 mint，由紧邻初始化决定。 */
  const mint = (key: string) => {
    /** 中文说明：测试局部值 scope，由紧邻初始化决定。 */
    const scope = createScope(root, sid(key))
    return { actx: scope.ctx, fiber: scope.fiber }
  }
  return { root, inputTriggers, mint }
}

describe('registerSource', () => {
  it('throws on a duplicate (trigger, name); same name across triggers is fine', async () => {
    /** 中文说明：测试局部值 { inputTriggers }，由紧邻初始化决定。 */
    const { inputTriggers } = await serviceBench()
    inputTriggers.registerSource(readySource('/', 'command', []).source)
    expect(() => inputTriggers.registerSource(readySource('/', 'command', []).source))
      .toThrow(/already registered/)
    inputTriggers.registerSource(readySource('@', 'command', []).source)
  })

  it('disposal frees the name and drops the live menu group in every session controller', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = readySource('/', 'alpha', [{ name: 'one' }])
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = deferredSource('/', 'beta')
    inputTriggers.registerSource(a.source)
    /** 中文说明：测试局部值 disposeB，由紧邻初始化决定。 */
    const disposeB = inputTriggers.registerSource(b.source)

    /** 中文说明：测试局部值 ca，由紧邻初始化决定。 */
    const ca = inputTriggers.sessionOf(mint('a').actx)
    /** 中文说明：测试局部值 cb，由紧邻初始化决定。 */
    const cb = inputTriggers.sessionOf(mint('b').actx)
    ca.track('/o', 2, { tier: 'plain' }, 1)
    cb.track('/o', 2, { tier: 'plain' }, 1)
    await tick()
    expect(ca.menu.getSnapshot().groups.map(g => g.source)).toEqual(['alpha', 'beta'])
    expect(cb.menu.getSnapshot().groups.map(g => g.source)).toEqual(['alpha', 'beta'])

    disposeB()
    expect(ca.menu.getSnapshot().groups.map(g => g.source)).toEqual(['alpha'])
    expect(cb.menu.getSnapshot().groups.map(g => g.source)).toEqual(['alpha'])
    // The name is free again, and a stale double-dispose stays a no-op.
    disposeB()
    inputTriggers.registerSource(deferredSource('/', 'beta').source)
  })

  it('a source registered after controller birth warms in every live controller', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 ca，由紧邻初始化决定。 */
    const ca = inputTriggers.sessionOf(mint('a').actx)
    /** 中文说明：测试局部值 cb，由紧邻初始化决定。 */
    const cb = inputTriggers.sessionOf(mint('b').actx)
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late = deferredSource('/', 'late', { lexicon: () => ['fresh'] })
    inputTriggers.registerSource(late.source)
    expect(late.warm).toHaveBeenNthCalledWith(1, { sessionId: sid('a') })
    expect(late.warm).toHaveBeenNthCalledWith(2, { sessionId: sid('b') })
    expect(ca.lexicon.getSnapshot().get('/')).toEqual(['fresh'])
    expect(cb.lexicon.getSnapshot().get('/')).toEqual(['fresh'])
  })

  it('HMR shape: dispose of the registering fiber removes the source', async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { root, inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = inputTriggers.sessionOf(mint('a').actx)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = root.plugin({
      apply(pluginCtx: Context) {
        pluginCtx.effect(
          () => inputTriggers.registerSource(readySource('/', 'command', [{ name: 'goal' }]).source),
          'test: slash source',
        )
      },
    })
    await fiber.await()
    controller.track('/g', 2, { tier: 'plain' }, 1)
    await tick()
    expect(controller.menu.getSnapshot().open).toBe(true)

    await fiber.dispose()
    // Group dropped with the fiber; a fresh track finds no sources → closed.
    expect(controller.menu.getSnapshot().open).toBe(false)
    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
  })
})

describe('sessionOf', () => {
  it('resolves lazily: same scope → same resident controller; another session → its own', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = mint('a')
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = inputTriggers.sessionOf(a.actx)
    expect(inputTriggers.sessionOf(a.actx)).toBe(first)
    expect(inputTriggers.sessionOf(mint('b').actx)).not.toBe(first)
  })

  it('throws off an unscoped context', async () => {
    /** 中文说明：测试局部值 { root, inputTriggers }，由紧邻初始化决定。 */
    const { root, inputTriggers } = await serviceBench()
    expect(() => inputTriggers.sessionOf(root)).toThrow(/requires a session scope/)
  })

  it('warms the roster once at controller birth with the session projection', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 sub，由紧邻初始化决定。 */
    const sub = deferredSource('@', 'subagent')
    inputTriggers.registerSource(cmd.source)
    inputTriggers.registerSource(sub.source)
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = mint('a')
    inputTriggers.sessionOf(a.actx)
    expect(cmd.warm).toHaveBeenCalledExactlyOnceWith({ sessionId: sid('a') })
    expect(sub.warm).toHaveBeenCalledExactlyOnceWith({ sessionId: sid('a') })
    // Re-resolution of the resident controller never re-warms.
    inputTriggers.sessionOf(a.actx)
    expect(cmd.warm).toHaveBeenCalledTimes(1)
  })

  it('the scope disposer removes and disposes the controller; a re-mint resolves fresh', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    inputTriggers.registerSource(readySource('/', 'command', [{ name: 'goal' }]).source)
    /** 中文说明：测试局部值 a，由紧邻初始化决定。 */
    const a = mint('a')
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = inputTriggers.sessionOf(a.actx)
    controller.track('/g', 2, { tier: 'plain' }, 1)
    await tick()
    expect(controller.menu.getSnapshot().open).toBe(true)

    await a.fiber.dispose()
    expect(controller.menu.getSnapshot().open).toBe(false)
    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)

    /** 中文说明：测试局部值 again，由紧邻初始化决定。 */
    const again = mint('a')
    expect(inputTriggers.sessionOf(again.actx)).not.toBe(controller)
  })

  it('two sessions are isolated: one menu opening never touches the other', async () => {
    /** 中文说明：测试局部值 { inputTriggers, mint }，由紧邻初始化决定。 */
    const { inputTriggers, mint } = await serviceBench()
    /** 中文说明：测试局部值 src，由紧邻初始化决定。 */
    const src = deferredSource('/', 'command')
    inputTriggers.registerSource(src.source)
    /** 中文说明：测试局部值 ca，由紧邻初始化决定。 */
    const ca = inputTriggers.sessionOf(mint('a').actx)
    /** 中文说明：测试局部值 cb，由紧邻初始化决定。 */
    const cb = inputTriggers.sessionOf(mint('b').actx)

    ca.track('/g', 2, { tier: 'plain' }, 1)
    expect(ca.menu.getSnapshot().open).toBe(true)
    expect(cb.menu.getSnapshot().open).toBe(false)

    src.pending[0]!.resolve([{ name: 'goal' }])
    await tick()
    expect(ca.menu.getSnapshot().groups[0]!.items).toEqual([{ name: 'goal' }])
    expect(cb.menu.getSnapshot().open).toBe(false)
  })
})

describe('track', () => {
  it('drives seed → pending → ready through the store', async () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
    const skill = deferredSource('/', 'skill')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source, skill.source])

    controller.track('/g', 2, { tier: 'plain' }, 1)
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    let state = controller.menu.getSnapshot()
    expect(state.open).toBe(true)
    expect(state.groups).toEqual([
      { source: 'command', status: 'pending', items: [] },
      { source: 'skill', status: 'pending', items: [] },
    ])

    cmd.pending[0]!.resolve([{ name: 'goal' }])
    await tick()
    state = controller.menu.getSnapshot()
    expect(state.groups[0]).toEqual({ source: 'command', status: 'ready', items: [{ name: 'goal' }] })
    expect(state.groups[1]!.status).toBe('pending')
    expect(state.highlight).toEqual({ source: 'command', index: 0 })
  })

  it('carries source-title visibility from the roster through candidate settlement', async () => {
    /** 中文说明：测试局部值 reference，由紧邻初始化决定。 */
    const reference = deferredSource('@', 'reference', { showGroupTitle: false })
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([reference.source])
    controller.track('@r', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().groups[0]).toMatchObject({ showGroupTitle: false, status: 'pending' })
    reference.pending[0]!.resolve([{ name: 'README.md', section: '文件与文件夹' }])
    await tick()
    expect(controller.menu.getSnapshot().groups[0]).toMatchObject({ showGroupTitle: false, status: 'ready' })
  })

  it('stamps the caller draftRev into the hit span', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 7)
    expect(controller.menu.getSnapshot().hit!.span).toEqual({ start: 0, end: 2, draftRev: 7 })
  })

  it('candidates receive the session projection, identity only', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(cmd.pending[0]!.session).toEqual({ sessionId: sid('a') })
  })

  it('query refinement supersedes the old generation and aborts its fetch', async () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])

    controller.track('/g', 2, { tier: 'plain' }, 1)
    /** 中文说明：测试局部值 gen1，由紧邻初始化决定。 */
    const gen1 = controller.menu.getSnapshot().generation
    controller.track('/go', 3, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().generation).toBe(gen1 + 1)
    expect(cmd.pending[0]!.signal.aborted).toBe(true)

    // A late settle of the aborted fetch is dropped even before the
    // generation gate: the group stays pending until the live fetch lands.
    cmd.pending[0]!.resolve([{ name: 'stale' }])
    await tick()
    expect(controller.menu.getSnapshot().groups[0]!.status).toBe('pending')
    cmd.pending[1]!.resolve([{ name: 'goal' }])
    await tick()
    expect(controller.menu.getSnapshot().groups[0]!.items).toEqual([{ name: 'goal' }])
  })

  it('same hit re-track refreshes the span stamp without refetching', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    // Same token under the caret, later revision (an edit past the caret).
    controller.track('/g x', 2, { tier: 'plain' }, 2)
    expect(cmd.pending).toHaveLength(1)
    expect(controller.menu.getSnapshot().generation).toBe(1)
  })

  it('no live trigger closes the menu and aborts the fetch', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    controller.track('hello', 5, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
    expect(cmd.pending[0]!.signal.aborted).toBe(true)
  })

  it('a trigger with no registered sources never opens', () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([readySource('/', 'command', [{ name: 'goal' }]).source])
    controller.track('@w', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('trigger switch reseeds the roster', () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      deferredSource('/', 'command').source,
      deferredSource('@', 'subagent').source,
    ])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().groups.map(g => g.source)).toEqual(['command'])
    controller.track('@w', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().groups.map(g => g.source)).toEqual(['subagent'])
  })

  it('all sources settling empty auto-closes; a later settle of a gone generation is silent', async () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
    const skill = deferredSource('/', 'skill')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source, skill.source])
    controller.track('/zzz', 4, { tier: 'plain' }, 1)
    cmd.pending[0]!.resolve([])
    await tick()
    expect(controller.menu.getSnapshot().open).toBe(true)
    skill.pending[0]!.resolve([])
    await tick()
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('a rejecting source logs and silently drops its group', async () => {
    /** 中文说明：测试局部值 errorSpy，由紧邻初始化决定。 */
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
      const cmd = deferredSource('/', 'command')
      /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
      const skill = deferredSource('/', 'skill')
      /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
      const { controller } = controllerBench([cmd.source, skill.source])
      controller.track('/g', 2, { tier: 'plain' }, 1)
      skill.pending[0]!.reject(new Error('boom'))
      cmd.pending[0]!.resolve([{ name: 'goal' }])
      await tick()
      /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
      const state = controller.menu.getSnapshot()
      expect(state.groups.map(g => g.source)).toEqual(['command'])
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('skill'), expect.any(Error))
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe('programmatic source launcher', () => {
  it('opens only the requested source and reuses its ordinary pick span', async () => {
    /** 中文说明：测试局部值 command，由紧邻初始化决定。 */
    const command = readySource('/', 'command', [{ name: 'goal' }])
    /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
    const skill = readySource('/', 'skill', [{ name: 'review' }])
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([command.source, skill.source])
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = {
      trigger: '/' as const,
      query: '',
      quoted: false,
      position: 'leading' as const,
      span: { start: 2, end: 5, draftRev: 7 },
    }

    controller.toggleSource('command', hit)
    await tick()

    expect(controller.launcher.getSnapshot()).toBe('command')
    expect(controller.menu.getSnapshot()).toMatchObject({
      open: true,
      hit,
      groups: [{ source: 'command', status: 'ready', items: [{ name: 'goal' }] }],
    })
    controller.pick('command', 0)
    expect(command.picks[0]).toMatchObject({ via: 'menu', span: hit.span })
    expect(skill.picks).toHaveLength(0)
    expect(controller.launcher.getSnapshot()).toBeNull()
  })

  it('toggles closed, and typed tracking returns to the full trigger roster', async () => {
    /** 中文说明：测试局部值 command，由紧邻初始化决定。 */
    const command = readySource('/', 'command', [{ name: 'goal' }])
    /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
    const skill = readySource('/', 'skill', [{ name: 'review' }])
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([command.source, skill.source])
    /** 中文说明：测试局部值 hit，由紧邻初始化决定。 */
    const hit = {
      trigger: '/' as const,
      query: '',
      quoted: false,
      position: 'leading' as const,
      span: { start: 0, end: 0, draftRev: 1 },
    }

    controller.toggleSource('command', hit)
    controller.toggleSource('command', hit)
    expect(controller.menu.getSnapshot().open).toBe(false)
    expect(controller.launcher.getSnapshot()).toBeNull()

    controller.toggleSource('command', hit)
    controller.track('/g', 2, { tier: 'plain' }, 2)
    await tick()
    expect(controller.launcher.getSnapshot()).toBeNull()
    expect(controller.menu.getSnapshot().groups.map(group => group.source)).toEqual(['command', 'skill'])
  })
})

describe('scope-birth warm', () => {
  it('construction warms every source once with the session projection', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 sub，由紧邻初始化决定。 */
    const sub = deferredSource('@', 'subagent')
    controllerBench([cmd.source, sub.source])
    expect(cmd.warm).toHaveBeenCalledExactlyOnceWith({ sessionId: sid('a') })
    expect(sub.warm).toHaveBeenCalledExactlyOnceWith({ sessionId: sid('a') })
  })

  it('hook-less sources are skipped', () => {
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare: InputTriggerSource = {
      trigger: '/',
      name: 'bare',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
    }
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    // No throw on the hook-less source; the implementing one still warms.
    controllerBench([bare, cmd.source])
    expect(cmd.warm).toHaveBeenCalledTimes(1)
  })

  it('dispose inerts every verb', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    controller.dispose()
    expect(controller.menu.getSnapshot().open).toBe(false)
    expect(cmd.pending[0]!.signal.aborted).toBe(true)

    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(controller.menu.getSnapshot().open).toBe(false)
    expect(controller.arbitrate('down', false)).toBe('pass')
    expect(controller.onSpace()).toBe(false)
    controller.pick('command', 0)
  })
})

describe('pick / scoped input events', () => {
  /** 中文说明：函数 pickBench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function pickBench(outcomeOf: (pick: InputTriggerPick) => PickOutcome) {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = readySource('/', 'command', [{ name: 'goal' }, { name: 'plan' }], outcomeOf)
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = controllerBench([cmd.source])
    /** 中文说明：测试局部值 begins，由紧邻初始化决定。 */
    const begins: BeginCommandRequest[] = []
    /** 中文说明：测试局部值 inserts，由紧邻初始化决定。 */
    const inserts: InsertReferenceRequest[] = []
    bench.actx.on('slash/input-begin-command', (req) => {
      begins.push(req)
      return true
    })
    bench.actx.on('slash/input-insert-reference', (req) => {
      inserts.push(req)
      return true
    })
    bench.controller.track('/g', 2, { tier: 'plain' }, 3)
    return { ...bench, cmd, begins, inserts }
  }

  it('routes a claim outcome through the scoped begin-command event and closes the menu', async () => {
    /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
    const claim = claimOf('/goal ')
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { controller, cmd, begins } = pickBench(() => ({ claim }))
    await tick()
    controller.pick('command', 0)
    expect(cmd.picks).toHaveLength(1)
    expect(cmd.picks[0]).toMatchObject({
      candidate: { name: 'goal' },
      session: { sessionId: sid('a') },
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 2, draftRev: 3 },
    })
    expect(begins).toEqual([{ claim, span: { start: 0, end: 2, draftRev: 3 } }])
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('routes an insert outcome through the scoped insert-reference event', async () => {
    /** 中文说明：测试局部值 insert，由紧邻初始化决定。 */
    const insert: ReferenceInsert = { source: 'skill', ref: 'x', label: 'x', clipboardText: '/x' }
    /** 中文说明：测试局部值 { controller, inserts }，由紧邻初始化决定。 */
    const { controller, inserts } = pickBench(() => ({ insert }))
    await tick()
    controller.pick('command', 1)
    expect(inserts).toEqual([{ reference: insert, span: { start: 0, end: 2, draftRev: 3 } }])
  })

  it('routes a text outcome through the scoped insert-text event and closes the menu', async () => {
    /** 中文说明：测试局部值 { controller, actx }，由紧邻初始化决定。 */
    const { controller, actx } = pickBench(() => ({ text: '/goal ' }))
    /** 中文说明：测试局部值 texts，由紧邻初始化决定。 */
    const texts: Array<{ text: string; span: unknown }> = []
    actx.on('slash/input-insert-text', (req) => {
      texts.push(req)
      return true
    })
    await tick()
    controller.pick('command', 0)
    expect(texts).toEqual([{ text: '/goal ', span: { start: 0, end: 2, draftRev: 3 } }])
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('forwards a continuing text outcome so a directory pick keeps completion open', async () => {
    /** 中文说明：测试局部值 { controller, actx }，由紧邻初始化决定。 */
    const { controller, actx } = pickBench(() => ({ text: '@src/', continue: true }))
    /** 中文说明：测试局部值 texts，由紧邻初始化决定。 */
    const texts: Array<{ text: string; continue?: boolean }> = []
    actx.on('slash/input-insert-text', (req) => {
      texts.push(req)
      return true
    })
    await tick()
    controller.pick('command', 0)
    expect(texts).toEqual([{ text: '@src/', continue: true, span: { start: 0, end: 2, draftRev: 3 } }])
  })

  it('a text outcome the input declines answers false on the space path', async () => {
    /** 中文说明：测试局部值 src，由紧邻初始化决定。 */
    const src: InputTriggerSource = {
      trigger: '/',
      name: 'command',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      matchSpace: () => ({ text: '/goal ' }),
    }
    /** 中文说明：测试局部值 { controller, actx }，由紧邻初始化决定。 */
    const { controller, actx } = controllerBench([src])
    actx.on('slash/input-insert-text', () => undefined) // input declines (CAS miss)
    controller.track('/goal', 5, { tier: 'plain' }, 1)
    expect(controller.onSpace()).toBe(false)
  })

  it('scope carrier routing: a foreign session\'s listener never hears the dispatch, untagged root does', async () => {
    /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
    const claim = claimOf('/goal ')
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = readySource('/', 'command', [{ name: 'goal' }], () => ({ claim }))
    /** 中文说明：测试局部值 { root, controller }，由紧邻初始化决定。 */
    const { root, controller } = controllerBench([cmd.source])
    /** 中文说明：测试局部值 foreign，由紧邻初始化决定。 */
    const foreign: BeginCommandRequest[] = []
    /** 中文说明：测试局部值 rootSeen，由紧邻初始化决定。 */
    const rootSeen: BeginCommandRequest[] = []
    createScope(root, sid('b')).ctx.on('slash/input-begin-command', (req) => {
      foreign.push(req)
      return true
    })
    // Untagged root listeners are admitted globally (the carrier contract).
    root.on('slash/input-begin-command', (req) => { rootSeen.push(req) })
    controller.track('/g', 2, { tier: 'plain' }, 3)
    await tick()
    controller.pick('command', 0)
    expect(foreign).toHaveLength(0)
    expect(rootSeen).toHaveLength(1)
  })

  it("'handled' and undefined outcomes only close the menu", async () => {
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { controller, begins, inserts } = pickBench(() => 'handled')
    await tick()
    controller.pick('command', 0)
    expect(begins).toHaveLength(0)
    expect(inserts).toHaveLength(0)
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('closed menu / vanished candidate picks are no-ops', async () => {
    /** 中文说明：测试局部值 { controller, cmd }，由紧邻初始化决定。 */
    const { controller, cmd } = pickBench(() => undefined)
    await tick()
    controller.pick('command', 9)
    controller.pick('ghost', 0)
    expect(cmd.picks).toHaveLength(0)
    expect(controller.menu.getSnapshot().open).toBe(true)
  })
})

describe('header / drilled descent', () => {
  /** A source that publishes one crumb per path segment of a drilled query. */
  function crumbSource() {
    const requests: Array<{ query: string; quoted?: boolean; drilled: boolean }> = []
    const picks: InputTriggerPick[] = []
    const source: InputTriggerSource = {
      trigger: '@',
      name: 'reference',
      candidates: () => Promise.resolve([{ name: 'src', drill: true, value: 'src' }]),
      header: (_session, req) => {
        requests.push({ ...req })
        if (!req.drilled || !req.query.includes('/')) return undefined
        return req.query.split('/').filter(Boolean).map(label => ({ label, value: label }))
      },
      onPick: (pick) => {
        picks.push(pick)
        return pick.action === 'drill' ? { text: `@${String(pick.candidate.value)}/`, continue: true } : undefined
      },
    }
    return { source, requests, picks }
  }

  it('publishes no crumbs for a typed path and asks every source how the menu was reached', async () => {
    const { source, requests } = crumbSource()
    const { controller } = controllerBench([source])
    controller.track('@src/', 5, { tier: 'plain' }, 1)
    await tick()
    expect(requests).toEqual([{ query: 'src/', drilled: false, quoted: false }])
    expect(controller.headers.getSnapshot().size).toBe(0)
  })

  it('publishes crumbs once a drill produced the query, and drops them when the menu closes', async () => {
    const { source, picks } = crumbSource()
    const { controller, actx } = controllerBench([source])
    const texts: string[] = []
    actx.on('slash/input-insert-text', (req) => {
      texts.push(req.text)
      return true
    })
    controller.track('@sr', 3, { tier: 'plain' }, 1)
    await tick()
    controller.pick('reference', 0, 'drill')
    expect(texts).toEqual(['@src/'])
    expect(picks[0]?.action).toBe('drill')
    // The drilled text lands as the next tracked draft.
    controller.track('@src/', 5, { tier: 'plain' }, 2)
    await tick()
    expect(controller.headers.getSnapshot().get('reference')).toEqual([{ label: 'src', value: 'src' }])
    controller.dismiss()
    expect(controller.headers.getSnapshot().size).toBe(0)
  })

  it('routes a crumb through the source drill path and refuses the current step', async () => {
    const { source, picks } = crumbSource()
    const { controller, actx } = controllerBench([source])
    actx.on('slash/input-insert-text', () => true)
    controller.track('@sr', 3, { tier: 'plain' }, 1)
    await tick()
    controller.pick('reference', 0, 'drill')
    controller.track('@src/lib/', 9, { tier: 'plain' }, 2)
    await tick()
    const trail = controller.headers.getSnapshot().get('reference')
    expect(trail?.map(crumb => crumb.label)).toEqual(['src', 'lib'])
    picks.length = 0
    controller.pickCrumb('reference', 0)
    expect(picks).toHaveLength(1)
    expect(picks[0]).toMatchObject({ candidate: { name: 'src', value: 'src' }, action: 'drill', via: 'menu' })
  })

  it('publishes no crumbs when the input refused the drill edit', async () => {
    const { source } = crumbSource()
    const { controller } = controllerBench([source])
    // No listener accepts the insert, so the descent text never landed.
    controller.track('@sr', 3, { tier: 'plain' }, 1)
    await tick()
    controller.pick('reference', 0, 'drill')
    controller.track('@src/', 5, { tier: 'plain' }, 2)
    await tick()
    expect(controller.headers.getSnapshot().size).toBe(0)
  })

  it('drops a source whose header throws and keeps the rest of the menu', async () => {
    const failing: InputTriggerSource = {
      trigger: '@',
      name: 'broken',
      candidates: () => Promise.resolve([{ name: 'x' }]),
      header: () => { throw new Error('header boom') },
      onPick: () => undefined,
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { controller } = controllerBench([failing])
    controller.track('@x', 2, { tier: 'plain' }, 1)
    await tick()
    expect(controller.headers.getSnapshot().size).toBe(0)
    expect(controller.menu.getSnapshot().open).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('tells candidate fetches how the menu was reached', async () => {
    const seen: boolean[] = []
    const source: InputTriggerSource = {
      trigger: '@',
      name: 'reference',
      candidates: (_session, req) => {
        seen.push(req.drilled)
        return Promise.resolve([{ name: 'src', drill: true, value: 'src' }])
      },
      onPick: pick => (pick.action === 'drill' ? { text: '@src/', continue: true } : undefined),
    }
    const { controller, actx } = controllerBench([source])
    actx.on('slash/input-insert-text', () => true)
    controller.track('@sr', 3, { tier: 'plain' }, 1)
    await tick()
    controller.pick('reference', 0, 'drill')
    controller.track('@src/', 5, { tier: 'plain' }, 2)
    await tick()
    expect(seen).toEqual([false, true])
  })
})

describe('lexicon', () => {
  /** 中文说明：函数 lexSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function lexSource(trigger: TriggerChar, name: string, roll?: readonly string[]  , hasHook = true): InputTriggerSource {
    return {
      trigger,
      name,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      ...(hasHook ? { lexicon: () => roll } : {}),
    }
  }

  it('aggregates hook-implementing sources by trigger with the session projection; hookless ones are skipped', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: unknown[] = []
    /** 中文说明：测试局部值 skill，由紧邻初始化决定。 */
    const skill: InputTriggerSource = {
      trigger: '/',
      name: 'skill',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      lexicon: (projection) => {
        seen.push(projection)
        return ['commit-helper', 'review']
      },
    }
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      lexSource('/', 'command', undefined, false), // no hook: not polled
      skill,
      lexSource('@', 'subagent', ['worker-1']),
    ])
    /** 中文说明：测试局部值 rolls，由紧邻初始化决定。 */
    const rolls = controller.lexicon.getSnapshot()
    expect([...rolls.keys()]).toEqual(['/', '@'])
    expect(rolls.get('/')).toEqual(['commit-helper', 'review'])
    expect(rolls.get('@')).toEqual(['worker-1'])
    expect(seen).toEqual([{ sessionId: sid('a') }])
  })

  it('an undefined answer (roll not hot) is skipped without seeding the trigger', () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([lexSource('/', 'skill', undefined)])
    expect(controller.lexicon.getSnapshot().size).toBe(0)
  })

  it('two sources on one trigger concatenate in registration order', () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      lexSource('/', 'skill', ['b', 'a']),
      lexSource('/', 'prompt', ['c']),
      lexSource('@', 'subagent', undefined), // not hot: '@' stays absent
    ])
    /** 中文说明：测试局部值 rolls，由紧邻初始化决定。 */
    const rolls = controller.lexicon.getSnapshot()
    expect(rolls.get('/')).toEqual(['b', 'a', 'c'])
    expect(rolls.has('@')).toBe(false)
  })

  it('a source lexicon notification republishes the roll and refreshes an open menu', async () => {
    let roll: readonly string[] | undefined = ['old']
    let notify: (() => void) | undefined
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source: InputTriggerSource = {
      trigger: '/',
      name: 'skill',
      candidates: () => Promise.resolve((roll ?? []).map(name => ({ name }))),
      onPick: () => undefined,
      lexicon: () => roll,
      subscribeLexicon: (_session, listener) => {
        notify = listener
        return () => { notify = undefined }
      },
    }
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([source])
    expect(controller.lexicon.getSnapshot().get('/')).toEqual(['old'])
    controller.track('/', 1, { tier: 'plain' }, 1)
    await tick()
    expect(controller.menu.getSnapshot().groups[0]?.items).toEqual([{ name: 'old' }])
    const seen: number[] = []
    controller.lexicon.subscribe(() => { seen.push(controller.lexicon.getSnapshot().size) })
    roll = ['commit-helper']
    notify?.()
    await tick()
    await tick()
    expect(controller.lexicon.getSnapshot().get('/')).toEqual(['commit-helper'])
    expect(controller.menu.getSnapshot().groups[0]?.items).toEqual([{ name: 'commit-helper' }])
    expect(seen).toEqual([1])
    controller.dispose()
    expect(notify).toBeUndefined()
  })

  it('a source registered after scope birth is warmed and folded into the live lexicon', () => {
    /** 中文说明：测试局部值 { controller, sources }，由紧邻初始化决定。 */
    const { controller, sources } = controllerBench([])
    expect(controller.lexicon.getSnapshot().size).toBe(0)
    /** 中文说明：测试局部值 warm，由紧邻初始化决定。 */
    const warm = vi.fn()
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late: InputTriggerSource = {
      trigger: '/',
      name: 'late',
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      warm,
      lexicon: () => ['fresh'],
    }
    sources.push(late)
    controller.sourceAdded(late)
    expect(warm).toHaveBeenCalledWith({ sessionId: sid('a') })
    expect(controller.lexicon.getSnapshot().get('/')).toEqual(['fresh'])
  })

  it('a removed source leaves the aggregated lexicon', () => {
    /** 中文说明：测试局部值 src，由紧邻初始化决定。 */
    const src = lexSource('/', 'skill', ['gone'])
    /** 中文说明：测试局部值 { controller, sources }，由紧邻初始化决定。 */
    const { controller, sources } = controllerBench([src])
    expect(controller.lexicon.getSnapshot().get('/')).toEqual(['gone'])
    sources.splice(sources.indexOf(src), 1)
    controller.sourceRemoved(src)
    expect(controller.lexicon.getSnapshot().size).toBe(0)
  })
})

describe('arbitrate', () => {
  /** 中文说明：函数 menuBench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  async function menuBench() {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = readySource('/', 'command', [{ name: 'goal' }, { name: 'plan' }], () => undefined)
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    controller.track('/g', 2, { tier: 'plain' }, 1)
    await tick()
    return { controller, cmd }
  }

  it('up/down move the highlight and are consumed', async () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = await menuBench()
    expect(controller.arbitrate('down', false)).toBe('consumed')
    expect(controller.menu.getSnapshot().highlight).toEqual({ source: 'command', index: 1 })
    expect(controller.arbitrate('up', false)).toBe('consumed')
    expect(controller.menu.getSnapshot().highlight).toEqual({ source: 'command', index: 0 })
  })

  it('hover parks the shared highlight; disposed controllers ignore it', async () => {
    const { controller } = await menuBench()
    controller.hover('command', 1)
    expect(controller.menu.getSnapshot().highlight).toEqual({ source: 'command', index: 1 })
    // Keyboard keeps moving from the parked spot: last input wins.
    expect(controller.arbitrate('up', false)).toBe('consumed')
    expect(controller.menu.getSnapshot().highlight).toEqual({ source: 'command', index: 0 })
    controller.dispose()
    controller.hover('command', 1)
    expect(controller.menu.getSnapshot().highlight).toBeNull()
  })

  it('enter picks the highlight through the pipeline', async () => {
    /** 中文说明：测试局部值 { controller, cmd }，由紧邻初始化决定。 */
    const { controller, cmd } = await menuBench()
    expect(controller.arbitrate('enter', false)).toBe('pick-highlighted')
    expect(cmd.picks[0]!.candidate.name).toBe('goal')
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('escape closes and consumes', async () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = await menuBench()
    expect(controller.arbitrate('escape', false)).toBe('consumed')
    expect(controller.menu.getSnapshot().open).toBe(false)
  })

  it('tab drills into a drillable highlight and passes on plain rows', async () => {
    const drillable = readySource('/', 'command', [{ name: 'src', drill: true }, { name: 'plan' }], () => undefined)
    const { controller } = controllerBench([drillable.source])
    controller.track('/s', 2, { tier: 'plain' }, 1)
    await tick()
    expect(controller.arbitrate('tab', false)).toBe('consumed')
    expect(drillable.picks[0]!.action).toBe('drill')
    expect(drillable.picks[0]!.candidate.name).toBe('src')
    // Plain row (no drill flag): the key passes so native focus stays intact.
    controller.track('/s', 2, { tier: 'plain' }, 2)
    await tick()
    controller.arbitrate('down', false)
    expect(controller.arbitrate('tab', false)).toBe('pass')
    expect(drillable.picks).toHaveLength(1)
  })

  it('a settling pick reports the pick action', async () => {
    const { controller, cmd } = await menuBench()
    controller.arbitrate('enter', false)
    expect(cmd.picks[0]!.action).toBe('pick')
  })

  it('IME composition passes every key untouched', async () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = await menuBench()
    /** 中文说明：测试局部值 key，由紧邻初始化决定。 */
    for (const key of ['up', 'down', 'enter', 'escape'] as const) {
      expect(controller.arbitrate(key, true)).toBe('pass')
    }
    expect(controller.menu.getSnapshot().open).toBe(true)
  })

  it('closed menu passes; an open menu without a highlight passes enter', () => {
    /** 中文说明：测试局部值 cmd，由紧邻初始化决定。 */
    const cmd = deferredSource('/', 'command')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([cmd.source])
    expect(controller.arbitrate('enter', false)).toBe('pass')
    // Open with the only group still pending: nothing to pick yet.
    controller.track('/g', 2, { tier: 'plain' }, 1)
    expect(controller.arbitrate('enter', false)).toBe('pass')
  })
})

describe('onSpace', () => {
  /** 中文说明：函数 spaceSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function spaceSource(name: string, answer: PickOutcome, calls: string[]): InputTriggerSource {
    return {
      trigger: '/',
      name,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      matchSpace: (_session, token) => {
        calls.push(`${name}:${token}`)
        return answer
      },
    }
  }

  it('polls matchSpace in registration order; the first non-undefined wins and true = applied', () => {
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: string[] = []
    /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
    const claim = claimOf('/goal ')
    /** 中文说明：测试局部值 { controller, actx }，由紧邻初始化决定。 */
    const { controller, actx } = controllerBench([
      // Hook-less source: never polled, so it must not shadow the order below.
      { trigger: '/', name: 'nohook', candidates: () => Promise.resolve([]), onPick: () => undefined },
      spaceSource('first', undefined, calls),
      spaceSource('second', { claim }, calls),
      spaceSource('third', { claim: claimOf('/x ') }, calls),
    ])
    /** 中文说明：测试局部值 begins，由紧邻初始化决定。 */
    const begins: BeginCommandRequest[] = []
    actx.on('slash/input-begin-command', (req) => {
      begins.push(req)
      return true
    })
    controller.track('/goal', 5, { tier: 'plain' }, 1)
    expect(controller.onSpace()).toBe(true)
    expect(calls).toEqual(['first:/goal', 'second:/goal'])
    expect(begins).toEqual([{ claim, span: { start: 0, end: 5, draftRev: 1 } }])
  })

  it('answers false when the input declines the claim; handled outcomes are true without a dispatch', () => {
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: string[] = []
    /** 中文说明：测试局部值 declined，由紧邻初始化决定。 */
    const declined = controllerBench([spaceSource('command', { claim: claimOf('/goal ') }, calls)])
    declined.actx.on('slash/input-begin-command', () => undefined)
    declined.controller.track('/goal', 5, { tier: 'plain' }, 1)
    expect(declined.controller.onSpace()).toBe(false)

    /** 中文说明：测试局部值 handled，由紧邻初始化决定。 */
    const handled = controllerBench([spaceSource('command', 'handled', calls)])
    /** 中文说明：测试局部值 begins，由紧邻初始化决定。 */
    const begins: BeginCommandRequest[] = []
    handled.actx.on('slash/input-begin-command', (req) => {
      begins.push(req)
      return true
    })
    handled.controller.track('/goal', 5, { tier: 'plain' }, 1)
    expect(handled.controller.onSpace()).toBe(true)
    expect(begins).toHaveLength(0)
  })

  it('answers false off a non-leading hit or with no tracked hit', () => {
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: string[] = []
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([spaceSource('command', { claim: claimOf('/goal ') }, calls)])
    expect(controller.onSpace()).toBe(false)

    controller.track('say /goal', 9, { tier: 'plain' }, 1)
    expect(controller.onSpace()).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('adjudicate', () => {
  /** 中文说明：测试局部值 enterSource，由紧邻初始化决定。 */
  const enterSource = (
    trigger: TriggerChar, name: string,
    matchEnter?: InputTriggerSource['matchEnter'],
  ): InputTriggerSource => ({
    trigger,
    name,
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    ...(matchEnter !== undefined ? { matchEnter } : {}),
  })

  it('polls matchEnter in registration order with the projection and full line; first non-undefined wins', async () => {
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls: string[] = []
    /** 中文说明：测试局部值 claim，由紧邻初始化决定。 */
    const claim = claimOf('/goal ')
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      enterSource('/', 'silent'),
      enterSource('/', 'first', (session, line) => {
        expect(session).toEqual({ sessionId: sid('a') })
        calls.push(`first:${line}`)
        return Promise.resolve(undefined)
      }),
      enterSource('/', 'second', (_session, line) => {
        calls.push(`second:${line}`)
        return Promise.resolve({ claim })
      }),
      enterSource('/', 'third', () => {
        calls.push('third')
        return Promise.resolve('handled')
      }),
    ])
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await controller.adjudicate('/goal make it fast', new AbortController().signal, { images: 0 })
    expect(result).toEqual({ claim })
    expect(calls).toEqual(['first:/goal make it fast', 'second:/goal make it fast'])
  })

  it('skips sources of another trigger; all-undefined answers undefined', async () => {
    /** 中文说明：测试局部值 atHook，由紧邻初始化决定。 */
    const atHook = vi.fn(() => Promise.resolve('handled' as const))
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      enterSource('@', 'subagent', atHook),
      enterSource('/', 'command', () => Promise.resolve(undefined)),
    ])
    await expect(controller.adjudicate('/xyz', new AbortController().signal, { images: 0 })).resolves.toBeUndefined()
    expect(atHook).not.toHaveBeenCalled()
  })

  it('forwards the caller envelope to every polled matchEnter unchanged', async () => {
    /** 中文说明：测试局部值 envelopes，由紧邻初始化决定。 */
    const envelopes: unknown[] = []
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      enterSource('/', 'first', (_session, _line, _signal, envelope) => {
        envelopes.push(envelope)
        return Promise.resolve(undefined)
      }),
      enterSource('/', 'second', (_session, _line, _signal, envelope) => {
        envelopes.push(envelope)
        return Promise.resolve('handled')
      }),
    ])
    /** 中文说明：测试局部值 envelope，由紧邻初始化决定。 */
    const envelope = { images: 2 }
    await controller.adjudicate('/goal', new AbortController().signal, envelope)
    expect(envelopes).toEqual([envelope, envelope])
    expect(envelopes[0]).toBe(envelope)
  })

  it('a rejecting source rejects the whole adjudication', async () => {
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([
      enterSource('/', 'command', () => Promise.reject(new Error('warmup failed'))),
      enterSource('/', 'late', () => Promise.resolve('handled')),
    ])
    await expect(controller.adjudicate('/goal x', new AbortController().signal, { images: 0 }))
      .rejects.toThrow('warmup failed')
  })

  it('an aborted attempt signal stops the poll', async () => {
    /** 中文说明：测试局部值 hook，由紧邻初始化决定。 */
    const hook = vi.fn(() => Promise.resolve(undefined))
    /** 中文说明：测试局部值 { controller }，由紧邻初始化决定。 */
    const { controller } = controllerBench([enterSource('/', 'command', hook)])
    /** 中文说明：测试局部值 abort，由紧邻初始化决定。 */
    const abort = new AbortController()
    abort.abort(new Error('attempt released'))
    await expect(controller.adjudicate('/goal', abort.signal, { images: 0 })).rejects.toThrow('attempt released')
    expect(hook).not.toHaveBeenCalled()
  })
})
