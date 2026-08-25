/**
 * Run-orchestration account: the order the halves run in (and what a host-only
 * definition skips), what each failure answers the host, and what a surface can
 * read while it happens. The host seam and the load engine are stood in, because
 * what is under test is the round trip itself — the engine has its own account in
 * runner.spec.
 */
/**
 * 文件职责：验证Cordis 客户端运行器的 orchestrator.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 客户端运行器在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */

import { describe, expect, it, vi } from 'vitest'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  DynamicCordisClientSource, DynamicCordisHostHalfResult, DynamicCordisResolveAck,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { CordisRunOrchestrator } from '../src/client/orchestrator.ts'
import type { CordisUserRunRequest } from '../src/client/orchestrator.ts'
import type { DynamicCordisLoadResult, DynamicCordisPackageRunner } from '../src/client/runtime.ts'

/** 中文说明：测试局部值 PLUGIN，由紧邻初始化决定。 */
const PLUGIN = 'dyn-1' as CordisDynamicPluginId
/** 中文说明：测试局部值 PACKAGE，由紧邻初始化决定。 */
const PACKAGE = 'pkg-1' as CordisDynamicPackageId
/** 中文说明：测试局部值 RUN，由紧邻初始化决定。 */
const RUN = 'run-1' as CordisDynamicPluginRunId
/** 中文说明：测试局部值 AGENT，由紧邻初始化决定。 */
const AGENT = 's-1' as SessionId
/** 中文说明：测试局部值 REQ，由紧邻初始化决定。 */
const REQ = 'rr-1' as ApprovalRequestId
/** 中文说明：测试局部值 HOST_OK，由紧邻初始化决定。 */
const HOST_OK: Extract<DynamicCordisHostHalfResult, { ok: true }> = {
  ok: true,
  pluginId: PLUGIN,
  packageId: PACKAGE,
  pluginRunId: RUN,
  waitingFor: [],
  startedHere: true,
}
/** A user's own run of a two-half definition: the host half, then this page's half. */
/** 中文说明：测试局部值 DUAL，由紧邻初始化决定。 */
const DUAL: CordisUserRunRequest = {
  agentId: AGENT, pluginId: PLUGIN, packageId: PACKAGE, mode: 'run', hasClientHalf: true,
}
/** A user's own run of a host-only definition: nothing for this page to load. */
/** 中文说明：测试局部值 HOST_ONLY，由紧邻初始化决定。 */
const HOST_ONLY: CordisUserRunRequest = { ...DUAL, hasClientHalf: false }

/** 中文说明：类型或类 Bench 约束扩展或反馈数据职责。 */
interface Bench {
  orchestrator: CordisRunOrchestrator
  host: {
    runHostHalf: ReturnType<typeof vi.fn>
    getClientCode: ReturnType<typeof vi.fn>
    resolveRequestRun: ReturnType<typeof vi.fn>
    settleUserRun: ReturnType<typeof vi.fn>
  }
  load: ReturnType<typeof vi.fn>
  /** Resolutions the host received, in order. */
  answers: unknown[]
}

/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function boot(overrides: {
  hostHalf?: () => Promise<DynamicCordisHostHalfResult>
  clientCode?: () => Promise<DynamicCordisClientSource>
  loaded?: () => Promise<DynamicCordisLoadResult>
  resolve?: () => Promise<DynamicCordisResolveAck>
} = {}): Bench {
  /** 中文说明：测试局部值 answers，由紧邻初始化决定。 */
  const answers: unknown[] = []
  /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
  const host = {
    runHostHalf: vi.fn(overrides.hostHalf ?? (() => Promise.resolve(HOST_OK))),
    getClientCode: vi.fn(overrides.clientCode ?? (() => Promise.resolve({
      code: 'return {}', name: 'demo', pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN,
    }))),
    resolveRequestRun: vi.fn((_requestId: unknown, resolution: unknown) => {
      answers.push(resolution)
      return (overrides.resolve ?? (() => Promise.resolve({ accepted: true })))()
    }),
    settleUserRun: vi.fn((_agentId: SessionId, _pluginId: CordisDynamicPluginId, resolution: unknown) =>
      Promise.resolve({
        ok: true as const,
        status: 'running' as const,
        pluginId: PLUGIN,
        packageId: PACKAGE,
        pluginRunId: (resolution as { pluginRunId: CordisDynamicPluginRunId }).pluginRunId,
        waitingFor: [],
        mode: 'run' as const,
      })),
  }
  /** 中文说明：测试局部值 load，由紧邻初始化决定。 */
  const load = vi.fn(overrides.loaded ?? (() => Promise.resolve({ ok: true as const, pluginRunId: RUN })))
  /** 中文说明：测试局部值 orchestrator，由紧邻初始化决定。 */
  const orchestrator = new CordisRunOrchestrator({
    runner: { load } as unknown as DynamicCordisPackageRunner,
    host,
  })
  return { orchestrator, host, load, answers }
}

/** Register one request the way the `cordis/request-run` event does. */
/** 中文说明：函数 ask 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function ask(bench: Bench, requestId: ApprovalRequestId = REQ): void {
  bench.orchestrator.open({
    requestId,
    agentId: AGENT,
    pluginId: PLUGIN,
    packageId: PACKAGE,
    mode: 'run',
    name: 'demo',
    purpose: 'draw a clock',
    requiresApproval: true,
  })
}

describe('the waiting affordance', () => {
  it('publishes failures on their own observable', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => Promise.resolve({ ok: false, message: 'nope' }) })
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    let notified = 0
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = bench.orchestrator.lastRunError.subscribe(() => { notified++ })
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = bench.orchestrator.lastRunError.getSnapshot()
    expect(bench.orchestrator.lastRunError.getSnapshot()).toBe(empty)
    await bench.orchestrator.startUserRun(DUAL)
    expect(notified).toBeGreaterThan(0)
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN)?.reason).toBe('host-half-failed')
    unsubscribe()
  })

  it('publishes one activity per definition, carrying the whole ask', () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    ask(bench)
    // Everything a surface needs to show and group the row without a registry
    // read: the ask names the session, the plugin, and the model's reason.
    expect(bench.orchestrator.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'awaiting-approval',
      requestId: REQ,
      agentId: AGENT,
      packageId: PACKAGE,
      mode: 'run',
      name: 'demo',
      purpose: 'draw a clock',
    })
  })

  it('keeps naming the session once the decision is made', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench.orchestrator.startUserRun(DUAL)
    // A run must not fall out of its session group by advancing past the decision.
    expect(bench.orchestrator.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'orchestrating',
      agentId: AGENT,
      packageId: PACKAGE,
      mode: 'run',
    })
    release()
    await running
  })

  it('keeps a stable snapshot reference between mutations, and notifies on each', () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    let notified = 0
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = bench.orchestrator.activeRuns.subscribe(() => { notified++ })
    /** 中文说明：测试局部值 empty，由紧邻初始化决定。 */
    const empty = bench.orchestrator.activeRuns.getSnapshot()
    expect(bench.orchestrator.activeRuns.getSnapshot()).toBe(empty)
    ask(bench)
    expect(notified).toBe(1)
    expect(bench.orchestrator.activeRuns.getSnapshot()).not.toBe(empty)
    unsubscribe()
    bench.orchestrator.close(REQ)
    expect(notified).toBe(1)
  })

  it('drops only the waiting affordance when the request settles elsewhere', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    ask(bench)
    bench.orchestrator.close(REQ)
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
    // Answering a settled request is a no-op, not an error.
    await bench.orchestrator.approve(REQ, false)
    await bench.orchestrator.decline(REQ)
    expect(bench.host.runHostHalf).not.toHaveBeenCalled()
    expect(bench.answers).toEqual([])
  })

  it('leaves an orchestration alone when its own request settles elsewhere', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    ask(bench)
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench.orchestrator.approve(REQ, false)
    // The host announced the request settled (this page answered it) — the work
    // this page is doing owns its entry until it finishes.
    bench.orchestrator.close(REQ)
    expect(bench.orchestrator.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'orchestrating', agentId: AGENT, packageId: PACKAGE, mode: 'run',
    })
    release()
    await running
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('refuses to decline a request whose definition is already orchestrating', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench.orchestrator.startUserRun(DUAL)
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late = 'rr-late-decline' as ApprovalRequestId
    ask(bench, late)
    await bench.orchestrator.decline(late)
    expect(bench.answers).toEqual([]) // the decision was made; a refusal now would contradict it
    release()
    await running
  })

  it('ignores a close for a request it never saw', () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    bench.orchestrator.close('rr-unknown' as ApprovalRequestId)
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('closes a request whose activity is already gone', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = 'rr-second' as ApprovalRequestId
    ask(bench)
    ask(bench, second) // same definition asked twice: the first keeps the affordance
    await bench.orchestrator.approve(REQ, false) // settles and clears the activity
    bench.orchestrator.close(second)
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('does not downgrade an orchestration to a waiting decision', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    /** 中文说明：测试局部值 started，由紧邻初始化决定。 */
    const started = bench.orchestrator.startUserRun(DUAL)
    ask(bench, 'rr-late' as ApprovalRequestId)
    // A request arriving mid-orchestration must not offer a decision already made.
    expect(bench.orchestrator.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'orchestrating', agentId: AGENT, packageId: PACKAGE, mode: 'run',
    })
    release()
    await started
  })
})

describe('approve', () => {
  it('runs the host half first, then loads the browser half, then answers', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.host.runHostHalf).toHaveBeenCalledWith(AGENT, PLUGIN, PACKAGE, 'run', REQ, false)
    expect(bench.host.getClientCode).toHaveBeenCalledWith(AGENT, PLUGIN, RUN)
    // The load carries the session too: a crash while React renders it is
    // reported back to whoever the run was carried out for.
    expect(bench.load).toHaveBeenCalledWith({
      pluginId: PLUGIN, packageId: PACKAGE, pluginRunId: RUN, agentId: AGENT, name: 'demo', code: 'return {}',
    })
    expect(bench.answers).toEqual([{ ok: true, pluginRunId: RUN }])
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('carries the services a parked browser half waits for', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ loaded: () => Promise.resolve({ ok: true, pluginRunId: RUN, waitingFor: ['absent'] }) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.answers).toEqual([{ ok: true, pluginRunId: RUN, waitingFor: ['absent'] }])
  })

  it('short-circuits when the host half fails: nothing is fetched or loaded', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => Promise.resolve({ ok: false, message: 'vm exploded' }) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.host.getClientCode).not.toHaveBeenCalled()
    expect(bench.load).not.toHaveBeenCalled()
    expect(bench.answers).toEqual([{ ok: false, reason: 'host-half-failed', message: 'vm exploded' }])
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({ packageId: PACKAGE, reason: 'host-half-failed', ok: false, message: 'vm exploded' })
  })

  it('folds a transport rejection of the host verb into its own failure shape', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => Promise.reject(new Error('socket closed')) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.answers).toEqual([{
      ok: false,
      reason: 'host-half-failed',
      message: 'socket closed',
      stack: expect.any(String),
    }])
  })

  it('reports a source fetch that failed as the browser half failing', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ clientCode: () => Promise.reject(new Error('definition vanished')) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.load).not.toHaveBeenCalled()
    expect(bench.answers).toEqual([{
      ok: false, reason: 'client-half-failed', pluginRunId: RUN, startedHere: true,
      message: 'definition vanished', stack: expect.any(String),
    }])
  })

  it('carries the failing load stage into the answer', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ loaded: () => Promise.resolve({ ok: false, cause: 'activate', message: 'apply threw' }) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.answers).toEqual([{
      ok: false, reason: 'client-half-failed', pluginRunId: RUN, startedHere: true, message: 'activate: apply threw',
    }])
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({ packageId: PACKAGE, reason: 'client-half-failed', message: 'activate: apply threw' })
  })

  it('treats a load that rejects outright as a browser-half failure', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ loaded: () => Promise.reject(new Error('module table missing')) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.answers).toEqual([{
      ok: false, reason: 'client-half-failed', pluginRunId: RUN, startedHere: true,
      message: 'evaluate: module table missing', stack: expect.any(String),
    }])
  })

  it('joins a second approve into the orchestration already in flight', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    ask(bench)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = bench.orchestrator.approve(REQ, false)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = bench.orchestrator.approve(REQ, false)
    release()
    await Promise.all([first, second])
    expect(bench.host.runHostHalf).toHaveBeenCalledTimes(1)
    expect(bench.answers).toHaveLength(1)
  })

  it('logs an answer the host refused, and settles anyway', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ resolve: () => Promise.reject(new Error('stream gone')) })
    /** 中文说明：测试局部值 logged，由紧邻初始化决定。 */
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    /** 中文说明：测试局部值 complaints，由紧邻初始化决定。 */
    const complaints = logged.mock.calls.filter(call => String(call[0]).includes('answering run request'))
    logged.mockRestore()
    expect(complaints).toHaveLength(1)
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('clears a previous failure when the same definition is tried again', async () => {
    /** 中文说明：测试局部值 outcomes，由紧邻初始化决定。 */
    const outcomes: DynamicCordisLoadResult[] = [
      { ok: false, cause: 'activate', message: 'first try' },
      { ok: true, pluginRunId: RUN },
    ]
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ loaded: () => Promise.resolve(outcomes.shift() ?? { ok: true, pluginRunId: RUN }) })
    ask(bench)
    await bench.orchestrator.approve(REQ, false)
    expect(bench.orchestrator.lastRunError.getSnapshot().size).toBe(1)
    await bench.orchestrator.startUserRun(DUAL)
    expect(bench.orchestrator.lastRunError.getSnapshot().size).toBe(0)
  })
})

describe('decline', () => {
  it('answers rejected without touching either half', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    ask(bench)
    await bench.orchestrator.decline(REQ)
    expect(bench.host.runHostHalf).not.toHaveBeenCalled()
    expect(bench.load).not.toHaveBeenCalled()
    expect(bench.answers).toEqual([{ ok: false, reason: 'rejected' }])
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
    // A refusal is not this page failing.
    expect(bench.orchestrator.lastRunError.getSnapshot().size).toBe(0)
  })

  it('is a no-op once the decision was already made', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    ask(bench)
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench.orchestrator.approve(REQ, false)
    await bench.orchestrator.decline(REQ)
    expect(bench.answers).toEqual([])
    release()
    await running
    expect(bench.answers).toEqual([{ ok: true, pluginRunId: RUN }])
  })

  it('ignores an unknown request', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    await bench.orchestrator.decline('rr-unknown' as ApprovalRequestId)
    expect(bench.answers).toEqual([])
  })
})

describe('startUserRun', () => {
  it('orchestrates both halves with nothing to answer', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    await bench.orchestrator.startUserRun(DUAL)
    expect(bench.host.runHostHalf).toHaveBeenCalledWith(AGENT, PLUGIN, PACKAGE, 'run', null, false)
    expect(bench.load).toHaveBeenCalledTimes(1)
    // No request was asked, so there is no blocked tool call to settle.
    expect(bench.host.resolveRequestRun).not.toHaveBeenCalled()
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('records its own failure for the surface to show', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => Promise.resolve({ ok: false, message: 'no definition' }) })
    await bench.orchestrator.startUserRun(DUAL)
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({ packageId: PACKAGE, reason: 'host-half-failed', ok: false, message: 'no definition' })
    expect(bench.host.resolveRequestRun).not.toHaveBeenCalled()
  })

  it('records a source fetch failure with nothing to answer', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ clientCode: () => Promise.reject(new Error('gone')) })
    await bench.orchestrator.startUserRun(DUAL)
    expect(bench.host.resolveRequestRun).not.toHaveBeenCalled()
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({
        packageId: PACKAGE,
        reason: 'client-half-failed',
        message: 'gone',
        stack: expect.any(String),
      })
  })

  it('records a load failure, stringifying a non-Error rejection', async () => {

    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the case under test
    const bench = boot({ loaded: () => Promise.reject('plain rejection') })
    await bench.orchestrator.startUserRun(DUAL)
    expect(bench.host.resolveRequestRun).not.toHaveBeenCalled()
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({ packageId: PACKAGE, reason: 'client-half-failed', message: 'evaluate: plain rejection' })
  })

  it('is idempotent per definition while one attempt is in flight', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({ hostHalf: () => new Promise((resolve) => { release = (): void => { resolve(HOST_OK) } }) })
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = bench.orchestrator.startUserRun(DUAL)
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = bench.orchestrator.startUserRun(DUAL)
    release()
    await Promise.all([first, second])
    expect(bench.host.runHostHalf).toHaveBeenCalledTimes(1)
  })

  it('brings a host-only definition up without fetching or loading anything', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot()
    await bench.orchestrator.startUserRun(HOST_ONLY)
    expect(bench.host.runHostHalf).toHaveBeenCalledWith(AGENT, PLUGIN, PACKAGE, 'run', null, false)
    // There is no second half: asking for source that does not exist would be a
    // mistake, and folding its error into `client-half-failed` would report a run
    // that succeeded as a failure of a half the definition never had.
    expect(bench.host.getClientCode).not.toHaveBeenCalled()
    expect(bench.load).not.toHaveBeenCalled()
    expect(bench.orchestrator.lastRunError.getSnapshot().size).toBe(0)
    expect(bench.orchestrator.activeRuns.getSnapshot().size).toBe(0)
  })

  it('publishes a host-only run while it is in flight, and its own failure', async () => {
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    let release = (): void => {}
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = boot({
      hostHalf: () => new Promise((resolve) => {
        release = (): void => { resolve({ ok: false, message: 'vm exploded' }) }
      }),
    })
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = bench.orchestrator.startUserRun(HOST_ONLY)
    // The control a surface disables comes from this entry, and a host half can
    // take real time to evaluate — so a host-only run is in flight like any other.
    expect(bench.orchestrator.activeRuns.getSnapshot().get(PLUGIN)).toEqual({
      phase: 'orchestrating', agentId: AGENT, packageId: PACKAGE, mode: 'run',
    })
    release()
    await running
    expect(bench.orchestrator.lastRunError.getSnapshot().get(PLUGIN))
      .toEqual({ packageId: PACKAGE, reason: 'host-half-failed', ok: false, message: 'vm exploded' })
  })
})
