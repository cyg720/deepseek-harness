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
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
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
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('todo/write', { todos: [...todos] })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TodoInvariant).then(() => undefined)).resolves.toBeUndefined()
    expect(() => { session.append('todo/write', { todos: [...todos] }) }).not.toThrow()
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
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    expect(() => { session.append('todo/write', { todos } as never) }).toThrow(message)
  })

  it('ignores unrelated dispatches and session events', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => {
      ctx.emit('tools/change')
      session.append('turn/start', { turn: 1 })
    }).not.toThrow()
  })

  it('rejects a live snapshot outside an open turn before it enters the log', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const before = session.snapshotEvents()

    expect(() => session.append('todo/write', { todos: [] })).toThrow(/outside any open turn/)
    expect(session.snapshotEvents()).toEqual(before)
  })

  it('rejects an existing snapshot outside an open turn on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('todo/write', { todos: [] })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TodoInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })

  it('rejects an invalid existing snapshot on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('todo/write', {
      todos: [
        { content: 'duplicate', status: 'pending' },
        { content: 'duplicate', status: 'completed' },
      ],
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(TodoInvariant).then(() => undefined)).rejects.toThrow(/repeats content "duplicate"/)
  })

  it('validates seeded sessions announced after companion installation', async () => {
    const ctx = await setup()
    const valid = ctx.sessions.create(SessionId('todo-seeded-valid'), { seed: [
      { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
      { type: 'todo/write', seq: SessionSeq(1), time: 2, data: { todos: [] } },
    ] })
    expect(() => valid.append('todo/write', { todos: [] })).not.toThrow()

    expect(() => ctx.sessions.create(SessionId('todo-seeded-invalid'), { seed: [
      { type: 'todo/write', seq: SessionSeq(0), time: 1, data: { todos: [] } },
    ] })).toThrow(/outside any open turn/)
  })

  it('tracks events committed before a prepared session is announced', async () => {
    const ctx = await setup()
    const session = ctx.sessions.prepare(SessionId('todo-prepared'))
    const detach = ctx.sessions.enter(session)
    try {
      session.append('turn/start', { turn: 1 })
      expect(() => session.append('todo/write', { todos: [] })).not.toThrow()
      ctx.sessions.announce(session)
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(() => session.append('todo/write', { todos: [] })).toThrow(/outside any open turn/)
    } finally {
      detach()
    }
  })
})
