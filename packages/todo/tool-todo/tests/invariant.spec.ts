/**
 * 文件职责：验证 invariant.spec.ts 覆盖的Todo 工具行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Todo 工具能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import * as TodoInvariant from '@deepseek-ai/dsh-tool-todo/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(TodoInvariant)
  return ctx
}

/** 中文说明：函数 event 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function event(todos: unknown): SessionEvent {
  return { type: 'todo/write', seq: 0, time: 0, data: { todos } } as SessionEvent
}

describe('todo snapshot invariants', () => {
  it('accepts historical and live parallel snapshots under the single-active tool policy', async () => {
    /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todos = [
      { content: 'Inspect state', status: 'completed' },
      { content: 'Apply fix', status: 'in_progress' },
      { content: 'Watch background build', status: 'in_progress' },
      { content: 'Run checks', status: 'pending' },
    ] as const
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolTodo, { allowParallelInProgress: false })
    ctx.sessions.create().append('todo/write', { todos: [...todos] })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TodoInvariant).then(() => undefined)).resolves.toBeUndefined()
    expect(() => { ctx.emit('session/event', {} as Session, event(todos)) }).not.toThrow()
  })

  it.each([
    ['not-an-array', /must be an array/],
    [[null], /entries must be objects/],
    [[42], /entries must be objects/],
    [[{ content: 42, status: 'pending' }], /content must be non-empty/],
    [[{ content: '', status: 'pending' }], /content must be non-empty/],
    [[{ content: ' padded ', status: 'pending' }], /already trimmed/],
    [[{ content: 'same', status: 'pending' }, { content: 'same', status: 'completed' }], /repeats content/],
    [[{ content: 'task', status: 42 }], /unknown status/],
    [[{ content: 'task', status: 'paused' }], /unknown status/],
  ])('rejects an incoherent durable todo snapshot', async (todos, message) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, event(todos)) }).toThrow(message)
  })

  it('ignores unrelated dispatches and session events', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', {} as Session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects an invalid existing snapshot on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('todo/write', {
      todos: [
        { content: 'duplicate', status: 'pending' },
        { content: 'duplicate', status: 'completed' },
      ],
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TodoInvariant).then(() => undefined)).rejects.toThrow(/repeats content "duplicate"/)
  })
})
