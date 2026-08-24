/**
 * 文件职责：验证会话结束原因到 Agent Client Protocol 停止原因的转换规则。
 * 技术维度：使用 Vitest 参数化测试逐项调用 ACP 编解码转换函数。
 * 产品维度：让外部 ACP 客户端收到稳定、可识别的任务结束状态。
 * 逻辑维度：建立内部结束原因与协议字符串的映射表，并对每一组输入输出执行断言。
 * 关键边界：ACP 可表达的停止原因少于内部原因；部分内部状态会有意归并为 end_turn。
 * 新手阅读建议：先阅读映射表了解所有分支，再查看 codec.ts 中对应的判别联合处理。
 */
import { describe, expect, it } from 'vitest'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { turnEndToStopReason } from '../src/codec.ts'

// 测试组：集中验证 ACP 停止原因编码规则。
describe('ACP codec', () => {
  /**
   * 功能描述：逐项确认内部 TurnEndReason 被转换为预期的 ACP 字符串。
   * 参数说明：reason 是内部结束原因；expected 是对应的协议停止原因。
   * 返回值解释：参数化回调无返回值；任一映射不匹配时由 Vitest 报错。
   * 使用示例：{ kind: 'interrupted' } 应被编码为 cancelled。
   */
  // 映射表常量：每个元组依次保存内部原因和预期协议值，类型约束防止测试数据写错。
  it.each([
    [{ kind: 'completed' }, 'end_turn'],
    [{ kind: 'max-tokens' }, 'max_tokens'],
    [{ kind: 'aborted', reason: { kind: 'user' } }, 'end_turn'],
    [{ kind: 'interrupted' }, 'cancelled'],
    [{ kind: 'blocked' }, 'end_turn'],
    [{ kind: 'error', error: { message: 'failed', code: 'UNKNOWN' } }, 'end_turn'],
  ] satisfies Array<[TurnEndReason, string]>)('maps %o to %s', (reason, expected) => {
    // reason：当前参数化用例的内部结束原因；expected：允许输出的预期协议字符串。
    expect(turnEndToStopReason(reason)).toBe(expected)
  })
})
