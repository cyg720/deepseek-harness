/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-credentials`.
 * @module @deepseek-ai/dsh-credentials/invariant
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-credentials 包的"不变量伴随插件"：校验 credentials/reference-updated 事件
 *   只能在凭据服务存活时发出——事件代表一次已提交的变更，服务已销毁却仍发出意味着 Provider
 *   在拆卸收尾后泄露了工作。
 * 【技术维度】invariants 服务的 fail 回调 + Cordis ctx.on 订阅；用 ctx.get('credentials')
 *   判断服务是否在线。
 * 【产品维度】invariants 是仓库的运行时自检机制：一旦事件生命周期契约被破坏，演示/测试立即失败。
 * 【逻辑维度】apply 注册 → install 订阅事件 → 事件发出时检查服务存活 → 违反则 fail。
 * 【关键边界】describe 与 resolve 的值一致性属异步 Provider IO，由各 Provider 自己的测试钉住，
 *   不放进运行时自检。
 * 【新手阅读建议】先读 index.ts 的 notifyUpdated 理解事件从哪发出，再对照本文件的检查点。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务里的注册名，与 npm 包名一致，便于错误报告中定位归属。
const PACKAGE_NAME = '@deepseek-ai/dsh-credentials'

// 该伴随插件的注册名，供 Cordis 按名加载与日志定位。
/** Cordis companion plugin name. */
export const name = 'credentials-invariant'
// 声明依赖全局 invariants 服务；Cordis 会先装载该服务再调用本插件。
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the commit-event lifecycle contract: `credentials/reference-updated` names a
 * committed provider-source change, so it can only fire while a credentials
 * service is live — an emission after disposal means a provider leaked work
 * past its teardown quiescence. The value relation itself (`describe`
 * agreeing with `resolve`) is asynchronous provider I/O and stays pinned by
 * each provider's own suite.
 */
// 安装检查：订阅 reference-updated，事件发出时要求凭据服务仍在线，否则视为 Provider 在拆卸后泄漏工作。
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('credentials/reference-updated', (ref) => {
    if (ctx.get('credentials') === undefined) {
      fail(`credentials/reference-updated for "${ref}" emitted without a live credentials service`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 插件入口：向全局 invariants 服务注册"包名 → 安装函数"，返回可撤销注册的 disposer。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
