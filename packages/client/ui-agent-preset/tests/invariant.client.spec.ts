/** The package's node half: an empty host body and an explained empty invariant companion. */
/*
 * 文件职责：验证代理预设 UI 包的空 Node 主体和不变量伴生插件入口。
 * 技术维度：使用 Vitest、Cordis 上下文、静态伴生导入与动态包根导入覆盖双端装配。
 * 产品维度：保证代理预设界面只在浏览器运行，同时宿主配置可稳定保留插件席位。
 * 逻辑维度：第一个用例注册包所有权；第二个动态加载并调用无行为的 Node apply。
 * 关键边界：不测试预设选择交互；Node 入口存在但不能创建任何浏览器状态。
 * 新手阅读建议：先区分 invariant 子路径与包根入口，再理解空宿主为何仍需出现在 cordis.yml。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as AgentPresetInvariant from '@deepseek-ai/dsh-client-ui-agent-preset/invariant'

// 测试组：描述代理预设 UI 包的双端占位与注册行为。
describe('invariant companion', () => {
  /** 功能描述：确认空安装器保留包名所有权；参数：无；返回：异步完成；示例：等待插件纤程成功。 */
  it('reserves package ownership with an empty installer', async () => {
    // ctx：装配注册表和代理预设伴生插件的独立上下文。
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(AgentPresetInvariant).await()).resolves.toBeDefined()
  })

  /** 功能描述：确认 Node apply 是可调用空入口；参数：无；返回：异步完成；示例：apply() 不抛错。 */
  it('has an empty node half', async () => {
    // apply：动态导入的 Node 侧 Loader 占位函数。
    const { apply } = await import('@deepseek-ai/dsh-client-ui-agent-preset')

    // The host body exists only so the plugin appears in the host cordis.yml;
    // every surface this package ships lives in the browser half.
    // 宿主主体只为让插件出现在 host cordis.yml；该包所有实际界面都位于浏览器半边。
    apply()

    expect(typeof apply).toBe('function')
  })
})
