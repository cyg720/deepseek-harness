/**
 * 文件职责：验证宿主插件清单的不变量伴生插件可注册、释放并再次装配。
 * 技术维度：使用 Vitest 和 Cordis 纤程生命周期 API 检查插件注册表集成。
 * 产品维度：保证插件清单能力在宿主重载或重新组合时不会遗留失效状态。
 * 逻辑维度：创建上下文，首次装配并释放伴生插件，再次装配，最后释放整个上下文。
 * 关键边界：伴生安装器当前为空；本测试关注生命周期，不覆盖实际插件发现或清单内容。
 * 新手阅读建议：重点比较 fiber.dispose 与 ctx.fiber.dispose 的作用范围，理解局部插件和整个上下文的释放差异。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginInventoryInvariant from '../src/invariant.ts'

// 测试组：描述宿主插件清单伴生模块的注册和重装行为。
describe('plugin-inventory invariant companion', () => {
  /**
   * 功能描述：确认包自有的空安装器在释放后仍可重新注册。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；任一生命周期操作失败时由 Vitest 报错。
   * 使用示例：先释放首次返回的 fiber，再通过同一 ctx 重新调用 ctx.plugin。
   */
  it('registers the package-owned empty installer', async () => {
    // ctx：承载注册表和伴生插件的测试上下文，取值为新建的独立实例。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    // fiber：首次装配返回的插件纤程，可单独等待初始化或释放。
    const fiber = ctx.plugin(PluginInventoryInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(PluginInventoryInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
