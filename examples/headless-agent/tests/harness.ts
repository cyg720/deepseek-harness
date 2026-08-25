/**
 * 文件职责：为 Headless E2E 组装真实模型、agent loop、bash、todo、压缩、令牌计量和持久化插件栈。
 * 技术维度：使用 Cordis、DeepSeek 适配器、本地子进程、JSONL 会话存储和可选 BasicCompactionEngine。
 * 产品维度：让多个无界面示例测试复用与正式运行相近的编码智能体环境。
 * 逻辑维度：定义系统提示与选项，codingHarness 按配置安装插件，再提供等待空闲和提取最终文本的辅助函数。
 * 关键边界：只有请求的插件才挂载；持久化和压缩配置归调用者所有；调用者必须释放返回的 Context。
 * 新手阅读建议：先读两个系统提示，再看 CodingHarnessOptions，最后逐行阅读 codingHarness 的插件安装顺序。
 */
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as ToolBash from '@deepseek-ai/dsh-tool-bash'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SessionCheckpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'

/**
 * Shared harness for the headless-agent e2e suites: the full plugin stack
 * with the real DeepSeek adapter and the real bash + todo_write tools. Lives
 * outside the *.e2e.ts pattern so importing it never re-registers another
 * file's tests.
 */
/* 中文说明：共享 Harness 位于 e2e 命名模式之外，避免被导入时重复注册其他测试文件的用例。 */

/* 普通编码任务的系统角色提示，要求用 bash 操作文件并简洁报告。 */
export const SYSTEM_PROMPT = 'You are a coding agent. Use bash for file operations '
  + 'with cat/grep/heredocs; check [exit code: N] markers, '
  + 'and report results briefly.'

/** System prompt for the todo_write e2e: nudges the model to plan with the tool. */
/* todo_write 场景的系统提示，要求持续维护完整且及时更新的任务列表。 */
export const TODO_SYSTEM_PROMPT = 'You are a coding agent. For multi-step work, '
  + 'use the todo_write tool to track a task list: send the WHOLE list each call, '
  + 'mark every task being actively worked on in_progress (several at once when '
  + 'work runs in parallel, at least one while work remains), and mark a task '
  + 'completed as soon as it is done.'

/** Options for {@link codingHarness}. */
/* 控制共享编码 Harness 的角色、持久化、压缩和模型上下文容量。 */
export interface CodingHarnessOptions {
  /**
   * Deployment persona for the tree (the system-prompt plugin's `persona`
   * config — per-context, not per-agent). Omitted ⇒ no persona section.
   */
  persona?: string
  /** Durable JSONL persistence root (the resume suite needs it; others stay file-free). */
  persistenceRoot?: string
  /**
   * Load {@link BasicCompactionEngine} with this config so the compaction e2e can
   * trigger compaction at a small, controlled history size. Omitted ⇒ no
   * compaction plugin (the default suites run without it).
   */
  compact?: BasicCompactionConfig
  /** Test-only context capacity advertised for `deepseek-v4-flash`. */
  modelContextWindow?: number
}

/** 在 workdir 中按 options 组装编码 Harness 并返回 Context。示例：await codingHarness(dir, { persona })。 */
export async function codingHarness(workdir: string, options: CodingHarnessOptions = {}): Promise<Context> {
  /** 承载完整 Headless 插件栈的 Cordis 根上下文。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, {
    systemPrompt: { persona: options.persona ?? '' },
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmDeepSeek, options.modelContextWindow === undefined ? {} : {
    models: [{ id: 'deepseek-v4-flash', contextWindow: options.modelContextWindow }],
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { cwd: workdir, timeoutMs: 30_000 })
  await ctx.plugin(ToolBash)
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  // Compaction is opt-in: only the compaction e2e loads the reusable meter and backend.
  if (options.compact !== undefined) {
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ToolResultPruner)
    await ctx.plugin(BasicCompactionEngine, options.compact)
  }
  // Durable JSONL persistence is opt-in: only the resume e2e needs it, and the
  // other suites stay file-free. Loaded last so a resume's deferred
  // `ctx.inject(['sessionPersistence'])` resolves once this is present.
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
    await ctx.plugin(SessionCheckpointPolicy)
  }
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

export function finalText(events: SessionEvent[]): string {
  const message = events.findLast(event => event.type === 'assistant/message')
  if (message?.type !== 'assistant/message') return ''
  return message.data.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}
