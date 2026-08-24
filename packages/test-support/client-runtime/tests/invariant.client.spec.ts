/**
 * 文件职责：验证客户端测试运行时的不变量伴生插件能够按包名完成注册。
 * 技术维度：使用 Vitest、Cordis 上下文和不变量注册表执行插件生命周期测试。
 * 产品维度：保证测试基础设施可被完整装配，避免开发者运行客户端测试时遇到缺失插件。
 * 逻辑维度：创建上下文，启用注册表，再加载伴生插件并检查其初始化结果。
 * 关键边界：该伴生插件当前没有额外检查逻辑；本文件只验证注册和装配行为。
 * 新手阅读建议：先看测试标题，再按 Context、InvariantRegistry、TestRuntimeInvariant 的加载顺序理解插件关系。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as TestRuntimeInvariant from '@deepseek-ai/dsh-client-test-runtime/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

// 测试组：集中描述客户端测试运行时的不变量伴生插件行为。
describe('invariant companion', () => {
  /**
   * 功能描述：确认空安装器仍能通过不变量注册表成功装配。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；插件加载失败时由 Vitest 报错。
   * 使用示例：运行本测试文件即可验证伴生插件注册路径。
   */
  it('registers under the package name with an empty installer', async () => {
    // ctx：本用例独享的 Cordis 上下文，生命周期仅覆盖当前测试。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(TestRuntimeInvariant).await()).resolves.toBeDefined()
  })
})
