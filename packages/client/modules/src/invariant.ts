/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-client-modules 包的运行时不变量（invariant）伴侣插件：
 *   审计节点半边的启动条目图自洽性——每个图行都必须能在同一 id 下解析
 *   出 client 包路径。
 * 【技术维度】Cordis 伴侣插件：在 internal/plugin 全局钩子上每次扫描触发
 *   时检查 graph() 与 clientPath()（两者读同一张表，任一时刻关系都成立）。
 * 【产品维度】图行广告的 /plugins/<id>/client.js URL 若解析不到包路径，
 *   浏览器刚收到图就会 404——本检查把这种错误提前到加载期暴露。
 * 【逻辑维度】install 定义审计逻辑；apply 向 invariants 服务注册。
 * 【关键边界】浏览器侧/无节点半边的 Host 无表可审（直接跳过）；
 *   每次扫描触发即检查，无需等节点半边自己的微任务去抖冲刷。
 * 【新手阅读建议】对照 packages/runtime-diagnostics/invariants 的 fail 语义理解。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-modules`.
 * @module @deepseek-ai/dsh-client-modules/invariant
 */
/*
 * 本包自有的不变量伴侣插件：审计 web 插件启动条目图的自洽性。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-modules' // 注册到 invariants 服务时使用的包名标识

/** Cordis companion plugin name. */
/* Cordis 伴侣插件的插件名。 */
export const name = 'client-modules-invariant'
/** Service required before the companion can reserve package ownership. */
/* 注册伴侣插件前必须先存在的服务。 */
export const inject = ['invariants']

/**
 * Owned relation: the node half's boot entry graph must stay self-consistent
 * — every row must resolve a clientPath under the same id (the
 * /plugins/<id>/client.js URL it advertises would otherwise 404 on a browser
 * that just received the graph). Checked on every scan trigger (cordis
 * 'internal/plugin'): graph() and clientPath() read the same table object,
 * so the relation holds at any instant — no need to wait out the node half's
 * own microtask-debounced flush.
 */
/*
 * owned 关系：节点半边的启动条目图必须自洽——每个行都必须能在同一 id 下
 * 解析出 clientPath（它广告的 /plugins/<id>/client.js URL 否则会在刚收到
 * 图的浏览器上 404）。在每次扫描触发（cordis internal/plugin）时检查：
 * graph() 与 clientPath() 读同一张表对象，因此该关系在任意时刻都成立——
 * 无需等节点半边自己的微任务去抖冲刷。
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/plugin', () => {
    const host = ctx.get('clientModules')
    if (host === undefined) return // browser side / host without the node half: nothing to audit
    // 浏览器侧 / 无节点半边的 Host：无可审计对象
    for (const row of host.graph().entries) {
      if (host.clientPath(row.id) === undefined) {
        fail(`web plugin graph row "${row.id}" advertises ${row.url} but resolves no client bundle path — the served __DSH_BOOT__ would 404 on fetch`)
      }
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
/* jscpd:ignore-end */
