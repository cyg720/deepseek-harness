/**
 * 文件职责：为文件系统工具真实接口测试装配完整运行栈，并提供等待代理静止的辅助函数。
 * 技术维度：使用 Cordis 插件、真实 AgentLoop、DeepSeek LLM、本地文件系统和状态事件监听。
 * 产品维度：验证代理在指定工作区内调用文件工具的真实组合行为。
 * 逻辑维度：fsHarness 按依赖顺序装配上下文；waitForIdle 监听目标代理进入 idle 后注销并完成。
 * 关键边界：文件位于 e2e glob 外以避免导入即注册测试；调用方负责凭据和上下文释放。
 * 新手阅读建议：先看 fsHarness 的插件顺序，再看 waitForIdle 如何筛选事件并自注销。
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
/* 构建真实文件工具测试栈。@param fsCwd 工作区路径。@param persona 可选提示词。@returns 已装配上下文。@example await fsHarness(tempDir)。 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  // 新的独立测试上下文；调用方在测试结束后负责释放。
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmDeepSeek)
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

/** 等待目标代理空闲。@param ctx 事件上下文。@param agent 目标代理。@returns 首次 idle 后完成的 Promise。@example await waitForIdle(ctx, agent)。 */
export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  // 等待状态事件的 Promise；只由目标代理 idle 事件完成。
  return new Promise((resolve) => {
    // 状态监听注销函数；subject 是事件代理，status 是新状态，命中后立即自注销。
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
