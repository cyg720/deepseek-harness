/**
 * Pure translation between the harness lifecycle and the automation-only ACP wire.
 * @module @deepseek-ai/dsh-acp/codec
 */
/**
 * 文件职责：把 harness 的回合结束原因转换为 ACP 协议允许的停止原因。
 * 技术维度：使用 TypeScript 判别联合类型和 switch 显式映射两个协议的枚举词汇。
 * 产品维度：让自动化客户端收到稳定、合法的终止状态，正确区分自然结束、截断和用户中断。
 * 逻辑维度：按 TurnEndReason.kind 分支，将完成、令牌上限、中止、中断、阻塞和错误映射到 ACP 值。
 * 关键边界：ACP 的 cancelled 只用于显式客户端取消或中断；其他非成功终止在此报告为 end_turn。
 * 新手阅读建议：先对照两个导入类型的成员，再逐个查看 switch 分支及 cancelled 的特殊语义。
 */

import type { StopReason } from '@agentclientprotocol/sdk'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'

/**
 * Map a harness turn ending to ACP's terminal reason vocabulary.
 * @param reason - harness turn outcome.
 * @returns the closest legal ACP stop reason.
 */
/**
 * 将回合结果转换为 ACP 停止原因。
 * @param reason harness 记录的回合结果。
 * @returns 最接近且合法的 ACP 原因。
 * @example turnEndToStopReason({ kind: 'completed' }) 返回 'end_turn'。
 */
export function turnEndToStopReason(reason: TurnEndReason): StopReason {
  switch (reason.kind) {
    case 'completed':
      return 'end_turn'
    case 'max-tokens':
      return 'max_tokens'
    // `cancelled` is reserved for explicit client cancellation (`session/cancel`)
    // and disposal, both settled out of band; a turn aborted by a hook or
    // another owner is ordinary quiescence and reports `end_turn`.
    // cancelled 专用于客户端显式取消 session/cancel；显式取消和释放会在此映射之外完成结算；
    // hook 或其他所有者导致的 aborted 属于正常静止，因此对外报告为 end_turn。
    case 'aborted':
      return 'end_turn'
    case 'interrupted':
      return 'cancelled'
    case 'blocked':
    case 'error':
      return 'end_turn'
    /* v8 ignore next 2 -- TurnEndReason is closed and every member is handled above */
    /* v8 忽略后两行：TurnEndReason 是封闭联合，上方已列出所有合法成员。 */
    default:
      return 'end_turn'
  }
}
