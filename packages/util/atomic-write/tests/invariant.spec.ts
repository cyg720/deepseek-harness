/**
 * 文件职责：验证原子写入包的不变量伴生插件按包名唯一注册并可正常释放。
 * 技术维度：使用 Vitest、Cordis 上下文和不变量注册表执行插件生命周期测试。
 * 产品维度：保证安全文件替换工具加入应用时具备明确的装配记录，避免重复检查器覆盖。
 * 逻辑维度：创建上下文，加载注册表和伴生插件，尝试重复注册并断言失败，最后依次释放资源。
 * 关键边界：伴生运行时检查当前为空；本文件验证的是唯一注册关系，不测试实际文件写入。
 * 新手阅读建议：先看 fiber 的创建与释放，再理解重复 register 为什么必须抛出错误。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AtomicWriteInvariant from '../src/invariant.ts'

// 测试组：描述原子写入包的不变量伴生插件注册行为。
describe('atomic-write invariant companion', () => {
  /**
   * 功能描述：确认空检查器已经占用包名，重复注册会被注册表拒绝。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；未抛出预期错误或释放失败时由 Vitest 报错。
   * 使用示例：装配 AtomicWriteInvariant 后再次用同一包名 register 应抛出 already registered。
   */
  it('registers its explained empty runtime invariant', async () => {
    // ctx：承载不变量注册表和伴生插件的独立测试上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    // fiber：AtomicWriteInvariant 的插件纤程，用于等待装配完成并单独释放。
    const fiber = await ctx.plugin(AtomicWriteInvariant)

    // 断言回调：尝试以同一包名注册第二个空检查器，应触发唯一性错误。
    expect(() => {
      // 空检查器：无参数、无返回值，仅用于验证重复包名检测。
      ctx.invariants.register('@deepseek-ai/dsh-atomic-write', () => {})
    }).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
