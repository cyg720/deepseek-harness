/**
 * 文件职责：验证代理循环测试工具包能装配一条可配置的最小依赖主干并激活 AgentLoop。
 * 技术维度：使用 Vitest、Cordis 插件上下文、系统提示渲染器和测试依赖装配辅助函数。
 * 产品维度：为代理循环单元测试提供一致的轻量应用组合，减少重复测试脚手架。
 * 逻辑维度：创建上下文并注入人格与工具模式，检查提示词，再装配 AgentLoop，最后释放资源。
 * 关键边界：使用空 agents 数组只证明前置依赖完整，不运行真实模型或代理轮次。
 * 新手阅读建议：先看 mountAgentLoopTestDependencies 的配置输入，再看两个断言分别验证提示和循环装配。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { mountAgentLoopTestDependencies } from '../src/index.ts'

// 测试组：描述代理循环测试工具包的最小装配能力。
describe('dsh-agent-loop-testkit', () => {
  /**
   * 功能描述：确认自定义人格和原生工具模式能形成可激活 AgentLoop 的前置主干。
   * 参数说明：测试回调不接收参数。
   * 返回值解释：异步完成测试；提示或插件装配失败时由 Vitest 报错。
   * 使用示例：传入 Test persona. 后组装提示应包含该文本。
   */
  it('mounts a configurable prerequisite spine that can activate AgentLoop', async () => {
    // ctx：承载测试依赖和 AgentLoop 的独立 Cordis 上下文。
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'Test persona.' },
      tools: { mode: 'native' },
    })

    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Test persona.')
    await expect(ctx.plugin(AgentLoop, { agents: [] })).resolves.toBeDefined()

    await ctx.fiber.dispose()
  })
})
