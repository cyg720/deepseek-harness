/**
 * @vitest-environment jsdom
 *
 * Plugin composition account: the dispatch family reaches the runner with its
 * envelope rpcId, the service face is provided for UI surfaces, a load failure
 * always reaches the console, and the fiber owns the runner's teardown. Plus the two plane-level companions: the
 * node half's empty apply and the invariant registration.
 */
/**
 * 文件职责：验证Cordis 客户端运行器的 plugin.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 客户端运行器在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import InvariantService from '@deepseek-ai/dsh-invariants'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { DynamicCordisInvokeResult } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: resolves `ctx.remote` and with it the `$on`/`$dispatch` surface.
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import * as NodeHalf from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import * as ClientHalf from '../src/client/index.ts'

/** 中文说明：测试局部值 PLUGIN，由紧邻初始化决定。 */
const PLUGIN = 'dyn-1' as CordisDynamicPluginId
/** 中文说明：测试局部值 PACKAGE，由紧邻初始化决定。 */
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
/** 中文说明：测试局部值 RUN，由紧邻初始化决定。 */
const RUN = 'run-1' as CordisDynamicPluginRunId
/** 中文说明：测试局部值 AGENT，由紧邻初始化决定。 */
const AGENT = 's-1' as SessionId
/** 中文说明：测试局部值 USER_RUN，由紧邻初始化决定。 */
const USER_RUN = {
  agentId: AGENT, pluginId: PLUGIN, packageId: PACKAGE, mode: 'run' as const, hasClientHalf: true,
}

/**
 * Deliver one forwarded Host event the way the runtime's frame bridge does: the
 * bridge hands `host/remote-event` to the Remote service, which fans it out to
 * `$on` subscribers with the Host's own argument list.
 */
/** 中文说明：函数 forward 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function forward(ctx: Context, event: string, payload: object): void {
  ctx.remote.$dispatch(event, [payload])
}

/** 中文说明：类型或类 Bench 约束扩展或反馈数据职责。 */
interface Bench {
  ctx: Context
  /** Source the host hands over for the next run. */
  source: { current: {
    code: string
    name: string
    pluginId: CordisDynamicPluginId
    packageId: CordisDynamicPackageId
    pluginRunId: CordisDynamicPluginRunId
  } }
  /** Resolutions the host received. */
  resolved: { requestId: string; resolution: unknown }[]
  /** What the namespace received. */
  invoked: { pluginId: CordisDynamicPluginId; pluginRunId: CordisDynamicPluginRunId; method: string; args: unknown }[]
  /** Answer of the next invoke call. */
  invokeResult: { current: DynamicCordisInvokeResult }
  /** Rejection the namespace throws instead of answering (the codec refusing a payload). */
  invokeThrow: { current: unknown }
  /** Render failures the namespace received, in order. */
  renderFailures: {
    agentId: string
    pluginId: CordisDynamicPluginId
    pluginRunId: CordisDynamicPluginRunId
    failure: unknown
  }[]
  /** Whether the namespace refuses the next render-failure report. */
  reportRefused: { current: boolean }
  /**
   * Report one entry crash the way the renderer's boundary does. Production calls
   * this from ui-renderer's boundary through the render host; a test has no React
   * tree, so it stands in for that caller on the same core seam.
   */
  crash: (slot: string, entry: unknown, abdicate: boolean, error: unknown) => void
  dispose: () => Promise<void>
  settle: () => Promise<void>
}

/** Mount the browser half over a module table and a loader standing on real fibers. */
/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(): Promise<Bench> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  /** 中文说明：测试局部值 factories，由紧邻初始化决定。 */
  const factories = new Map<string, () => unknown>()
  /** 中文说明：测试局部值 fibers，由紧邻初始化决定。 */
  const fibers = new Map<string, { fiber: unknown }>()
  /** 中文说明：测试局部值 next，由紧邻初始化决定。 */
  let next = 0
  ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = {
    load: (handoff: { id: string; factory: () => unknown }) => { factories.set(handoff.id, handoff.factory) },
  }
  ctx.reflect.provide('loader', {
    create: (options: { name: string }) => {
      /** 中文说明：测试局部值 entryId，由紧邻初始化决定。 */
      const entryId = `entry-${++next}`
      /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
      const fiber = ctx.plugin(factories.get(options.name)?.() as Parameters<Context['plugin']>[0])
      // The runner reads activation failure through fiber.await(); terminate this
      // handle too, or a failing package also lands as an unhandled rejection.
      void Promise.resolve(fiber).catch(() => {})
      fibers.set(entryId, { fiber })
      return Promise.resolve(entryId)
    },
    resolve: (entryId: string) => fibers.get(entryId) ?? { fiber: undefined },
    remove: async (entryId: string) => {
      /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
      const entry = fibers.get(entryId)
      fibers.delete(entryId)
      await (entry?.fiber as { dispose(): Promise<void> } | undefined)?.dispose()
    },
  })
  ctx.reflect.provide('modules', { invalidate: () => {} })
  /** 中文说明：测试局部值 invoked，由紧邻初始化决定。 */
  const invoked: Bench['invoked'] = []
  /** 中文说明：测试局部值 invokeResult，由紧邻初始化决定。 */
  const invokeResult: { current: DynamicCordisInvokeResult } = { current: { ok: true, value: 'pong' } }
  /** 中文说明：测试局部值 invokeThrow，由紧邻初始化决定。 */
  const invokeThrow: { current: unknown } = { current: undefined }
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source: Bench['source'] = { current: {
    code: 'return { apply(ctx) {} }',
    name: 'demo',
    pluginId: PLUGIN,
    packageId: PACKAGE,
    pluginRunId: RUN,
  } }
  /** 中文说明：测试局部值 resolved，由紧邻初始化决定。 */
  const resolved: { requestId: string; resolution: unknown }[] = []
  /** 中文说明：测试局部值 renderFailures，由紧邻初始化决定。 */
  const renderFailures: Bench['renderFailures'] = []
  /** 中文说明：测试局部值 reportRefused，由紧邻初始化决定。 */
  const reportRefused = { current: false }
  // Every generated Remote method resolves to a RemoteResult: the carrier folds
  // its own failures into the error branch, and only an assembly fault rejects.
  /** 中文说明：测试局部值 answered，由紧邻初始化决定。 */
  const answered = <T>(value: T): Promise<{ ok: true; value: T }> => Promise.resolve({ ok: true as const, value })
  /** 中文说明：测试局部值 namespace，由紧邻初始化决定。 */
  const namespace = {
    syncInspectManifest: () => answered(null),
    resolveInspectQuery: () => answered({ accepted: true }),
    runHostHalf: () => answered({
      ok: true, pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, waitingFor: [], startedHere: true,
    }),
    settleUserRun: () => answered({
      ok: true, pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, waitingFor: [],
    }),
    reportRenderFailure: (
      agentId: string,
      pluginId: CordisDynamicPluginId,
      pluginRunId: CordisDynamicPluginRunId,
      failure: unknown,
    ) => {
      renderFailures.push({ agentId, pluginId, pluginRunId, failure })
      return reportRefused.current ? Promise.reject(new Error('stream gone')) : answered(undefined)
    },
    getClientCode: () => answered(source.current),
    resolveRequestRun: (requestId: string, resolution: unknown) => {
      resolved.push({ requestId, resolution })
      return answered({ accepted: true })
    },
    invoke: (
      pluginId: CordisDynamicPluginId,
      pluginRunId: CordisDynamicPluginRunId,
      method: string,
      args: unknown,
    ) => {
      invoked.push({ pluginId, pluginRunId, method, args })
      /** 中文说明：测试局部值 refusal，由紧邻初始化决定。 */
      const refusal = invokeThrow.current
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is a case under test
      if (refusal !== undefined) return Promise.reject(refusal)
      return answered(invokeResult.current)
    },
  }
  // Minimal stand-in for the gateway's Client Remote: the fan-out under test is
  // this plugin's subscriptions, so registration order and delivery are all the
  // stub owes (api-gateway covers isolation and disposal on the real one).
  /** 中文说明：测试局部值 listeners，由紧邻初始化决定。 */
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  /** 中文说明：测试局部值 remote，由紧邻初始化决定。 */
  const remote = {
    dynamicCordisRunner: namespace,
    $on: (event: string, listener: (...args: never[]) => void) => {
      /** 中文说明：测试局部值 bucket，由紧邻初始化决定。 */
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {
        /** 中文说明：测试局部值 at，由紧邻初始化决定。 */
        const at = bucket.indexOf(listener)
        if (at >= 0) bucket.splice(at, 1)
      }
    },
    $dispatch: (event: string, args: readonly unknown[]) => {
      /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
      for (const listener of [...listeners.get(event) ?? []]) {
        (listener as (...a: readonly unknown[]) => void)(...args)
      }
    },
  }
  ctx.reflect.provide('remote', remote)
  ctx.reflect.provide('remote.dynamicCordisRunner', namespace)
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin(ClientHalf)
  await fiber
  return {
    ctx,
    source,
    resolved,
    invoked,
    invokeResult,
    invokeThrow,
    renderFailures,
    reportRefused,
    crash: (slot, entry, abdicate, error) => {
      /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
      const core = (ctx.slots as unknown as {
        _core: { reportEntryError(key: string, entry: unknown, error: unknown, info: { abdicate: boolean }): void }
      })._core
      core.reportEntryError(slot, entry, error, { abdicate })
    },
    dispose: async () => { await fiber.dispose() },
    settle: async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) },
  }
}

describe('browser half', () => {
  it('provides the load engine as the page run-state face', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    expect(bench.ctx.dynamicCordisRunner.getSnapshot()).toEqual([])
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(false)
  })

  it('unloads on a forwarded withdrawal event', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(true)
    forward(bench.ctx, 'cordis/dynamic-retract', {
      pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN,
    })
    await bench.settle()
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(false)
  })

  it('runs a host-only definition through the face without loading anything here', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.ctx.dynamicCordisRunner.startUserRun({ ...USER_RUN, hasClientHalf: false })
    // The host half is up and this page has nothing — and no failure, which is
    // what the surface's control promised.
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(false)
    expect(bench.ctx.dynamicCordisRunner.lastRunError.getSnapshot().size).toBe(0)
  })

  it('routes host.call through the namespace and unwraps the result', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    bench.source.current = { ...bench.source.current,
      code: 'return { apply: () => { globalThis.__dynCall = host.call("ping", { a: 1 })'
        + '.then((value) => value, (error) => error.message) } }',
    }
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    const call = (globalThis as { __dynCall?: Promise<unknown> }).__dynCall
    delete (globalThis as { __dynCall?: Promise<unknown> }).__dynCall
    await expect(call).resolves.toBe('pong')
    expect(bench.invoked).toEqual([{
      pluginId: PLUGIN, pluginRunId: RUN, method: 'ping', args: { a: 1 },
    }])
  })

  it('carries an omitted host.call argument to the namespace as null', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    bench.source.current = { ...bench.source.current,
      code: 'return { apply: () => { globalThis.__dynCall = host.call("listServices") } }',
    }
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    const call = (globalThis as { __dynCall?: Promise<unknown> }).__dynCall
    delete (globalThis as { __dynCall?: Promise<unknown> }).__dynCall
    await call
    // `undefined` is not JSON, so the wire would refuse the call the model wrote
    // most naturally; the omission travels as null instead.
    expect(bench.invoked).toEqual([{
      pluginId: PLUGIN, pluginRunId: RUN, method: 'listServices', args: null,
    }])
  })

  it('teaches the JSON contract when the namespace refuses the payload', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    // What the generated codec throws for a value that is not JSON: a bare field
    // name, with no idea which call it belonged to or what to write instead.
    bench.invokeThrow.current = new Error('client api: dynamicCordisRunner/invoke rejected "args"')
    bench.source.current = { ...bench.source.current,
      code: 'return { apply: () => { globalThis.__dynCall = host.call("ping", 1)'
        + '.then(() => "resolved", (error) => error.message) } }',
    }
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    const call = (globalThis as { __dynCall?: Promise<string> }).__dynCall
    delete (globalThis as { __dynCall?: Promise<string> }).__dynCall
    await expect(call).resolves.toMatch(/host\.call\("ping"\) on dyn-1 did not complete: client api: .*rejected "args"/)
    await expect(call).resolves.toMatch(/omit it, and the handler receives null/)
    await expect(call).resolves.toMatch(/`return null` when there is nothing to report/)
  })

  it('stringifies a non-Error refusal into the same teaching error', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    bench.invokeThrow.current = 'stream gone'
    bench.source.current = { ...bench.source.current,
      code: 'return { apply: () => { globalThis.__dynCall = host.call("ping")'
        + '.then(() => "resolved", (error) => error.message) } }',
    }
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    const call = (globalThis as { __dynCall?: Promise<string> }).__dynCall
    delete (globalThis as { __dynCall?: Promise<string> }).__dynCall
    await expect(call).resolves.toMatch(/did not complete: stream gone/)
  })

  it('sends a render crash of its own entry to the host, and survives a refused report', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    bench.source.current = { ...bench.source.current,
      code: `return {
        inject: ['slots'],
        apply(ctx) { ctx.slots.register({ name: 'root' }, () => null) },
      }`,
    }
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 [entry]，由紧邻初始化决定。 */
    const [entry] = bench.ctx.slots.entries('root')
    bench.crash('root', entry, true, new Error('Cannot read properties of undefined'))
    expect(bench.renderFailures).toEqual([{
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
    // The same observation also reaches the page's own surface, so a row can show
    // it without reading the host back.
    expect(bench.ctx.dynamicCordisRunner.renderFailures.getSnapshot().get(PLUGIN)).toEqual(bench.renderFailures[0]?.failure)
    // A report the host refuses is logged and dropped: one crash must not become
    // two, and nothing waits on this answer.
    /** 中文说明：测试局部值 logged，由紧邻初始化决定。 */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    bench.reportRefused.current = true
    bench.crash('root', entry, false, new Error('again'))
    await bench.settle()
    /** 中文说明：测试局部值 complaints，由紧邻初始化决定。 */
    const complaints = logged.mock.calls.filter(call => String(call[0]).includes('reporting a render failure'))
    logged.mockRestore()
    expect(complaints).toHaveLength(1)
  })

  it('turns each routing failure code into its own teaching error', async () => {
    /** 中文说明：测试局部值 codes，由紧邻初始化决定。 */
    const codes = [
      ['plugin-not-running', /found no active Host half/],
      ['stale-run', /activation that has already been replaced/],
      ['method-not-found', /must declare it with harness\.handle\("ping", fn\)/],
      ['handler-error', /failed inside the host handler: boom/],
    ] as const
    /** 中文说明：测试局部值 [code，由紧邻初始化决定。 */
    for (const [code, expected] of codes) {
      /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
      const bench = await boot()
      bench.invokeResult.current = { ok: false, code, message: 'boom' }
      bench.source.current = { ...bench.source.current,
        code: 'return { apply: () => { globalThis.__dynCall = host.call("ping", 1)'
          + '.then(() => "resolved", (error) => error.message) } }',
      }
      await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
      /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
      const call = (globalThis as { __dynCall?: Promise<string> }).__dynCall
      delete (globalThis as { __dynCall?: Promise<string> }).__dynCall
      await expect(call).resolves.toMatch(expected)
    }
  })

  it('answers a run request after the surface approves it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = 'rr-1' as ApprovalRequestId
    forward(bench.ctx, 'cordis/request-run', {
      requestId: request,
      agentId: AGENT,
      pluginId: PLUGIN,
      packageId: PACKAGE,
      mode: 'run',
      name: 'demo',
      purpose: 'show a clock',
      requiresApproval: true,
    })
    await bench.settle()
    // The event's own fields reach the activity: a surface groups the row by
    // session and shows the reason without a registry read.
    expect(bench.ctx.dynamicCordisRunner.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'awaiting-approval',
      requestId: request,
      agentId: AGENT,
      packageId: PACKAGE,
      mode: 'run',
      name: 'demo',
      purpose: 'show a clock',
    })
    await bench.ctx.dynamicCordisRunner.approve(request, false)
    expect(bench.resolved).toEqual([{
      requestId: request, resolution: { ok: true, pluginRunId: RUN },
    }])
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(true)
    expect(bench.ctx.dynamicCordisRunner.activeRuns.getSnapshot().size).toBe(0)
  })

  it('drops the affordance when another page answers the request', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = 'rr-2' as ApprovalRequestId
    forward(bench.ctx, 'cordis/request-run', {
      requestId: request,
      agentId: AGENT,
      pluginId: PLUGIN,
      packageId: PACKAGE,
      mode: 'run',
      name: 'demo',
      purpose: 'p',
      requiresApproval: true,
    })
    await bench.settle()
    forward(bench.ctx, 'cordis/request-run-resolved', {
      requestId: request, outcome: 'approved',
    })
    await bench.settle()
    expect(bench.ctx.dynamicCordisRunner.activeRuns.getSnapshot().size).toBe(0)
    // Answering a settled request is a no-op, not an error.
    await bench.ctx.dynamicCordisRunner.approve(request, false)
    expect(bench.resolved).toEqual([])
  })

  it('exposes the refusal and the load observer on the face', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = 'rr-3' as ApprovalRequestId
    forward(bench.ctx, 'cordis/request-run', {
      requestId: request,
      agentId: AGENT,
      pluginId: PLUGIN,
      packageId: PACKAGE,
      mode: 'run',
      name: 'demo',
      purpose: 'p',
      requiresApproval: true,
    })
    await bench.settle()
    /** 中文说明：测试局部值 loads，由紧邻初始化决定。 */
    let loads = 0
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = bench.ctx.dynamicCordisRunner.subscribe(() => { loads++ })
    await bench.ctx.dynamicCordisRunner.decline(request)
    expect(bench.resolved).toEqual([{ requestId: request, resolution: { ok: false, reason: 'rejected' } }])
    expect(bench.ctx.dynamicCordisRunner.isLoaded(PLUGIN)).toBe(false)
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    expect(loads).toBeGreaterThan(0)
    unsubscribe()
  })

  it('unloads every package when its own fiber goes away', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot()
    await bench.ctx.dynamicCordisRunner.startUserRun(USER_RUN)
    /** 中文说明：测试局部值 runner，由紧邻初始化决定。 */
    const runner = bench.ctx.dynamicCordisRunner
    await bench.dispose()
    await bench.settle()
    expect(runner.getSnapshot()).toEqual([])
  })
})

describe('node half', () => {
  it('contributes nothing host-side', () => {
    NodeHalf.apply()
    expect(typeof NodeHalf.apply).toBe('function')
  })
})

describe('invariant companion', () => {
  it('reserves package ownership with an explained empty installer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(InvariantService, { enabled: true })
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin(Invariant)
    await fiber
    expect(Invariant.name).toBe('cordis-client-runner-invariant')
    // No relation to audit here: the owned one is browser-local runner state.
    // An event this plugin declares nothing about: the bridge must not route it here.
    expect(() => { (ctx.emit as (type: string) => void)('unrelated/event') }).not.toThrow()
    await fiber.dispose()
  })
})
