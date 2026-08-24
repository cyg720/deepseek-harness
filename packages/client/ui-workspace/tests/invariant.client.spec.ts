/**
 * 文件职责：验证工作区 UI 包的客户端不变量伴生入口和 Node 空操作入口。
 * 技术维度：使用 Vitest、Cordis 上下文和动态包导入覆盖浏览器与宿主两侧。
 * 产品维度：保证工作区选择和显示能力可装配，同时避免 Node 侧执行浏览器专用代码。
 * 逻辑维度：先注册 WorkspaceInvariant，再加载并调用包根 apply 占位函数。
 * 关键边界：测试只关注入口与所有权，不验证目录选择、接管或工作区渲染。
 * 新手阅读建议：先区分静态 invariant 子路径与动态包根导入，再理解为何 Node 入口为空。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as WorkspaceInvariant from '@deepseek-ai/dsh-client-ui-workspace/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

// 测试组：描述工作区 UI 包的双端不变量入口行为。
describe('invariant companion', () => {
  /**
   * 功能描述：确认工作区伴生空安装器能按包名注册。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；插件装配失败时由 Vitest 报错。
   * 使用示例：启用注册表后等待 WorkspaceInvariant 应成功。
   */
  it('registers under the package name with an empty installer', async () => {
    // ctx：本用例独享的 Cordis 插件上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WorkspaceInvariant).await()).resolves.toBeDefined()
  })

  /**
   * 功能描述：确认工作区包的 Node apply 是安全的空操作占位入口。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成动态导入；最终断言表示调用没有抛错。
   * 使用示例：Node 宿主加载包根并调用 apply() 不应创建 UI 状态。
   */
  it('node-half apply is a no-op host placeholder', async () => {
    // apply：从工作区包根动态加载的 Node Loader 占位函数。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-workspace')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
    // 能到达此断言而没有异常就是空操作入口的约定。
  })
})
