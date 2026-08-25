/**
 * 文件职责：验证 tool-todo.spec.ts 覆盖的Todo 工具行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的Todo 工具能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-session'
import { type Agent } from '@deepseek-ai/dsh-agent'

import * as tool from '../src/index.ts'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/**
 * Drives the REAL plugin body: mounts `dsh-tool-todo` on a real `ToolRuntime`
 * and invokes the registered `todo_write` tool through `ctx.tools.execute`,
 * with a fake parent Agent carrying a real `Session` — so the append the tool
 * makes is observable on a genuine session log (only the agent wrapper is a
 * stand-in; the session and the tool are the shipping code).
 */

/** A parent Agent backed by a real Session — the tool reads `agent.session`. */
/* 中文说明：函数 agentWithSession 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function agentWithSession(id = 'parent-1'): Agent & { session: Session } {
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = Session.create(SessionId(id))
  return { id: SessionId(id), session } as unknown as Agent & { session: Session }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(allowParallelInProgress: boolean): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { allowParallelInProgress })
  return ctx
}

/** 中文说明：变量 callCounter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let callCounter = 0
/** 中文说明：函数 callTodo 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function callTodo(ctx: Context, args: unknown, over: { agent?: Agent | undefined } = {}) {
  /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const agent = 'agent' in over ? over.agent : agentWithSession()
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'todo_write',
    arguments: args,
    ...agent ? { agent } : {},
  })
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-todo', () => {
  it('registers a `todo_write` tool whose schema is an array of {content,status}', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：函数值 schema 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schema = ctx.tools.schemas().find(s => s.name === 'todo_write')
    expect(schema).toBeDefined()
    /** 中文说明：变量 props 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['todos'])
    /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todos = props.todos as { type: string; items?: { properties?: Record<string, { type: string; enum?: string[] }> } }
    expect(todos.type).toBe('array')
    /** 中文说明：变量 itemProps 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const itemProps = todos.items?.properties ?? {}
    expect(Object.keys(itemProps).sort()).toEqual(['content', 'status'])
    expect(itemProps.status?.enum).toEqual(['pending', 'in_progress', 'completed'])
  })

  it('appends a todo/write event carrying the whole list to the calling session', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = agentWithSession('writer')
    /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todos: TodoItem[] = [
      { content: 'plan', status: 'in_progress' },
      { content: 'build', status: 'pending' },
    ]
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected todo_write success')
    expect(result.value).toEqual({
      todos,
      counts: { pending: 1, inProgress: 1, completed: 0 },
    })
    expect(text(result)).toContain('1 pending, 1 in progress, 0 completed')

    /** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const event = agent.session.events.findLast(e => e.type === 'todo/write')!
    expect(event.data.todos).toEqual(todos)
  })

  it('stores the trimmed content (the dedupe/length key), not the raw input', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = agentWithSession('trim')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos: [{ content: '  plan the work  ', status: 'pending' }] }, { agent })
    expect(result.isError).toBe(false)

    /** 中文说明：函数值 event 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const event = agent.session.events.findLast(e => e.type === 'todo/write')!
    expect(event.data.todos).toEqual([{ content: 'plan the work', status: 'pending' }])
  })

  it('replaces the list on a second call (last-write-wins on the log)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = agentWithSession('writer-2')
    await callTodo(ctx, { todos: [{ content: 'a', status: 'pending' }] }, { agent })
    await callTodo(ctx, { todos: [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ] }, { agent })

    /** 中文说明：函数值 current 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const current = agent.session.events.findLast(e => e.type === 'todo/write')!.data.todos
    expect(current).toEqual([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
    ])
  })

  it('rejects a malformed status before execute runs (registry arg-validation)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos: [{ content: 'x', status: 'doing' }] })
    expect(result.isError).toBe(true)
  })

  it('rejects a non-array todos argument', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos: 'nope' })
    expect(result.isError).toBe(true)
  })

  it('accepts several in_progress items at once (parallel work)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = agentWithSession('parallel')
    /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todos: TodoItem[] = [
      { content: 'run subagent a', status: 'in_progress' },
      { content: 'run subagent b', status: 'in_progress' },
      { content: 'merge results', status: 'pending' },
    ]
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos }, { agent })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected todo_write success')
    expect(result.value).toEqual({
      todos,
      counts: { pending: 1, inProgress: 2, completed: 0 },
    })
    expect(agent.session.events.findLast(e => e.type === 'todo/write')!.data.todos).toEqual(todos)
  })

  describe('allowParallelInProgress', () => {
    /** 中文说明：变量 parallel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parallel = [
      { content: 'run subagent a', status: 'in_progress' },
      { content: 'run subagent b', status: 'in_progress' },
    ]

    it('false rejects a call marking several items in_progress', async () => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup(false)
      /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const agent = agentWithSession('single-active')
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await callTodo(ctx, { todos: parallel }, { agent })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('at most one task may be in_progress')
      // A rejected call must not reach the durable log.
      expect(agent.session.events.some(e => e.type === 'todo/write')).toBe(false)
    })

    it('false still accepts one active item', async () => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup(false)
      /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const todos: TodoItem[] = [
        { content: 'run subagent a', status: 'in_progress' },
        { content: 'run subagent b', status: 'pending' },
      ]
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await callTodo(ctx, { todos })
      expect(result.isError).toBe(false)
    })

    it('true accepts the very list false rejects', async () => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = await setup(true)
      /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const result = await callTodo(ctx, { todos: parallel })
      expect(result.isError).toBe(false)
    })

    it('instructs the model to keep at most one active, while true instructs parallel', async () => {
      /** 中文说明：变量 single 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const single = await setup(false)
      /** 中文说明：函数值 singleDesc 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const singleDesc = single.tools.schemas().find(s => s.name === 'todo_write')!.description
      expect(singleDesc).toContain('Keep AT MOST ONE todo `in_progress`')
      expect(singleDesc).not.toContain('several at once')

      /** 中文说明：函数值 parallelDesc 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const parallelDesc = (await setup(true)).tools.schemas().find(s => s.name === 'todo_write')!.description
      expect(parallelDesc).toContain('several at once when work genuinely runs in parallel')
      expect(parallelDesc).not.toContain('AT MOST ONE')
    })
  })

  it.each([
    { label: 'empty content', todos: [{ content: '   ', status: 'pending' }], fragment: 'non-empty' },
    { label: 'duplicate content', todos: [{ content: 'dup', status: 'pending' }, { content: 'dup', status: 'completed' }], fragment: 'duplicate' },
    { label: 'unknown item keys', todos: [{ content: 'a', status: 'pending', children: [] }], fragment: 'not a declared property' },
  ])('rejects $label as an isError result', async ({ todos, fragment }) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(fragment)
  })

  it('rejects a non-agent caller (the list has no owning session)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTodo(ctx, { todos: [{ content: 'a', status: 'pending' }] }, { agent: undefined })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('owning agent session')
  })

  it('presents the call with a stable title and the list as raw input', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup(true)
    /** 中文说明：变量 def 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const def = ctx.tools.get('todo_write')!
    /** 中文说明：变量 todos 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const todos = [{ content: 'a', status: 'pending' }]
    expect(def.presentCall?.({ todos })).toEqual({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: todos })
  })

  it('unregisters the tool when its contributing fiber is disposed (HMR-safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(tool, { allowParallelInProgress: true })
    expect(ctx.tools.schemas().some(s => s.name === 'todo_write')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'todo_write')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    // A default export would make Loader unwrap only apply and drop `inject`.
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-todo')
    expect(tool.inject).toEqual(['tools'])

    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-todo')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
