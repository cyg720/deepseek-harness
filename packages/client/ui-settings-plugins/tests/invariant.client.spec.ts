/** The package's node half: an empty host body and an explained empty invariant companion. */
/**
 * 文件职责：验证插件设置 UI 包的空 Node 主体和不变量伴生入口。
 * 技术维度：使用 Vitest、Cordis 注册表、静态伴生导入和动态包根导入。
 * 产品维度：让插件配置界面安全存在于浏览器半边，并在宿主组合中保留明确插件席位。
 * 逻辑维度：先装配空不变量安装器，再加载并调用无副作用的 Node apply。
 * 关键边界：不读取或修改插件配置；Node 入口不能执行任何浏览器专用逻辑。
 * 新手阅读建议：先看伴生插件如何保留包名，再看英文说明为何强调浏览器半边。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PluginConfigInvariant from '@deepseek-ai/dsh-client-ui-settings-plugins/invariant'

// 测试组：覆盖插件设置包的伴生注册和 Node 占位行为。
describe('invariant companion', () => {
  /** 功能描述：确认包名所有权被空安装器保留；参数：无；返回：异步完成；示例：插件纤程成功。 */
  it('reserves package ownership with an empty installer', async () => {
    // ctx：装配不变量注册表和插件设置伴生模块的独立上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PluginConfigInvariant).await()).resolves.toBeDefined()
  })

  /** 功能描述：确认 Node apply 可安全空调用；参数：无；返回：异步完成；示例：apply() 不抛错。 */
  it('has an empty node half', async () => {
    // apply：动态导入的插件设置 Node Loader 占位函数。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-settings-plugins')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this package ships lives in the browser half.
    // 宿主主体只用于 cordis.yml 插件席位；该包的全部真实界面位于浏览器半边。
    apply()

    expect(typeof apply).toBe('function')
  })
})
