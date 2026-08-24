/** Package-owned permission-preset event invariants. @module @deepseek-ai/dsh-permission-presets/invariant */
/**
 * 文件职责：验证已加载和新追加的 permission/preset 事件始终引用当前可解析的 preset。
 * 技术维度：使用 Cordis 全局内部事件监听、会话遍历和 dsh-invariants 失败回调。
 * 产品维度：防止会话日志包含未知权限方案，导致恢复后安全设置无法解释。
 * 逻辑维度：validateEvent 检查单事件；install 先扫描现有会话，再监听 session/event；apply 注册伴生插件。
 * 关键边界：无关事件直接忽略；校验依据当前 permissionPresets.names，安装器依赖 presets 与 sessions 服务。
 * 新手阅读建议：先看 validateEvent 的唯一失败条件，再看 install 的历史/实时两条输入，最后看 apply。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 不变量注册表中的正式包名。
const PACKAGE_NAME = '@deepseek-ai/dsh-permission-presets'

/** Cordis companion plugin name. */
/** Cordis 配置引用的伴生插件名称。 */
export const name = 'permission-presets-invariant'
/** Service required before the companion can reserve package ownership. */
/** 注册前必须注入不变量服务。 */
export const inject = ['invariants']

/** Validate the package-owned event fields and ignore unrelated events. */
/** 校验单事件。@param ctx 提供 preset 名称。@param event 会话事件。@param fail 失败报告函数。@returns 无。@example validateEvent(ctx, event, fail)。 */
function validateEvent(ctx: Context, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'permission/preset' && !ctx.permissionPresets.names.includes(event.data.preset)) {
    fail(`permission/preset names unknown preset ${JSON.stringify(event.data.preset)}`)
  }
}

/** Install validation that loaded and newly appended preset events remain resolvable. */
/** 安装历史和实时校验；ctx/fail 由不变量注册表传入，返回值由监听 effect 管理。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // 当前已加载会话。
  for (const session of ctx.sessions.list()) {
    // 当前会话中的持久事件。
    for (const event of session.events) validateEvent(ctx, event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    // session/event 分发参数中的实际 SessionEvent。
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(ctx, event, fail)
  }, { global: true })
}, { inject: ['permissionPresets', 'sessions'] })

/**
 * Register the permission invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册权限不变量伴生插件。@param ctx Cordis 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
