/**
 * 文件职责：验证模拟大模型服务器的不变量伴生插件已按包名唯一注册。
 * 技术维度：使用 Vitest、Cordis 上下文和不变量注册表执行装配生命周期测试。
 * 产品维度：保证测试替身服务器能稳定加入测试应用，避免重复诊断插件掩盖配置问题。
 * 逻辑维度：装配注册表和伴生插件，尝试重复注册同名检查器并断言失败，最后释放资源。
 * 关键边界：运行时不变量当前为空；此测试不启动服务器，也不验证模型响应。
 * 新手阅读建议：先看 MockServerInvariant 的装配，再理解 register 的包名唯一性约束。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MockServerInvariant from '../src/invariant.ts'

// 测试组：描述模拟大模型服务器伴生插件的唯一注册行为。
describe('mock LLM server invariant companion', () => {
  /**
   * 功能描述：确认包名已由伴生插件占用，第二次注册会被拒绝。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；断言或释放失败时由 Vitest 报错。
   * 使用示例：加载 MockServerInvariant 后再次注册同名空检查器应抛出 already registered。
   */
  it('registers its explained empty runtime invariant', async () => {
    // ctx：当前测试独享的 Cordis 插件上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    // fiber：模拟服务器伴生插件的纤程，用于单独等待和释放。
    const fiber = await ctx.plugin(MockServerInvariant)

    // 断言回调：尝试重复注册包名；内层空函数是无参数、无返回值的检查器替身。
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-llm-mock-server', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
