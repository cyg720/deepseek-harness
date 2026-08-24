/**
 * 文件职责：为进程内子代理生成端到端测试组装真实代理循环、模型、终端和委派工具栈。
 * 技术维度：使用 Cordis 插件组合、DeepSeek 适配器、本地子进程和状态事件监听。
 * 产品维度：验证父代理能委派真实任务给子代理，并由子代理通过实际工具完成工作。
 * 逻辑维度：依次安装测试依赖和各能力提供方，绑定 spawn 后端，并提供等待代理空闲的辅助函数。
 * 关键边界：该工具会调用真实模型与本地命令，仅适用于具备相应密钥和隔离工作目录的端到端测试。
 * 新手阅读建议：先按插件安装顺序识别各能力角色，再看 waitForIdle 如何等待异步任务收尾。
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '../src/index.ts'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'

/**
 * Shared harness for the spawn-backend e2e: the full real stack (DeepSeek
 * adapter + real bash tool + the subagent tool bound to the spawn backend), so
 * a real parent agent can delegate to a real in-process child that does real
 * work (writes a file). Lives outside the *.e2e.ts pattern so importing it never
 * re-registers another file's tests.
 */
/**
 * 创建可运行真实父子代理委派流程的完整测试上下文。
 * @param workdir 本地 bash 工具允许操作的隔离工作目录。
 * @returns 已安装并绑定 spawn 后端的 Cordis 上下文。
 * @example `const ctx = await spawnHarness(tempDir)`
 */
export async function spawnHarness(workdir: string): Promise<Context> {
  /** 承载整套端到端插件的测试上下文。 */
  const ctx = new Context()
  // This harness installs only the global default persona, so both parent and
  // spawned children render it. It stays neutral for both roles; the
  // delegation nudge lives in the e2e's user prompt and the subagent tool's
  // own description.
  // 测试只安装全局默认角色，父子代理共同使用；委派提示由用例输入和子代理工具说明提供。
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: 'You are a coding agent. Report only when the requested work is done.' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmDeepSeek)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  // The model-facing subagent tool, bound to the spawn backend.
  // 将模型可见的子代理工具明确绑定到 spawn 后端。
  await ctx.plugin(ToolSubagent, { provider: 'spawn' })
  return ctx
}

/**
 * 等待指定代理发出 idle 状态，并在命中后立即撤销监听。
 * @param ctx 发出代理状态事件的 Cordis 上下文。
 * @param agent 需要等待结束的代理实例。
 * @returns 代理进入空闲状态时完成的 Promise。
 * @example `await waitForIdle(ctx, agent)`
 */
export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  /** 状态监听命中目标代理后完成的等待结果。 */
  return new Promise((resolve) => {
    /** 状态事件监听的撤销函数，首次命中后调用以防泄漏。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
