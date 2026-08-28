/**
 * ================================ 文件注释 ================================
 * 【文件职责】动态包在浏览器内的"按包生命周期"引擎：闭包求值 → 守卫门面包裹 →
 *             模块表座入 → loader 条目创建；卸载 = 移除条目 + 工厂失效 + 样式清理。
 *             同时维护本页"已加载集合"与渲染崩溃归属索引。
 * 【技术维度】复用客户端 loader 的全部机制（inject 激活门控、Fiber 效果清理、
 *             状态投影）；按运行 ID 收敛加载（重复加载幂等、换激活替换、收回后
 *             重载）；按插件串行排队防止慢加载交错；WeakMap 以组件身份归属崩溃。
 * 【产品维度】让动态插件的浏览器半部享受与静态插件一致的生命周期语义，同时页面
 *             刷新后按需重新加载；渲染崩溃可归因到作者并给出修复指引。
 * 【逻辑维度】类型与记账结构 → 引擎类：构造（接入崩溃监督）→ subscribe/isLoaded/
 *             getSnapshot → load/retract/dispose → mount（求值→守卫→模块表→loader
 *             →Fiber 等待→记账）→ guardedSurface/teardown → 底部纯函数。
 * 【关键边界】parked（服务暂缺）是成功而非失败；每个插件最多一个活动条目；
 *             同一组件对象不可能跨包（每包独立闭包）；错误字段不得编造堆栈。
 * 【新手阅读建议】先读文件头英文注释理解收敛/串行语义，再看 load→mount→teardown
 *             的主干流程，最后看 owners WeakMap 的归属论证。
 * ==========================================================================
 */

/**
 * Per-package browser lifecycle: evaluate the closure, wrap `apply` in the guard
 * facade, seat a ready-made factory in the module table, and create a loader
 * entry — so dynamic packages ride the exact machinery static plugins do
 * (activation gating on inject, fiber-effect cleanup, status projection). Unload
 * = loader entry removal (fiber disposal cascades slot entries and facade
 * effects) + factory invalidation + style removal.
 *
 * The engine answers its caller: `load` resolves with what this page ended up
 * with, which is what the run orchestration reports back to the host. Loads
 * converge by Plugin Run ID against live state, not history: loading the exact
 * activation this page already runs is a no-op that still answers, another run
 * replaces it, and the same Package after a retract loads afresh. Per-Plugin
 * serialization keeps a second request from interleaving with one in flight.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Loader } from '@deepseek-ai/cordis-plugin-loader'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId, DynamicCordisPackage,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientModuleSystem } from '@deepseek-ai/dsh-client-modules/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { DynamicCordisStyles, evaluateClientHalf, DYNAMIC_CLIENT_REDIRECTS } from './evaluator.ts'
import type { DynamicCordisEvaluatedPlugin } from './evaluator.ts'
import { dynamicCordisContext } from './guard.ts'
import type { DynamicCordisSlotLedgerRow } from './guard.ts'

/**
 * Snapshot source a surface can subscribe to (the render seam's observable
 * shape). Lives here because both this engine and the run orchestration publish
 * through it, and the orchestration already depends on this module.
 */
export interface CordisObservable<T> {
  /** Current value; the reference is stable between mutations. */
  getSnapshot(): T
  /**
   * Observe mutations.
   * @param fn - notified after each committed change.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void
}

/** Which stage of a load failed, as the page classified it. */
/*
 * 一次加载失败所处的阶段（页面视角的分类）：闭包求值 / 模块导入 / 插件激活。
 */
export type DynamicCordisLoadErrorCause = 'evaluate' | 'module-import' | 'activate'

/** Error fields retained by the page runner and Host transport. */
export interface CordisErrorDetails {
  /** Original error message. */
  message: string
  /** Original stack when the thrown value supplied one. */
  stack?: string
}

/** One package's browser half as the host handed it over. */
/*
 * Host 交给本页的一个浏览器半部：插件/包/运行 ID、所属会话、名称与源码。
 */
export interface DynamicCordisClientHalf {
  /** Stable Plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Immutable Package source version. */
  packageId: CordisDynamicPackageId
  /** Exact activation. */
  pluginRunId: CordisDynamicPluginRunId
  /** Session the run is carried out for; a later render failure is reported under it. */
  agentId: SessionId
  /** Label from the define call; also the plugin name. */
  name: string
  /** Browser-half source: an async function body returning a plugin. */
  code: string
}

/**
 * One render-time crash of a dynamic package's slot entry, as this page reports
 * it. Post-settle diagnosis only: the run it belongs to was answered long before
 * (a package that crashes while rendering loaded successfully), so this never
 * reaches a run resolution.
 */
/*
 * 本页上报的一次"渲染期崩溃"：仅作为结算后的诊断——所属运行早已应答（渲染时崩溃
 * 说明加载本身成功），因此它永远不会进入运行结算流程。
 */
export interface DynamicCordisRenderFailure {
  /** Slot key the crashed entry rendered under. */
  slot: string
  /** What the author has to read to fix it: the crash text, plus a redirect when it names a withheld global. */
  message: string
  /** Original render failure stack when available. */
  stack?: string
  /** Whether the crash retired the entry from its cell — the package's UI is gone, not merely broken. */
  abdicated: boolean
}

/**
 * What this page ended up with. A parked package is a success — the browser half
 * settled and waits on declared services this page has not got.
 */
/*
 * 本页最终得到的结果：parked（因声明的服务本页暂缺而挂起）也算成功——浏览器半部
 * 已就绪，只是在等这些服务。
 */
export type DynamicCordisLoadResult =
  | { ok: true; pluginRunId: CordisDynamicPluginRunId; waitingFor?: string[] }
  | ({ ok: false; cause: DynamicCordisLoadErrorCause; error?: unknown } & CordisErrorDetails)

/** The `window.__ModuleLoader__` registration sink (client-modules contract C6). */
interface ModuleLoaderSink {
  __ModuleLoader__?: {
    load(handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void
  }
}

/** One live package's bookkeeping. */
interface LivePackage {
  pkg: DynamicCordisPackage
  entryId: string
  styles: DynamicCordisStyles
  ledger: DynamicCordisSlotLedgerRow[]
  /** Services the browser half declared and this page has not got (parked, still a success). */
  waitingFor: string[]
}

/** Runner dependencies, resolved by the plugin entry at activation. */
/*
 * 运行引擎的依赖，由插件入口在激活时提供：根上下文、loader/模块表/槽位，
 * 以及 host.call 路由与两条失败上报通道。
 */
export interface DynamicCordisRunnerEnv {
  /** The client root context (service reads and the guard's fiber owner). */
  ctx: Context
  /** Client cordis Loader: dynamic packages become entries under it. */
  loader: Loader
  /** Module table, for factory invalidation before every (re-)registration. */
  modules: ClientModuleSystem
  /** Slot registry, for the entry-crash supervision seam. */
  slots: SlotRegistry
  /** Route one `host.call` to the package's host half through the Remote namespace. */
  invoke(
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    method: string,
    args: unknown,
  ): Promise<unknown>
  /**
   * Send one render-time crash back to the session that authored the package.
   * Fire-and-forget by contract: the crash already happened, and a failed report
   * must not become a second failure.
   * @param agentId - session the crashed package was run for.
   * @param id - the crashed package.
   * @param failure - slot, teaching text, and whether the entry was retired.
   */
  // 按契约 fire-and-forget：崩溃已经发生，失败的上报不得变成第二次失败
  reportRenderFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): void
  /** Send one post-activation Client guard rejection to the owning Agent. */
  reportGuardFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: CordisErrorDetails,
  ): void
}

/** Module-table id of one package (also its loader entry name and fiber name). */
/*
 * 一个包的模块表 ID：同时用作 loader 条目名与 Fiber 名（dyn/前缀隔离命名空间）。
 */
function moduleIdOf(id: CordisDynamicPluginId): string {
  return `dyn/${id}`
}

/** One live package's contribution summary in this page. */
/*
 * 本页"一个存活包"的贡献摘要：身份、名称、注册的槽位与活动样式标签数。
 */
export interface DynamicCordisLivePackage {
  /** Stable Plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Immutable Package source version. */
  packageId: CordisDynamicPackageId
  /** Exact activation loaded in this page. */
  pluginRunId: CordisDynamicPluginRunId
  /** Label from the define call. */
  name: string
  /** Slot names this package registered into here. */
  slots: string[]
  /** Live injected-style tag count. */
  styleCount: number
}

/** The browser-side load engine for dynamic packages. */
/*
 * 动态包的浏览器侧加载引擎：把闭包求值结果以守卫包裹后座入模块表、创建 loader 条目，
 * 使动态包走与静态插件完全相同的机制（inject 激活门控、Fiber 效果清理、状态投影）；
 * 卸载 = 移除 loader 条目 + 工厂失效 + 样式清理。
 */
export class DynamicCordisPackageRunner {
  // 存活包表：插件 ID -> 记账记录
  private readonly live = new Map<CordisDynamicPluginId, LivePackage>()
  /** Serializes load/unload per package id (a second request can outrun a slow load). */
  // 每插件串行队列：慢加载期间第二个请求不会交错
  private readonly queues = new Map<CordisDynamicPluginId, Promise<unknown>>()
  private readonly changeListeners = new Set<() => void>()
  /** Page-local shadowing rank. A later registration receives a lower priority. */
  // 页面本地遮蔽排名：越晚注册的条目优先级越低（后注册者胜出渲染）
  private nextPriority = 0
  /**
   * Which package seated which component, and for whom. Component identity is the
   * only attribution key that holds:
   * - the registry stores the component verbatim, so a crashed entry carries its
   *   own way back — no parallel entry ledger to keep in step;
   * - `entry.registrant` is `options.registrant ?? fiber.name` and the facade does
   *   not strip a package-supplied one, so a package could name itself something
   *   else — attributing by it would let a package impersonate another;
   * - the assigned shadowing priority is unique but absent on chain entries (their
   *   election is deliberately left alone), so it would miss chain crashes;
   * - a package torn down between the crash and the report is still attributable,
   *   because this index does not depend on the live record.
   *
   * Two packages cannot collide here: each browser half is evaluated in its own
   * closure, so no component object reaches two of them. A collision is only
   * possible inside ONE package (the same component seated twice), where both
   * entries map to the same id and the value is identical.
   */
  private readonly owners = new WeakMap<object, {
    pluginId: CordisDynamicPluginId
    pluginRunId: CordisDynamicPluginRunId
    agentId: SessionId
  }>()
  /** This page's last render crash per package: what a run surface shows on the row. */
  // 本页每个包最近一次渲染崩溃（运行表面在行上显示的内容）
  private readonly failures = new Map<CordisDynamicPluginId, DynamicCordisRenderFailure>()
  private readonly unwatch: () => void
  private snapshotCache: readonly DynamicCordisLivePackage[] | undefined
  private failureCache: ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure> | undefined

  /** @param env - loader/module/slot wiring plus the two host verbs this engine uses. */
  constructor(private readonly env: DynamicCordisRunnerEnv) {
    // The supervision seam fires for EVERY entry crash on the page, factory UI
    // included; only the ones this runner seated are ours to report.
    this.unwatch = env.slots.onEntryError((slot, entry, error, info) => {
      const component: unknown = (entry as { component?: unknown }).component
      const owner = indexable(component) ? this.owners.get(component) : undefined
      if (owner === undefined) return
      const details = errorDetails(error)
      const failure: DynamicCordisRenderFailure = {
        slot,
        message: renderFailureMessage(slot, details.message),
        ...details.stack === undefined ? {} : { stack: details.stack },
        abdicated: info.abdicated,
      }
      // One observation, two outlets with different owners and lifetimes: the host
      // keeps the last crash ACROSS pages for the model, this map is what THIS page
      // currently shows. Neither is derived from the other.
      env.reportRenderFailure(owner.agentId, owner.pluginId, owner.pluginRunId, failure)
      this.failures.set(owner.pluginId, failure)
      this.notify()
    })
  }

  /**
   * Observe live-set changes (the run-state surface's re-render seam).
   * @param fn - notified after every converged load or unload.
   * @returns unsubscribe.
   */
  /*
   * 订阅"本页已加载集合"的变化（运行状态表面的重渲染接缝）。
   * @param fn 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  subscribe(fn: () => void): () => void {
    this.changeListeners.add(fn)
    return () => { this.changeListeners.delete(fn) }
  }

  /**
   * This page's last render crash per package, on the same notification channel as
   * the live set — a surface that already subscribed learns about a crash without
   * a second mechanism to wire.
   */
  readonly renderFailures: CordisObservable<ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure>> = {
    getSnapshot: () => this.failureCache ??= new Map(this.failures),
    subscribe: fn => this.subscribe(fn),
  }

  /**
   * What this page currently has loaded (stable reference between mutations, so
   * it can back a snapshot selector).
   * @returns one row per live package.
   */
  /*
   * 本页当前已加载的包（变更之间引用稳定，可支撑快照选择器）。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  getSnapshot(): readonly DynamicCordisLivePackage[] {
    return this.snapshotCache ??= [...this.live.values()].map(({ pkg, ledger, styles }) => ({
      pluginId: pkg.pluginId,
      packageId: pkg.packageId,
      pluginRunId: pkg.pluginRunId,
      name: pkg.name,
      slots: [...new Set(ledger.map(row => row.slot))],
      styleCount: styles.count,
    }))
  }

  /**
   * Whether this page has the browser half loaded — page-local truth, never the
   * host's "it is running".
   * @param pluginId - stable Plugin identity.
   * @returns true while one activation of the Plugin is live here.
   */
  /*
   * 本页是否已加载该插件的浏览器半部：页面本地事实，绝不等于 Host 的"正在运行"。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  isLoaded(pluginId: CordisDynamicPluginId): boolean {
    return this.live.has(pluginId)
  }

  /**
   * Load one browser half into this page and answer what happened.
   * @param half - source for one exact Host activation.
   * @returns the outcome the run orchestration reports to the host.
   */
  /*
   * 把一个浏览器半部加载进本页并回报结果：已运行同一激活则幂等应答；换激活则先
   * 卸载旧的再挂载新的；同一插件串行排队。
   * @param half 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
   */
  load(half: DynamicCordisClientHalf): Promise<DynamicCordisLoadResult> {
    return this.enqueue(half.pluginId, async () => {
      const current = this.live.get(half.pluginId)
      if (current !== undefined) {
        // Already running this activation here: nothing to load, but the caller
        // still needs an answer (a replayed run must not look unacknowledged).
        if (current.pkg.pluginRunId === half.pluginRunId) return settled(current)
        await this.teardown(current.pkg.pluginId, current.entryId, current.styles)
      }
      const result = await this.mount(half)
      this.notify()
      return result
    })
  }

  /**
   * Unload one package (`cordis/dynamic-retract`: a stop, or an undefine
   * that stops first).
   * @param pluginId - stable Plugin identity.
   * @param pluginRunId - exact activation being retracted; a newer run survives.
   */
  /*
   * 卸载一个包（cordis/dynamic-retract：停止，或先停后删的 undefine）；
   * 仅当运行 ID 仍匹配时才卸载——更新的运行不受影响。
   * @param pluginId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   * @param pluginRunId 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
   */
  retract(pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId): void {
    void this.enqueue(pluginId, async () => {
      const current = this.live.get(pluginId)
      if (current === undefined || current.pkg.pluginRunId !== pluginRunId) return
      await this.teardown(pluginId, current.entryId, current.styles)
      this.notify()
    })
  }

  /** Unload everything (plugin disposal path). */
  /*
   * 全部卸载（插件回收路径）。
   */
  async dispose(): Promise<void> {
    this.unwatch()
    for (const current of [...this.live.values()]) {
      await this.teardown(current.pkg.pluginId, current.entryId, current.styles)
    }
    this.notify()
  }

  private notify(): void {
    this.snapshotCache = undefined
    this.failureCache = undefined
    for (const fn of [...this.changeListeners]) fn()
  }

  /** Queue one package operation behind that package's previous ones. */
  /*
   * 把一次包操作排到该包前一个操作之后；队列尾吞掉失败，避免一次拒绝卡死后续操作。
   */
  private enqueue<T>(id: CordisDynamicPluginId, op: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.then(op)
    // The queue tail must survive this operation's failure, or one rejection
    // would wedge every later operation on the same package.
    this.queues.set(id, next.then(() => {}, () => {}))
    return next
  }

  private async mount(half: DynamicCordisClientHalf): Promise<DynamicCordisLoadResult> {
    const styles = new DynamicCordisStyles(half.pluginId)
    const ledger: DynamicCordisSlotLedgerRow[] = []
    let plugin: DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)
    try {
      plugin = await evaluateClientHalf(half.pluginId, half.code, {
        invoke: (method, args) => this.env.invoke(half.pluginId, half.pluginRunId, method, args),
        noteError: (message) => {
          // A loaded package's own console.error: a page-local diagnostic with
          // no wire carrier (the run round trip settled long before).
          console.error(`[cordis-client-runner] ${half.pluginId} logged an error:`, message)
        },
      }, styles)
    } catch (error) {
      styles.dispose()
      return { ok: false, cause: 'evaluate', ...errorDetails(error), error }
    }

    const pkg: DynamicCordisPackage = {
      pluginId: half.pluginId,
      packageId: half.packageId,
      pluginRunId: half.pluginRunId,
      name: half.name,
    }
    const surface = this.guardedSurface(pkg, half.agentId, plugin, ledger)
    const moduleId = moduleIdOf(half.pluginId)
    // Invalidate-then-register keeps re-loading legal: the module table throws
    // loudly on a duplicate factory registration.
    this.env.modules.invalidate(moduleId)
    const sink = (globalThis as ModuleLoaderSink).__ModuleLoader__
    if (sink === undefined) {
      throw new Error('cordis-client-runner: window.__ModuleLoader__ is missing (booted outside the web shell?)')
    }
    sink.load({ id: moduleId, factory: () => surface })

    const entryId = await this.env.loader.create({ name: moduleId })
    const fiber = this.env.loader.resolve(entryId).fiber
    if (fiber === undefined) {
      await this.teardown(half.pluginId, entryId, styles)
      return { ok: false, cause: 'module-import', message: 'module import failed (see the browser console)' }
    }
    try {
      await fiber.await()
    } catch (error) {
      await this.teardown(half.pluginId, entryId, styles)
      return { ok: false, cause: 'activate', ...errorDetails(error), error }
    }
    // Settled but not active = legal pending on an unsatisfied declaration. The
    // record is seated only now, so an error mirrored during `apply` cannot
    // claim the package is already live.
    const waitingFor = Object.keys(fiber.inject).filter(name => this.env.ctx.get(name) === undefined)
    const record: LivePackage = { pkg, entryId, styles, ledger, waitingFor }
    this.live.set(half.pluginId, record)
    // A fresh load answers for itself: whatever this page last showed as crashed
    // is no longer true of what is mounted now.
    this.failures.delete(half.pluginId)
    return settled(record)
  }

  /**
   * Wrap the evaluated plugin so `apply` sees the guard facade; the surface
   * doubles as the module-table module. The plugin's OWN `inject` survives (the
   * object form's declaration is the facade's service gate, mirroring the host
   * sandbox reading `ctx.fiber.inject`); the function form has no declaration
   * site and therefore reaches no service.
   */
  /*
   * 把求值出的插件包上守卫门面：apply 收到的是门面 ctx；插件自带的 inject 保留
   * （对象形式的声明即门面的服务闸门，镜像 Host 沙箱读 ctx.fiber.inject；函数
   * 形式没有声明位，因此访问不到任何服务）。
   */
  private guardedSurface(
    pkg: DynamicCordisPackage,
    agentId: SessionId,
    plugin: DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown),
    ledger: DynamicCordisSlotLedgerRow[],
  ): DynamicCordisEvaluatedPlugin {
    const claim = (component: unknown): void => {
      if (indexable(component)) {
        this.owners.set(component, { pluginId: pkg.pluginId, pluginRunId: pkg.pluginRunId, agentId })
      }
    }
    const guarded = (ctx: unknown): Context => dynamicCordisContext(ctx as Context, {
      pkg,
      ledger,
      claim,
      allocatePriority: () => --this.nextPriority,
      reportFailure: (error) => {
        this.env.reportGuardFailure(agentId, pkg.pluginId, pkg.pluginRunId, errorDetails(error))
      },
    })
    if (typeof plugin === 'function') {
      return { name: moduleIdOf(pkg.pluginId), apply: (ctx: unknown) => plugin(guarded(ctx)) }
    }
    return {
      ...plugin,
      name: moduleIdOf(pkg.pluginId),
      apply: (ctx: unknown, config?: unknown) => plugin.apply(guarded(ctx), config),
    }
  }

  /**
   * Unload one package's contributions. Takes the pieces rather than the record
   * because a load can fail before any record is seated.
   */
  /*
   * 卸载一个包的贡献：按部件而非记录接收，因为加载可能在记账前失败。
   */
  private async teardown(
    id: CordisDynamicPluginId,
    entryId: string,
    styles: DynamicCordisStyles,
  ): Promise<void> {
    this.live.delete(id)
    // Nothing of this package renders here any more, so a crash row would outlive
    // the thing it described.
    this.failures.delete(id)
    // Entry removal disposes the fiber (slot entries and facade effects
    // cascade); the factory invalidation makes a later re-load legal.
    await this.env.loader.remove(entryId)
    this.env.modules.invalidate(moduleIdOf(id))
    styles.dispose()
  }
}

/**
 * The success answer for a package that is live here, parked or active.
 */
/*
 * 一个"已在本页存活"的包的成功应答：运行 ID + 等待中的服务（有则附上）。
 */
function settled(record: { pkg: DynamicCordisPackage; waitingFor: string[] }): DynamicCordisLoadResult {
  return {
    ok: true,
    pluginRunId: record.pkg.pluginRunId,
    ...record.waitingFor.length > 0 ? { waitingFor: record.waitingFor } : {},
  }
}

/**
 * Whether a component can key the ownership index. Identity is the key, so only
 * objects and functions qualify — a package may register anything, and what it
 * registered is what a crash report carries back.
 * @param component - whatever a package passed as its component.
 * @returns true when the value can be indexed by identity.
 */
/*
 * 组件能否作为所有权索引的键：身份即键，只有对象与函数够格（包可能注册任意值，
 * 崩溃报告带回来的正是它注册的那个值）。
 */
function indexable(component: unknown): component is object {
  return typeof component === 'object' && component !== null || typeof component === 'function'
}

/**
 * Preserve error fields for a load result without fabricating a stack.
 * @param error - original thrown value.
 * @returns its message and original string stack, when present.
 */
/*
 * 保留错误字段到加载结果：不编造堆栈，只有原值确实携带时才带。
 * @param error 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function errorDetails(error: unknown): CordisErrorDetails {
  if (typeof error !== 'object' || error === null) return { message: String(error) }
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : Object.prototype.toString.call(error)
  const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
  return { message, ...stack === undefined ? {} : { stack } }
}
/* jscpd:ignore-end */

/**
 * What the authoring session reads about one render crash. The slot says where it
 * happened, the crash message says what broke, and a withheld global named in that
 * text pulls in its redirect — a package that reached `window.setInterval` around
 * the closure trap crashes with the engine's bare message, which teaches nothing.
 */
/*
 * 组装渲染崩溃的展示文案：槽位 + 崩溃消息；若消息点名了被扣留的全局符号
 * （如绕过关闭包陷阱使用 window.setInterval），追加对应的重定向教学。
 */
function renderFailureMessage(slot: string, message: string): string {
  const redirect = Object.entries(DYNAMIC_CLIENT_REDIRECTS)
    .find(([name, text]) => message.includes(name) && !message.includes(text))?.[1]
  return `your entry in slot "${slot}" crashed while React rendered it: ${message}`
    + (redirect === undefined ? '' : `\n${redirect}`)
}
