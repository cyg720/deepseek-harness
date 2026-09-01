/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-settings`.
 * @module @deepseek-ai/dsh-settings/invariant
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-settings 包的"不变量伴随插件"：在运行时监听 settings/updated 事件，
 *   校验"只对已注册命名空间、仅在解析值确实变化时、且值与服务权威值一致"这条提交契约。
 * 【技术维度】基于 Cordis ctx.on 事件订阅 + invariants 服务的 fail 回调；复用包内 deepEqualJson
 *   作为判定谓词，保证检查与实现用同一把尺子。
 * 【产品维度】invariants 是仓库的运行时自检机制：一旦未来改动破坏事件语义，测试/演示会立刻失败。
 * 【逻辑维度】apply 注册 → install 订阅事件 → 每次提交校验三条件 → 违反则 fail 并报错。
 * 【关键边界】settings/updated 的同步监听里不允许 async 函数（异步 rejection 无法经 INVARIANT 抛出）。
 * 【新手阅读建议】先读 index.ts 的 commit/publish 路径，再回来对照本文件逐条检查三条件。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'

const PACKAGE_NAME = '@deepseek-ai/dsh-settings'

/** Cordis companion plugin name. */
export const name = 'settings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the commit-event contract: `settings/updated` fires only for a
 * currently registered namespace, only when the resolved value changed, and
 * only with the service's authoritative resolved value — all judged with the
 * seam's own equality predicate.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('settings/updated', (ns, next, prev) => {
    const settings = ctx.get('settings')
    if (settings === undefined) {
      fail(`settings/updated for "${ns}" emitted without a live settings service`)
    }
    const current = settings.get(ns)
    if (current === undefined) {
      fail(`settings/updated for "${ns}" emitted while the namespace is unregistered`)
    }
    if (!deepEqualJson(current, next)) {
      fail(`settings/updated for "${ns}" does not match the authoritative resolved value`)
    }
    if (deepEqualJson(next, prev)) {
      fail(`settings/updated for "${ns}" emitted without a resolved-value change`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
