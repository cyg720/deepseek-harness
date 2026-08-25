/**
 * @vitest-environment jsdom
 *
 * Load-engine account: what `load` answers its caller (that answer is what the
 * run orchestration reports to the host), Plugin Run convergence against live
 * state, per-Plugin serialization, the three-step teardown, and each failing stage.
 *
 * The loader is stood in by real `ctx.plugin` fibers: entry creation must run the
 * guarded surface as a genuine plugin, or neither activation gating nor the
 * disposal cascade under test would be real.
 */
/*
 * 文件职责：验证Cordis 客户端运行器的 runner.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 客户端运行器在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */

import { Context } from '@deepseek-ai/cordis'
import type { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it, vi } from 'vitest'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { DYNAMIC_CLIENT_REDIRECTS } from '../src/client/evaluator.ts'
import { DynamicCordisPackageRunner } from '../src/client/runtime.ts'
import type { DynamicCordisClientHalf, DynamicCordisRenderFailure } from '../src/client/runtime.ts'

/** 中文说明：测试局部值 PLUGIN，由紧邻初始化决定。 */
const PLUGIN = 'dyn-1' as CordisDynamicPluginId
/** 中文说明：测试局部值 PACKAGE，由紧邻初始化决定。 */
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
/** 中文说明：测试局部值 RUN，由紧邻初始化决定。 */
const RUN = 'run-1' as CordisDynamicPluginRunId
/** 中文说明：测试局部值 AGENT，由紧邻初始化决定。 */
const AGENT = 's-1' as SessionId

/** 中文说明：函数 runId 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function runId(value: number): CordisDynamicPluginRunId {
  return `run-${value}` as CordisDynamicPluginRunId
}

/** One browser half as the host hands it over. */
/* 中文说明：函数 half 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function half(overrides: Partial<DynamicCordisClientHalf> = {}): DynamicCordisClientHalf {
  return {
    pluginId: PLUGIN,
    packageId: PACKAGE,
    pluginRunId: RUN,
    agentId: AGENT,
    name: 'demo',
    code: 'return { apply(ctx) {} }',
    ...overrides,
  }
}

/** 中文说明：类型或类 Bench 约束扩展或反馈数据职责。 */
interface Bench {
  ctx: Context
  slots: SlotRegistry
  runner: DynamicCordisPackageRunner
  invalidated: string[]
  removed: string[]
  created: string[]
  invoke: ReturnType<typeof vi.fn>
  /** Render failures the runner sent upstream, in order. */
  reported: {
    agentId: SessionId
    pluginId: CordisDynamicPluginId
    pluginRunId: CordisDynamicPluginRunId
    failure: DynamicCordisRenderFailure
  }[]
  /**
   * Report one entry crash the way the renderer's boundary does: the runner
   * subscribed through the supervision seam, and this calls what it registered.
   */
  crash: (slot: string, entry: unknown, error: unknown, abdicated?: boolean) => void
  /** Whether the runner released its subscription. */
  watching: () => boolean
  settle: () => Promise<void>
}

/**
 * Terminate the awaitable fiber handle. The runner reads activation failure
 * through `fiber.await()`; without a handler on the fiber itself, a deliberately
 * failing package would also surface as an unhandled rejection.
 */
/* 中文说明：函数 seated 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function seated<T>(fiber: T): T {
  void Promise.resolve(fiber).catch(() => {})
  return fiber
}

/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(): Promise<Bench> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  /** 中文说明：测试局部值 invalidated，由紧邻初始化决定。 */
  const invalidated: string[] = []
  /** 中文说明：测试局部值 removed，由紧邻初始化决定。 */
  const removed: string[] = []
  /** 中文说明：测试局部值 created，由紧邻初始化决定。 */
  const created: string[] = []
  /** 中文说明：测试局部值 factories，由紧邻初始化决定。 */
  const factories = new Map<string, () => unknown>()
  /** 中文说明：测试局部值 fibers，由紧邻初始化决定。 */
  const fibers = new Map<string, { fiber: unknown }>()
  /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
  let next = 0

  ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = {
    load: (handoff: { id: string; factory: () => unknown }) => { factories.set(handoff.id, handoff.factory) },
  }
  /** 中文说明：测试局部值 loader，由紧邻初始化决定。 */
  const loader = {
    create: (options: { name: string }) => {
      created.push(options.name)
      /** 中文说明：测试局部值 factory，由紧邻初始化决定。 */
      const factory = factories.get(options.name)
      if (factory === undefined) throw new Error(`no factory for ${options.name}`)
      /** 中文说明：测试局部值 entryId，由紧邻初始化决定。 */
      const entryId = `entry-${++next}`
      fibers.set(entryId, { fiber: seated(ctx.plugin(factory() as Parameters<Context['plugin']>[0])) })
      return Promise.resolve(entryId)
    },
    resolve: (entryId: string) => fibers.get(entryId) ?? { fiber: undefined },
    remove: async (entryId: string) => {
      removed.push(entryId)
      /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
      const entry = fibers.get(entryId)
      fibers.delete(entryId)
      await (entry?.fiber as { dispose(): Promise<void> } | undefined)?.dispose()
    },
  } as unknown as Loader

  /** 中文说明：测试局部值 invoke，由紧邻初始化决定。 */
  const invoke = vi.fn(() => Promise.resolve(null))
  /** 中文说明：测试局部值 reported，由紧邻初始化决定。 */
  const reported: Bench['reported'] = []
  // The crash seam is stood in so a test can report an entry failure without a
  // React render, exactly as the renderer's boundary would; registrations still
  // go through the real service, so the entries are real.
  /** 中文说明：类型或类 EntryErrorListener 约束扩展或反馈数据职责。 */
  type EntryErrorListener = (slot: string, entry: unknown, error: unknown, info: { abdicated: boolean }) => void
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let listener: EntryErrorListener | undefined
  /** 中文说明：测试局部值 runner，由紧邻初始化决定。 */
  const runner = new DynamicCordisPackageRunner({
    ctx,
    loader,
    modules: { invalidate: (id: string) => { invalidated.push(id) } } as unknown as ClientModuleSystem,
    slots: {
      onEntryError: (fn: EntryErrorListener) => {
        listener = fn
        return () => { listener = undefined }
      },
    } as unknown as SlotRegistry,
    invoke,
    reportGuardFailure: () => {},
    reportRenderFailure: (agentId, pluginId, pluginRunId, failure) => {
      reported.push({ agentId, pluginId, pluginRunId, failure })
    },
  })
  return {
    ctx,
    slots: ctx.slots,
    runner,
    invalidated,
    removed,
    created,
    invoke,
    reported,
    crash: (slot, entry, error, abdicated = true) => {
      if (listener === undefined) throw new Error('the runner is not watching the crash seam')
      listener(slot, entry, error, { abdicated })
    },
    watching: () => listener !== undefined,
    settle: async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) },
  }
}

describe('load', () => {
  it('mounts a browser half through the module table and the loader, then answers active', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect(bench.invalidated).toEqual(['dyn/dyn-1'])
    expect(bench.created).toEqual(['dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
    expect(bench.runner.getSnapshot()).toEqual([
      { pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, name: 'demo', slots: [], styleCount: 0 },
    ])
  })

  it('projects the contributions the package made', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({
      code: `return {
        inject: ['slots'],
        apply(ctx) {
          styles.insert('.x {}')
          ctx.slots.register({ name: 'root' }, () => null)
        },
      }`,
    }))
    expect(bench.runner.getSnapshot()).toEqual([
      { pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, name: 'demo', slots: ['root'], styleCount: 1 },
    ])
  })

  it('answers from live state when the revision is already loaded here', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half())
    // A replayed run must not look unacknowledged, and must not reload.
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect(bench.created).toEqual(['dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })

  it('replays the parked services a live package still waits for', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 parked，由紧邻初始化决定。 */
    const parked = half({ code: "return { inject: ['absent'], apply() {} }" })
    await expect(bench.runner.load(parked)).resolves.toEqual({ ok: true, pluginRunId: RUN, waitingFor: ['absent'] })
    await expect(bench.runner.load(parked)).resolves.toEqual({ ok: true, pluginRunId: RUN, waitingFor: ['absent'] })
    expect(bench.created).toEqual(['dyn/dyn-1'])
  })

  it('replaces a live load when a newer revision arrives', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half())
    await expect(bench.runner.load(half({ pluginRunId: runId(2) }))).resolves.toEqual({ ok: true, pluginRunId: runId(2) })
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.invalidated).toEqual(['dyn/dyn-1', 'dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.created).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.runner.getSnapshot()[0]?.pluginRunId).toBe(runId(2))
  })

  it('loads the function form, which declares no services', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'return (ctx) => { globalThis.__dynFnForm = true }' })))
      .resolves.toEqual({ ok: true, pluginRunId: RUN })
    expect((globalThis as { __dynFnForm?: boolean }).__dynFnForm).toBe(true)
    delete (globalThis as { __dynFnForm?: boolean }).__dynFnForm
  })

  it('serializes operations of one package id', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = bench.runner.load(half())
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = bench.runner.load(half({ pluginRunId: runId(2) }))
    await expect(first).resolves.toEqual({ ok: true, pluginRunId: RUN })
    await expect(second).resolves.toEqual({ ok: true, pluginRunId: runId(2) })
    expect(bench.created).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
  })

  it('keeps the queue usable after a failed operation', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 sink，由紧邻初始化决定。 */
    const sink = (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__
    delete (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__
    await expect(bench.runner.load(half())).rejects.toThrow(/__ModuleLoader__ is missing/)
    ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = sink
    await expect(bench.runner.load(half())).resolves.toEqual({ ok: true, pluginRunId: RUN })
  })
})

describe('failure stages', () => {
  it('classifies a closure that will not evaluate, and leaves no styles behind', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'styles.insert(".leak {}"); return 42' }))).resolves.toEqual({
      ok: false,
      cause: 'evaluate',
      message: expect.stringContaining('must `return` a plugin') as string,
      stack: expect.any(String),
      error: expect.any(Error),
    })
    /** 中文说明：测试局部值 leaked，由紧邻初始化决定。 */
    const leaked = [...document.querySelectorAll('style[data-dyn="dyn-1"]')]
      .filter(tag => tag.textContent === '.leak {}')
    expect(leaked).toHaveLength(0)
    expect(bench.created).toEqual([])
  })

  it('classifies an apply that throws, and tears the entry down', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'return { apply() { throw new Error("apply exploded") } }' })))
      .resolves.toEqual({
        ok: false,
        cause: 'activate',
        message: 'apply exploded',
        stack: expect.any(String),
        error: expect.any(Error),
      })
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(false)
  })

  it('stringifies a closure that rejects with a non-Error value', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await expect(bench.runner.load(half({ code: 'throw "raw rejection"' })))
      .resolves.toEqual({ ok: false, cause: 'evaluate', message: 'raw rejection', error: 'raw rejection' })
  })

  it('classifies a loader entry that produced no fiber', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 env，由紧邻初始化决定。 */
    const env = bench.runner as unknown as { env: { loader: { resolve: (id: string) => unknown } } }
    vi.spyOn(env.env.loader, 'resolve').mockReturnValue({ fiber: undefined })
    await expect(bench.runner.load(half())).resolves.toEqual({
      ok: false,
      cause: 'module-import',
      message: 'module import failed (see the browser console)',
    })
    vi.restoreAllMocks()
    expect(bench.removed).toEqual(['entry-1'])
  })

  it('mirrors a loaded package runtime error to the console without unloading it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 logged，由紧邻初始化决定。 */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await bench.runner.load(half({
      code: 'return { apply: (ctx) => { ctx.on("t/ping", () => console.error("after load")) } }',
    }))
    ;(bench.ctx.emit as (type: string) => void)('t/ping')
    /** 中文说明：测试局部值 mirrored，由紧邻初始化决定。 */
    const mirrored = logged.mock.calls.filter(call => String(call[0]).includes('logged an error'))
    logged.mockRestore()
    expect(mirrored).toHaveLength(1)
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })
})

describe('retract', () => {
  it('unloads at the named revision', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half())
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.invalidated).toEqual(['dyn/dyn-1', 'dyn/dyn-1'])
    expect(bench.runner.isLoaded(PLUGIN)).toBe(false)
  })

  it('ignores a retract of a superseded revision', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ pluginRunId: runId(3) }))
    bench.runner.retract(PLUGIN, runId(2))
    await bench.settle()
    expect(bench.runner.isLoaded(PLUGIN)).toBe(true)
  })

  it('ignores a retract of a package this page never loaded', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(bench.removed).toEqual([])
  })
})

describe('observation and disposal', () => {
  it('notifies subscribers and re-derives the snapshot after each convergence', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    let notified = 0
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = bench.runner.subscribe(() => { notified++ })
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = bench.runner.getSnapshot()
    expect(bench.runner.getSnapshot()).toBe(empty) // stable between mutations
    await bench.runner.load(half())
    expect(notified).toBe(1)
    expect(bench.runner.getSnapshot()).not.toBe(empty)
    unsubscribe()
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    expect(notified).toBe(1)
  })

  it('unloads every live package on disposal', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half())
    await bench.runner.dispose()
    expect(bench.removed).toEqual(['entry-1'])
    expect(bench.runner.getSnapshot()).toEqual([])
    expect(bench.slots.entries('root')).toHaveLength(0)
  })

  it('routes host.call through the invoke seam it was given', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: 'return { apply: () => host.call("ping", 1) }' }))
    expect(bench.invoke).toHaveBeenCalledWith(PLUGIN, RUN, 'ping', 1)
  })
})

describe('render failures', () => {
  /** A package that seats one component in `root`, so a crash has something to name. */
  /* 中文说明：测试局部值 CONTRIBUTOR，由紧邻初始化决定。 */
  const CONTRIBUTOR = `return {
    inject: ['slots'],
    apply(ctx) { ctx.slots.register({ name: 'root' }, () => null) },
  }`

  it('reports a crash of an entry it seated, under the session the run was for', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('Cannot read properties of undefined'))
    expect(bench.reported).toEqual([{
      agentId: AGENT,
      pluginId: PLUGIN,
      pluginRunId: RUN,
      failure: {
        slot: 'root',
        message: 'your entry in slot "root" crashed while React rendered it: Cannot read properties of undefined',
        stack: expect.any(String),
        abdicated: true,
      },
    }])
  })

  it('carries the retirement bit as the seam reported it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    // A chain crash keeps its cell: the package's UI is broken, not gone, and the
    // author needs to be able to tell those apart.
    bench.crash('root', entry, new Error('boom'), false)
    expect(bench.reported[0]?.failure.abdicated).toBe(false)
  })

  it('ignores a crash of an entry no dynamic package seated', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    // Factory UI crashing is not this runner's business, and neither is an entry
    // whose component cannot even be indexed by identity.
    bench.crash('root', { component: () => null }, new Error('boom'))
    bench.crash('root', { component: 'not-a-component' }, new Error('boom'))
    bench.crash('root', { component: null }, new Error('boom'))
    expect(bench.reported).toEqual([])
  })

  it('seats a package that registers an unindexable component without claiming it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    // A component that is not an object has no identity to key ownership on; the
    // registration still stands, and a crash on it simply goes unattributed.
    await expect(bench.runner.load(half({
      code: `return {
        inject: ['slots'],
        apply(ctx) {
          ctx.slots.register({ name: 'root' }, 'not-a-component')
          ctx.slots.register({ name: 'root' }, null)
        },
      }`,
    }))).resolves.toEqual({ ok: true, pluginRunId: RUN })
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    for (const entry of bench.slots.entries('root')) bench.crash('root', entry, new Error('boom'))
    expect(bench.reported).toEqual([])
  })

  it('appends the redirect a bare crash text is missing, and never twice', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    // Reaching the global around the closure trap (window.setInterval) crashes
    // with the engine's own text, which teaches nothing on its own.
    bench.crash('root', entry, new TypeError('window.setInterval is not a function'))
    /** 中文说明：测试局部值 bare，由紧邻初始化决定。 */
    const bare = bench.reported[0]?.failure.message ?? ''
    expect(bare).toMatch(/is not a function\n/)
    /** 中文说明：测试局部值 timerRedirect，由紧邻初始化决定。 */
    const timerRedirect = DYNAMIC_CLIENT_REDIRECTS.setInterval
    if (timerRedirect === undefined) throw new Error('setInterval redirect is missing')
    expect(bare).toContain(timerRedirect)
    // The trap's own error already carries that sentence: appending it again
    // would make the model read the same paragraph twice.
    bench.crash('root', entry, new Error(
      `setInterval is not available in a dynamic client half — ${timerRedirect}`,
    ))
    /** 中文说明：测试局部值 trapped，由紧邻初始化决定。 */
    const trapped = bench.reported[1]?.failure.message ?? ''
    expect(trapped.indexOf(timerRedirect)).toBe(trapped.lastIndexOf(timerRedirect))
  })

  it('stops watching the seam when the engine is disposed', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    expect(bench.watching()).toBe(true)
    await bench.runner.dispose()
    expect(bench.watching()).toBe(false)
  })

  it('publishes the crash on the live set\'s own notification channel', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    let notified = 0
    /** 中文说明：测试局部值 alsoNotified，由紧邻初始化决定。 */
    let alsoNotified = 0
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = bench.runner.subscribe(() => { notified++ })
    /** 中文说明：测试局部值 unobserve，由紧邻初始化决定。 */
    const unobserve = bench.runner.renderFailures.subscribe(() => { alsoNotified++ })
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = bench.runner.renderFailures.getSnapshot()
    expect(bench.runner.renderFailures.getSnapshot()).toBe(empty) // stable between mutations
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('boom'), false)
    // A surface already subscribed for load changes learns about a crash too: one
    // channel, two derived snapshots — and the observable's own subscribe is that
    // same channel, so a surface may take either handle.
    expect(notified).toBe(1)
    expect(alsoNotified).toBe(1)
    /** 中文说明：测试局部值 published，由紧邻初始化决定。 */
    const published = bench.runner.renderFailures.getSnapshot().get(PLUGIN)
    expect(published?.slot).toBe('root')
    expect(published?.abdicated).toBe(false)
    expect(published?.message).toMatch(/boom/)
    unsubscribe()
    unobserve()
  })

  it('keeps only the latest crash per package', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('first'))
    bench.crash('root', entry, new Error('second'))
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(1)
    expect(bench.runner.renderFailures.getSnapshot().get(PLUGIN)?.message).toMatch(/second/)
  })

  it('clears the crash when the package is retracted', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('boom'))
    bench.runner.retract(PLUGIN, RUN)
    await bench.settle()
    // A row must never show a failure of something that no longer renders here.
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(0)
  })

  it('clears the crash when the package loads again', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('boom'))
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(1)
    await bench.runner.load(half({ code: CONTRIBUTOR, pluginRunId: runId(2) }))
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(0)
  })

  it('keeps the crash when a replayed run loads nothing', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.slots.entries('root')
    bench.crash('root', entry, new Error('boom'))
    // Same revision: nothing was re-run, so the failure the page is showing is
    // still true of what is mounted.
    await bench.runner.load(half({ code: CONTRIBUTOR }))
    expect(bench.runner.renderFailures.getSnapshot().size).toBe(1)
  })
})
