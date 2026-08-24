/**
 * 文件职责：验证设置壳包的客户端不变量伴生入口和 Node 空操作入口。
 * 技术维度：使用 Vitest、Cordis 插件上下文和动态包导入检查双端装配。
 * 产品维度：保证设置页面可在浏览器加载，Node 宿主只占据 Loader 位置而不执行 UI。
 * 逻辑维度：第一个用例注册客户端伴生插件，第二个用例调用 Node apply 占位函数。
 * 关键边界：不覆盖具体设置分区或交互；Node 入口保持无副作用。
 * 新手阅读建议：分别把两个用例理解为浏览器半边和 Node 半边，再查看 package exports。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SettingsInvariant from '@deepseek-ai/dsh-client-ui-settings/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

// 测试组：描述设置壳包的双端不变量入口。
describe('invariant companion', () => {
  /**
   * 功能描述：确认设置包的空安装器能通过注册表装配。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；插件装配失败时由 Vitest 报错。
   * 使用示例：等待 SettingsInvariant 的插件纤程应得到已定义结果。
   */
  it('registers under the package name with an empty installer', async () => {
    // ctx：当前测试独享的 Cordis 上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SettingsInvariant).await()).resolves.toBeDefined()
  })

  /**
   * 功能描述：确认 Node 侧设置包 apply 入口可调用且没有行为。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成动态导入；最终断言只证明调用未抛错。
   * 使用示例：非浏览器宿主加载包根后可安全调用 apply()。
   */
  it('node-half apply is a no-op host placeholder', async () => {
    // apply：从设置包根动态取得的 Node Loader 占位函数。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-settings')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
    // 到达此处且未抛错即满足 Node 占位入口约定。
  })
})
