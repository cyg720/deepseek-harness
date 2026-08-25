/**
 * 文件职责：验证 workflow-worker-thread.e2e.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import WorkerThreadWorkflowEngine from '../src/index.ts'

/**
 * With-key e2e: a REAL script in a REAL worker thread
 * drives REAL spawn children against the live DeepSeek API — one plain child
 * and one schema'd child through the real structured-output runtime — and
 * the run's value, events, and child sessions are asserted from the outside
 * (never the script's self-report alone). Key-gated (self-skips without
 * DEEPSEEK_API_KEY).
 */

/* 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(): Promise<Context> {
  /** 中文说明：变量 built 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const built = new Context()
  await built.plugin(LlmRuntime)
  await built.plugin(SessionStore)
  await built.plugin(SystemPrompt)
  await built.plugin(ToolRuntime)
  await built.plugin(AgentRegistry)
  await built.plugin(AgentLoop, { agents: [] })
  await built.plugin(LlmDeepSeek)
  await built.plugin(SubagentRuntime)
  await built.plugin(Spawn, { providerName: 'spawn' })
  await built.plugin(WorkerThreadWorkflowEngine, { provider: 'spawn' })
  return built
}

/** 中文说明：常量 META 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const META = {
  name: 'e2e-worker-arithmetic',
  description: 'two real children through a worker thread: one prose, one structured',
  phases: [{ title: 'Ask' }, { title: 'Judge' }],
}
/** 中文说明：常量 SCRIPT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCRIPT = `phase('Ask')
log('asking the prose child')
const prose = await agent('Reply with exactly one short sentence: what is 2 + 2?')
phase('Judge')
const judged = await agent(
  'Here is an answer to the question "what is 2+2": ' + prose
  + ' — report whether it contains the number 4 and your confidence between 0 and 1.',
  { schema: { type: 'object', properties: { containsFour: { type: 'boolean' }, confidence: { type: 'number' } }, required: ['containsFour'] } },
)
return { prose, containsFour: judged === null ? null : judged.containsFour }`

describe.skipIf(!process.env.DEEPSEEK_API_KEY)('worker workflow engine with-key e2e', () => {
  it('runs a two-phase script in a worker thread over real children, one through the structured runtime', async () => {
    ctx = await harness()
    /** 中文说明：变量 parentHandle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentHandle = await ctx.agents.create({
      sessionId: 'wf-worker-e2e-session' as never,
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    })

    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events: string[] = []
    /** 中文说明：变量 childIds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childIds: string[] = []
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const name of ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end'] as const) {
      ctx.on(name, (...payload: unknown[]) => {
        events.push(name)
        if (name === 'workflow/agent-start') childIds.push((payload[1] as { childId: string }).childId)
      })
    }

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = ctx.workflowEngine.start({ script: SCRIPT, meta: META, parent: parentHandle.agent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    await run.dispose()

    expect(result.stopReason).toBe('completed')
    expect(result.agentsStarted).toBe(2)
    /** 中文说明：变量 value 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const value = result.value as { prose: string; containsFour: boolean | null }
    // World checks: the prose child really answered (a real completion), and
    // the structured child judged it against the REAL schema-forced tool.
    expect(value.prose.length).toBeGreaterThan(0)
    expect(value.containsFour).toBe(true)

    expect(events[0]).toBe('workflow/start')
    expect(events.at(-1)).toBe('workflow/end')
    expect(events.filter(name => name === 'workflow/phase').length).toBe(2)
    expect(events.filter(name => name === 'workflow/agent-start').length).toBe(2)
    expect(childIds.length).toBe(2)
    // The children were disposed to quiescence after collection.
    /** 中文说明：该循环依次处理消息或实体；循环变量仅在当前循环中有效。 */
    for (const childId of childIds) {
      expect(ctx.agents.get(SessionId(childId))).toBeUndefined()
    }
    await parentHandle.dispose()
  }, 240_000)
})
