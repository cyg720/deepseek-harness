/*
 * ================================ 文件注释 ================================
 * 【文件职责】webserver 包的"不变量伴生插件"：向不变量服务注册本包拥有者
 * 身份，并断言"HTTP 与 upgrade 路由注册及释放必须对称"这一属主关系。
 * 【技术维度】Cordis 伴生插件：监听 internal/plugin（每次 fiber 卸载）时，用
 * 注册-释放探针验证 register() 的释放函数确实删除了路由条目——若残留，第二次
 * 注册会抛重复错误，从而暴露不对称。
 * 【产品维度】守护路由表与插件生命周期的一致性：某插件卸载后，其路径绝不应
 * 继续应答（残留路由会继续调用已释放插件的 handler）。
 * 【逻辑维度】包名/注入声明 → install：探针注册两次（第一次注册+释放、第二次
 * 应成功）与 upgrade 同款探针 → 任何抛错触发 fail → apply 注册并返回 disposer。
 * 【关键边界】webServer 未装配时跳过（无本组合可断言）；探针路径固定为
 * /__dsh_invariant_probe__ 与 /__dsh_invariant_upgrade_probe__，且每次注册立即
 * 释放，不留残留。
 * 【新手阅读建议】本文件是"非空不变量伴生插件"的典型样例，可与 invariant 模板
 * 对比，理解探针式断言的思路。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-webserver`.
 * @module @deepseek-ai/dsh-host-webserver/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在不变量注册表中使用的包名键。
const PACKAGE_NAME = '@deepseek-ai/dsh-host-webserver'

/** Cordis companion plugin name. */
// 伴生插件的 Cordis 插件名。
export const name = 'host-webserver-invariant'
/** Service required before the companion can register. */
// 启动前必须注入的服务：不变量注册服务。
export const inject = ['invariants']

/**
 * Owned relation: HTTP and upgrade route registrations and their disposers must stay
 * symmetric — after the owning fiber of a registered route unloads, the
 * route table must no longer answer for its path (a stale route would keep
 * serving a disposed plugin's handler). Checked on every fiber teardown
 * (cordis 'internal/plugin'): the service's own registry state is compared
 * against the set of live fibers' registrations indirectly, by probing that
 * dispose really removed the entry — the register() disposer contract.
 */
// 不变量安装器：每次插件 fiber 卸载后，用"注册-释放-再注册"探针验证路由释放
// 函数真的删除了条目——若释放残留，第二次注册会抛重复错误，即为不对称。
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/plugin', () => {
    const server = ctx.get('webServer') as
      | {
        register(route: { kind: 'exact'; path: string; handler: () => void }): () => void
        registerUpgrade(route: { path: string; handler: () => void }): () => void
      }
      | undefined
    if (server === undefined) return // no webserver row in this composition
    // Register/dispose probe on a reserved path: if dispose leaves the route
    // behind, a second register throws the duplicate error — the asymmetry.
    // Each register(probe)() is one register+dispose cycle, so the probe never
    // leaves residue; a leftover from the first cycle makes the second throw.
    const probe = { kind: 'exact' as const, path: '/__dsh_invariant_probe__', handler: () => {} }
    try {
      server.register(probe)()
      server.register(probe)()
      const upgradeProbe = { path: '/__dsh_invariant_upgrade_probe__', handler: () => {} }
      server.registerUpgrade(upgradeProbe)()
      server.registerUpgrade(upgradeProbe)()
    } catch {
      fail('webServer route disposer left a route registered — route tables and fiber lifecycles diverged')
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
