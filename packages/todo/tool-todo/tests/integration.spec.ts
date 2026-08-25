/**
 * 文件职责：验证 integration.spec.ts 覆盖的Todo 工具行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Todo 工具能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Full-loop integration: a scripted mock model drives the REAL todo_write tool
 * through the agent loop, exercising the same execution paths a live model would — the
 * tool/call + tool/result session events AND the todo/write event the tool
 * appends. Only the model is mocked; the tool and the session log are real.
 */
/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(adapter: MockAdapter): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** 中文说明：函数 waitForIdle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** 中文说明：函数 findEvent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function findEvent<T extends SessionEvent['type']>(
  log: readonly SessionEvent[],
  type: T,
  position: 'first' | 'last' = 'first',
): Extract<SessionEvent, { type: T }> {
  /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const found = position === 'first'
    ? log.find(event => event.type === type)
    : log.findLast(event => event.type === type)
  if (!found) throw new Error(`no ${type} event in the session log`)
  return found as Extract<SessionEvent, { type: T }>
}

describe('todo_write tool through the agent loop', () => {
  it('model calls todo_write: a tool/call, a non-error tool/result, and a todo/write snapshot land', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', {
        todos: [
          { content: 'read the code', status: 'in_progress' },
          { content: 'write the fix', status: 'pending' },
        ],
      }, 'Planning the work.'),
      textResponse('Plan recorded.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-todo'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan a two-step task' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：变量 log 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const log = agent.session.events
    expect(findEvent(log, 'tool/call').data.name).toBe('todo_write')
    expect(findEvent(log, 'tool/result').data.message.content[0].isError).toBe(false)

    /** 中文说明：变量 todoEvent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todoEvent = findEvent(log, 'todo/write')
    expect(todoEvent.data.todos).toEqual([
      { content: 'read the code', status: 'in_progress' },
      { content: 'write the fix', status: 'pending' },
    ])
  })

  it('a second todo_write replaces the list (last-write-wins on the log)', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new MockAdapter([
      toolCallResponse('call-1', 'todo_write', { todos: [{ content: 'step one', status: 'in_progress' }] }),
      toolCallResponse('call-2', 'todo_write', {
        todos: [
          { content: 'step one', status: 'completed' },
          { content: 'step two', status: 'in_progress' },
        ],
      }),
      textResponse('Done planning.'),
    ])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness(adapter)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = ctx.agentLoop.create(SessionId('it-todo-2'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'plan then update' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    /** 中文说明：函数值 todoEvents 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const todoEvents = agent.session.events.filter(e => e.type === 'todo/write')
    expect(todoEvents).toHaveLength(2)
    expect(findEvent(agent.session.events, 'todo/write', 'last').data.todos).toEqual([
      { content: 'step one', status: 'completed' },
      { content: 'step two', status: 'in_progress' },
    ])
  })
})
