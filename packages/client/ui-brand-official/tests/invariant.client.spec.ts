/**
 * 文件职责：验证官方品牌包的客户端不变量伴生插件和 Node 占位入口。
 * 技术维度：使用 Vitest、Cordis 插件上下文和 Node 入口函数执行双端装配测试。
 * 产品维度：保证官方品牌视觉可安全加入客户端，同时不会在 Node 侧执行浏览器逻辑。
 * 逻辑维度：第一个用例装配伴生插件，第二个用例直接调用 Node 侧空操作入口。
 * 关键边界：这里只验证包所有权和双端入口，不检查品牌图形或 CSS 的视觉结果。
 * 新手阅读建议：先区分 BrandInvariant 与 nodeApply 的运行环境，再分别阅读两个用例。
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as BrandInvariant from '../src/invariant.ts'
import { apply as nodeApply } from '../src/index.ts'

// 测试组：描述官方品牌包的客户端伴生入口和 Node 占位入口。
describe('official brand invariant companion', () => {
  /**
   * 功能描述：确认空安装器能通过注册表保留官方品牌包的不变量所有权。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；插件无法装配时由 Vitest 报错。
   * 使用示例：ctx.plugin(BrandInvariant).await() 应解析为已定义的纤程结果。
   */
  it('reserves package ownership with an empty installer', async () => {
    // ctx：用于装配不变量注册表和品牌伴生插件的独立上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(BrandInvariant).await()).resolves.toBeDefined()
  })

  /**
   * 功能描述：确认 Node 侧 Loader 占位入口可以调用且不会抛错。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：无返回值；nodeApply 抛错时断言失败。
   * 使用示例：在非浏览器配置中调用 nodeApply() 应保持空操作。
   */
  it('keeps the node half as an inert Loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
