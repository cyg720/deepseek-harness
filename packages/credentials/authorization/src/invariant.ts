/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-authorization`.
 * @module @deepseek-ai/dsh-authorization/invariant
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】authorization 包的"不变量伴随插件"：校验 authorization/settled 事件发出时，
 *   该 key 的尝试槽位必须已经释放。
 * 【技术维度】订阅 settled 事件；通过 authorization.describe(key).inFlight 判断槽位是否仍被占用。
 * 【产品维度】防止"楔住"的 key：槽位一旦泄漏，此后所有 begin 都会被当作 ALREADY_IN_FLIGHT 拒绝，
 *   且从外部无法与"正忙"区分。
 * 【逻辑维度】apply 注册 → 事件发出时检查服务存活与 inFlight → 违反则 fail。
 * 【关键边界】flow 在自身尝试中途被注销（disposer 中止尝试）属文档化行为，不视为泄漏。
 * 【新手阅读建议】对照 index.ts 的 begin 方法 finally 块（先释放槽位再 settle）阅读。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务里的注册名，与 npm 包名一致，便于错误报告中定位归属。
const PACKAGE_NAME = '@deepseek-ai/dsh-authorization'

// 该伴随插件的注册名，供 Cordis 按名加载与日志定位。
/** Cordis companion plugin name. */
export const name = 'authorization-invariant'
// 声明依赖全局 invariants 服务；Cordis 会先装载该服务再调用本插件。
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the single-flight release contract: `authorization/settled` names a
 * finished attempt, and the seam admits one attempt per key, so the key must
 * already be free when the event fires. A slot still held at settlement is
 * unrecoverable — every later `begin()` for that key is refused as
 * `ALREADY_IN_FLIGHT` until the process restarts — and it is invisible from the
 * outside, because a wedged key looks exactly like a busy one.
 */
// 安装检查：订阅 settled 事件，校验服务仍存活且该 key 的尝试槽位已释放（防止槽位泄漏楔死后续尝试）。
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('authorization/settled', (key) => {
    const authorization = ctx.get('authorization')
    if (authorization === undefined) {
      fail(`authorization/settled for "${key}" emitted without a live authorization service`)
      return
    }
    // A flow withdrawn during its own attempt settles with nothing left to
    // describe, which is the disposer's documented behavior rather than a leak.
    if (authorization.describe(key)?.inFlight === true) {
      fail(`authorization/settled for "${key}" left the key in flight, wedging every later attempt`)
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
