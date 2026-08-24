/**
 * 文件职责：验证模型设置包的不变量入口、Node 占位入口和未注入依赖时的安全渲染。
 * 技术维度：使用 Vitest、Cordis 插件上下文、动态导入和直接函数组件调用。
 * 产品维度：保证模型设置可按双端配置装配，并在设置壳尚未提供依赖时保持安静。
 * 逻辑维度：依次测试伴生注册、Node apply 空操作和 ModelsSection 缺依赖返回 null。
 * 关键边界：不覆盖完整模型设置交互；空对象调用只用于验证未装配阶段。
 * 新手阅读建议：按三个用例理解包所有权、宿主占位和浏览器依赖注入三层职责。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ModelsInvariant from '@deepseek-ai/dsh-client-ui-settings-models/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { ModelsSection } from '../src/client/ModelsSection.tsx'

// 测试组：描述模型设置包在不同装配阶段的安全行为。
describe('invariant companion', () => {
  /** 功能描述：确认空安装器按包名注册；参数：无；返回：异步完成；示例：等待 ModelsInvariant 成功。 */
  it('registers under the package name with an empty installer', async () => {
    // ctx：当前测试独享的 Cordis 插件上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ModelsInvariant).await()).resolves.toBeDefined()
  })

  /** 功能描述：确认 Node apply 不产生行为；参数：无；返回：异步完成；示例：调用后不抛错。 */
  it('node-half apply is a no-op host placeholder', async () => {
    // apply：模型设置包的 Node Loader 占位入口。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-settings-models')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
    // 能执行到此处且未抛错就是空操作入口约定。
  })

  /** 功能描述：确认壳依赖未注入时返回 null；参数：无；返回：无可见节点；示例：ModelsSection({})。 */
  it('renders null until the shell injects the section dependencies', () => {
    expect(ModelsSection({})).toBeNull()
  })
})
