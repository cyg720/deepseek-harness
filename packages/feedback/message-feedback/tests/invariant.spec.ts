/**
 * 文件职责：验证消息反馈不变量伴生插件在纤程释放时撤销注册，并可再次装配。
 * 技术维度：使用 Vitest、真实测试 Harness、Cordis 纤程和不变量注册表覆盖 HMR 生命周期。
 * 产品维度：保证热更新消息反馈插件时不会残留旧注册，避免下一版本加载失败。
 * 逻辑维度：启动 Harness，装配伴生插件，验证重复包名失败，释放纤程后重新装配，最终清理。
 * 关键边界：finally 必须释放 Harness；本文件验证注册生命周期，不提交真实用户反馈。
 * 新手阅读建议：沿 harness、fiber、dispose 的顺序阅读，重点比较释放前后的重新注册结果。
 */
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MessageFeedbackInvariant from '../src/invariant.ts'
import { setupHarness } from './helpers.ts'

// 测试组：描述消息反馈伴生插件的注册撤销与热重载安全性。
describe('message-feedback invariant companion', () => {
  /**
   * 功能描述：确认插件纤程释放会移除注册表贡献，使同一插件可以再次装配。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；重复注册、重装或清理失败时由 Vitest 报错。
   * 使用示例：await fiber.dispose() 后再次 ctx.plugin(MessageFeedbackInvariant) 应成功。
   */
  it('removes its registry contribution when its fiber is disposed (HMR safety)', async () => {
    // harness：包含已启动 Cordis 上下文和统一清理函数的测试应用。
    const harness = await setupHarness()
    try {
      await harness.ctx.plugin(InvariantRegistry)
      // fiber：首次装配的消息反馈伴生插件纤程，释放时应撤销注册。
      const fiber = await harness.ctx.plugin(MessageFeedbackInvariant)

      // 断言回调：在插件仍存活时尝试用同一包名注册空检查器，应被唯一性规则拒绝。
      expect(() => {
        harness.ctx.invariants.register('@deepseek-ai/dsh-message-feedback', () => {})
      }).toThrow(/already registered/u)

      await fiber.dispose()
      await expect(harness.ctx.plugin(MessageFeedbackInvariant).await()).resolves.toBeDefined()
    } finally {
      await harness.dispose()
    }
  })
})
