/**
 * The `todos` projection provider (session-projection RFC knife 4 — the "a
 * fourth domain is just its own registrations" acceptance probe): mounting
 * tool-todo beside the registry serves the whole current list with a
 * consistent asOfSeq (= last event seq); before any write the value is null; a
 * composition without tool-todo has no `todos` key; unmounting tool-todo
 * removes it (HMR safety). The carrier and framework are exercised unmodified.
 */
/*
 * 文件职责：验证 projection.spec.ts 覆盖的Todo 工具行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Todo 工具能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'

interface Bench {
  ctx: Context
  session: Session
  tailProjections(): Promise<{ asOfSeq: number; values: Record<string, unknown> } | undefined>
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(withTodoTool: boolean): Promise<Bench> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  if (withTodoTool) await ctx.plugin(ToolTodo, { allowParallelInProgress: true })
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return {
    ctx,
    session,
    async tailProjections() {
      return ctx.sessionProjections.snapshot(session)
    },
  }
}

/** One paginable message so the tail page is non-degenerate. */
/* 中文说明：函数 seedMessage 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function seedMessage(session: Session): void {
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('todos projection provider', () => {
  it('serves null before the first todo/write', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    seedMessage(bench.session)
    /** 中文说明：变量 projections 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projections = await bench.tailProjections()
    expect(projections?.values.todos).toBeNull()
    expect(projections?.asOfSeq).toBe(bench.session.seq - 1)
  })

  it('serves the latest whole list after writes, asOfSeq = last event seq', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = bench.session
    seedMessage(session)
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first: TodoItem[] = [{ content: 'a', status: 'pending' }]
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ]
    session.append('turn/start', { turn: 1 })
    session.append('todo/write', { todos: first })
    session.append('todo/write', { todos: second })
    /** 中文说明：变量 projections 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projections = await bench.tailProjections()
    // Last-wins: the latest snapshot, whole.
    expect(projections?.values.todos).toEqual(second)
    expect(projections?.asOfSeq).toBe(session.seq - 1)
  })

  it('clears the standing plan on the next turn/start (turn/end keeps it)', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(true)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = bench.session
    seedMessage(session)
    /** 中文说明：变量 list 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const list: TodoItem[] = [{ content: 'done', status: 'completed' }]
    session.append('turn/start', { turn: 1 })
    session.append('todo/write', { todos: list })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect((await bench.tailProjections())?.values.todos).toEqual(list)
    session.append('turn/start', { turn: 2 })
    const cleared = await bench.tailProjections()
    expect(cleared?.values.todos).toBeNull()
    expect(cleared?.asOfSeq).toBe(session.seq - 1)
  })

  it('has no todos key when tool-todo is not composed', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(false)
    seedMessage(bench.session)
    /** 中文说明：变量 projections 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const projections = await bench.tailProjections()
    expect(projections).toBeDefined()
    expect('todos' in (projections?.values ?? {})).toBe(false)
  })

  it('drops the key when the tool-todo fiber unloads (HMR safety)', async () => {
    /** 中文说明：变量 bench 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bench = await harness(false)
    seedMessage(bench.session)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await bench.ctx.plugin(ToolTodo, { allowParallelInProgress: true })
    expect((await bench.tailProjections())?.values.todos).toBeNull()
    await fiber.dispose()
    expect('todos' in ((await bench.tailProjections())?.values ?? {})).toBe(false)
  })
})
