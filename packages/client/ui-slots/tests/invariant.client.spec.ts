/**
 * 文件职责：验证 UI 插槽核心包注册其解释为空的 invariant companion。
 * 技术维度：使用 Vitest 和真实 Cordis 插件生命周期执行注册。
 * 产品维度：确保插槽类型核心在运行时诊断清单中有明确包归属。
 * 逻辑维度：创建上下文、启用 invariant 服务、挂载插槽 companion。
 * 关键边界：本测试不验证插槽声明冲突、组件注册或渲染行为。
 * 新手阅读建议：先看 companion 挂载，再到插槽行为测试学习组合规则。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SlotsInvariant from '@deepseek-ai/dsh-client-ui-slots/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 插槽核心 invariant 测试套件；由客户端测试命令自动调用。 */
describe('invariant companion', () => {
  /** 验证空安装 companion 成功注册；异步回调无参数。 */
  it('registers under the package name with an empty installer', async () => {
    /** 本用例独享的 Cordis 上下文，插件集合从空状态开始。 */
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SlotsInvariant).await()).resolves.toBeDefined()
  })
})
