/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-client-hmr 包的运行时不变量（invariant）伴侣插件：
 *   审计"每个 bundle stat 监视器都必须随其 fiber 死亡"这一 owned 关系。
 * 【技术维度】Cordis 伴侣插件：以 StatWatcher 计数为基线差量，在
 *   internal/plugin 事件上对比 fiber 创建与销毁后的监视器数量。
 * 【产品维度】存活轮询器会让已拆除的开发链持续重哈希 bundle——本检查把
 *   这种资源泄漏在拆解时立刻暴露。
 * 【逻辑维度】install 定义审计（记录基线、等 fiber.await() 后复查计数）；
 *   apply 向 invariants 服务注册。
 * 【关键边界】只审计名为 client-hmr 的 fiber；SSE 连接与监听器拆除在
 *   同一 ctx.effect 销毁器中，故监视器计数是可观察的代理。
 * 【新手阅读建议】对照 packages/runtime-diagnostics/invariants 的 fail 语义理解。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-hmr`.
 * @module @deepseek-ai/dsh-client-hmr/invariant
 */
/*
 * 本包自有的不变量伴侣插件：审计 bundle stat 监视器随 fiber 死亡。
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-hmr' // 注册到 invariants 服务时使用的包名标识

/** Cordis companion plugin name. */
/* Cordis 伴侣插件的插件名。 */
export const name = 'client-hmr-invariant'
/** Service required before the companion can reserve package ownership. */
/* 注册伴侣插件前必须先存在的服务。 */
export const inject = ['invariants']

/** Live fs.watchFile pollers (this package is the composition's only stat-poll user). */
/* 活跃的 fs.watchFile 轮询器（本包是组合中唯一的 stat 轮询用户）。 */
function statWatchers(): number {
  return process.getActiveResourcesInfo().filter(kind => kind === 'StatWatcher').length
}

/**
 * Owned relation: every bundle stat watcher the node half starts must die
 * with its fiber — a surviving poller would keep re-hashing bundles for a
 * torn-down dev chain forever. Checked as a baseline delta: the StatWatcher
 * count observed at fiber creation must be restored once disposal has drained
 * the fiber's effects (`internal/plugin` fires at dispose start; the microtask
 * hop lets the disposer queue its unload before `fiber.await()` joins it).
 * SSE-connection and listener teardown live inside the same ctx.effect
 * disposers, so the watcher count is the relation's observable proxy.
 */
/*
 * owned 关系：节点半边启动的每个 bundle stat 监视器都必须随其 fiber 死亡
 * ——存活的轮询器会为已拆除的开发链永远重哈希 bundle。以基线差量检查：
 * fiber 创建时观察到的 StatWatcher 计数，在销毁已排空 fiber 的 effect 后
 * 必须恢复（internal/plugin 在销毁开始时触发；微任务跳转让销毁器先排队其
 * 卸载，fiber.await() 再汇合）。SSE 连接与监听器拆除在同一 ctx.effect
 * 销毁器内，因此监视器计数是该关系的可观察代理。
 */
const install: InvariantInstaller = (ctx, fail) => {
  const baselines = new WeakMap<Fiber, number>()
  // Async listener by design: emitPluginDisposed awaits-and-logs returned
  // promises, so a violation surfaces loudly instead of unhandled.
  // 刻意异步监听器：emitPluginDisposed 会 await 并记录返回的 promise，
  // 因此违规会响亮浮现而非未处理。
  // oxlint-disable-next-line typescript/no-misused-promises
  ctx.on('internal/plugin', async (fiber) => {
    if (fiber.name !== 'client-hmr') return
    if (fiber.uid !== null) {
      baselines.set(fiber, statWatchers()) // 创建时记录基线
      return
    }
    const baseline = baselines.get(fiber)
    if (baseline === undefined) return
    await Promise.resolve()
    await fiber.await() // 等销毁器排空
    const remaining = statWatchers()
    if (remaining > baseline) {
      fail(`client-hmr fiber disposed but ${remaining - baseline} bundle stat watcher(s) survived teardown`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 注册本包的不变量伴侣。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后已安装注册项的销毁函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
