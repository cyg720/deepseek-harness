/**
 * Shared suite helper: keep this package's stand-in parent out of a scripted
 * model corpus.
 * @module park-parent
 */
/**
 * 文件职责：为子代理控制测试提供共享辅助函数，阻止占位父代理进入脚本化模型语料。
 * 技术维度：通过 Cordis agent/pre-step 事件监听器按品牌化 SessionId 拦截父代理步骤。
 * 产品维度：让子代理交付测试只消耗为子代理轮次准备的确定性脚本响应。
 * 逻辑维度：监听每次代理步骤；非目标父代理调用 next 继续瀑布链，目标父代理返回 reject。
 * 关键边界：瀑布监听器对非目标必须调用 next；parent.id 必须是当前测试占位父代理的真实标识。
 * 新手阅读建议：先理解 child settlement 会唤醒父代理，再比较匹配与不匹配两个返回分支。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Reject every step of the stand-in parent. Each child settlement wakes its
 * parent, and these suites size their scripts for child turns only; the tests
 * assert on delivery rather than on the parent's own turn.
 * @param ctx - the booted test context.
 * @param parent - the stand-in parent whose turns must not reach the model.
 */
/**
 * 拒绝占位父代理的每一个模型步骤，同时让其他代理继续正常执行。
 * @param ctx - 已完成启动的测试 Cordis 上下文，用于注册事件监听器。
 * @param parent - 需要停放的占位父代理，只读取其品牌化 id。
 * @returns 无返回值；监听器由 ctx 生命周期统一释放。
 * @example parkParent(ctx, { id: parentSessionId })
 */
export function parkParent(ctx: Context, parent: { id: SessionId }): void {
  // 事件监听器：subject 是即将执行步骤的代理，next 用于把非目标事件交给后续监听器。
  ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
    if (subject.id !== parent.id) return next()
    return { kind: 'reject' as const }
  })
}
