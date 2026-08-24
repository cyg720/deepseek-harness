/**
 * 文件职责：验证侧边栏包的客户端不变量伴生入口和 Node 空操作入口。
 * 技术维度：使用 Vitest、Cordis 上下文、包子路径导入和动态导入覆盖双端装配。
 * 产品维度：保证侧边栏可加入客户端组合，Node 宿主加载同一包时不会执行界面代码。
 * 逻辑维度：先装配伴生插件，再动态导入包根 apply 并确认调用路径不抛错。
 * 关键边界：测试不渲染侧边栏；Node apply 当前只是 Loader 占位入口。
 * 新手阅读建议：先看两个 it 分别对应客户端和 Node，再沿包 exports 查找入口映射。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SidebarInvariant from '@deepseek-ai/dsh-client-ui-sidebar/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

// 测试组：描述侧边栏包的双端不变量入口行为。
describe('invariant companion', () => {
  /**
   * 功能描述：确认侧边栏空安装器可按包名注册。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；装配失败时由 Vitest 报错。
   * 使用示例：在启用注册表后等待 SidebarInvariant 应成功解析。
   */
  it('registers under the package name with an empty installer', async () => {
    // ctx：当前测试使用的独立 Cordis 上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SidebarInvariant).await()).resolves.toBeDefined()
  })

  /**
   * 功能描述：确认 Node 侧 apply 是不会抛错的宿主占位函数。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成动态导入；到达最终断言即表示调用成功。
   * 使用示例：导入包根后调用 apply() 不应产生界面副作用。
   */
  it('node-half apply is a no-op host placeholder', async () => {
    // apply：动态取得的 Node 侧包根占位入口。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-sidebar')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
    // 能执行到此处且未抛错就是该占位入口的约定。
  })
})
