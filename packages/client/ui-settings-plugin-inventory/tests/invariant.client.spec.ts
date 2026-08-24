/**
 * 文件职责：验证插件清单设置页面的不变量伴生模块能够注册，且 Node 侧入口保持空操作。
 * 技术维度：使用 Vitest、Cordis 插件上下文和动态导入覆盖客户端与 Node 两侧入口。
 * 产品维度：保证插件清单设置功能可安全加入应用组合，不会在非浏览器环境执行界面逻辑。
 * 逻辑维度：装配不变量注册表，加载客户端伴生插件，动态调用 Node 入口，最后释放上下文。
 * 关键边界：本文件只验证装配约束，不验证插件清单界面本身的交互和渲染。
 * 新手阅读建议：先区分 invariant.ts 与 index.ts 的职责，再跟随 ctx 的创建和释放理解插件生命周期。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginsInvariant from '../src/invariant.ts'

// 测试组：描述插件清单设置包的不变量伴生模块行为。
describe('ui-settings-plugin-inventory invariant companion', () => {
  /**
   * 功能描述：确认客户端伴生模块成功注册，并验证 Node 侧 apply 调用不会产生额外行为。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；插件装配失败时由 Vitest 报错。
   * 使用示例：运行本文件即可检查该双端包的最小装配路径。
   */
  it('registers the empty installer and keeps the node half inert', async () => {
    // ctx：当前测试独享的 Cordis 上下文，结束前必须释放其插件纤程。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(PluginsInvariant).await()).resolves.toBeDefined()
    // apply：Node 侧入口函数，当前设计为无副作用的空操作。
    const { apply } = await import('../src/index.ts')
    apply()
    await ctx.fiber.dispose()
  })
})
