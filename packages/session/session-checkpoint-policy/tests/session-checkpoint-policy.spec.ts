/**
 * 文件职责：验证 session-checkpoint-policy.spec.ts 覆盖的会话持久化行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话持久化状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { ToolCallId, type GenerateOptions, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionPersistence, { type SessionHandle, type SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import * as checkpointPolicy from '../src/index.ts'

/** 中文说明：变量 contexts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const contexts: Context[] = []

// The policy only requires the service's presence; it flushes through
// `ctx.sessions`, so no handle is ever opened in these tests.
class TestPersistence extends SessionPersistence {
  create(): Promise<SessionHandle> { return Promise.reject(new Error('not used')) }
  open(): Promise<SessionHandle> { return Promise.reject(new Error('not used')) }
  flush(): Promise<void> { return Promise.resolve() }
  stat(): Promise<SessionPersistenceSnapshot | undefined> { return Promise.resolve(undefined) }
  list(): Promise<readonly SessionPersistenceSnapshot[]> { return Promise.resolve([]) }
}

/** 中文说明：class RecordingAdapter 定义本测试所需的数据或行为，用于表达会话持久化场景。 */
class RecordingAdapter extends LlmAdapter {
  constructor(private readonly order: string[]) { super() }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.order.push('adapter')
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestPersistence)
  await ctx.plugin(checkpointPolicy)
  return ctx
}

/** 中文说明：函数 drain 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function drain(stream: AsyncIterable<StreamChunk>): Promise<void> {
  /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
  for await (const _chunk of stream) { /* drain */ }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('session-checkpoint-policy request boundary', () => {
  it('awaits the live session checkpoint before constructing the downstream model stream', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('request-checkpoint'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', async () => {
      order.push('flush:start')
      await gate.promise
      order.push('flush:end')
    })
    ctx.llm.registerAdapter(['mock'], new RecordingAdapter(order))

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = drain(ctx.llm.stream({
      provider: 'mock', model: 'mock', messages: [], sessionId: session.id,
    }))
    await Promise.resolve()
    expect(order).toEqual(['flush:start'])
    gate.resolve(undefined)
    await pending
    expect(order).toEqual(['flush:start', 'flush:end', 'adapter'])
  })

  it('delegates a request without a live session without checkpointing', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', () => { order.push('flush') })
    ctx.llm.registerAdapter(['mock'], new RecordingAdapter(order))
    await drain(ctx.llm.stream({ provider: 'mock', model: 'mock', messages: [] }))
    expect(order).toEqual(['adapter'])
  })

  it('delegates an already-detached session id without checkpointing', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', () => { order.push('flush') })
    ctx.llm.registerAdapter(['mock'], new RecordingAdapter(order))
    await drain(ctx.llm.stream({
      provider: 'mock', model: 'mock', messages: [], sessionId: SessionId('detached'),
    }))
    expect(order).toEqual(['adapter'])
  })

  it('does not dispatch the adapter when the checkpoint rejects', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('request-failure'))
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', () => Promise.reject(new Error('disk unavailable')))
    ctx.llm.registerAdapter(['mock'], new RecordingAdapter(order))
    await expect(drain(ctx.llm.stream({
      provider: 'mock', model: 'mock', messages: [], sessionId: session.id,
    }))).rejects.toThrow('disk unavailable')
    expect(order).toEqual([])
  })
})

describe('session-checkpoint-policy tool and step boundaries', () => {
  it('awaits the checkpoint before a top-level tool body', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('tool-checkpoint'))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { session } as Agent
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', async () => {
      order.push('flush:start')
      await gate.promise
      order.push('flush:end')
    })
    ctx.tools.register({
      name: 'write', description: 'side effect', parameters: {},
      output: { schema: { type: 'null' }, render: () => [] },
      execute: async () => { order.push('tool'); return null },
    })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.tools.execute({
      callId: ToolCallId('write-1'), name: 'write', arguments: {}, agent,
      signal: new AbortController().signal,
    })
    await Promise.resolve()
    expect(order).toEqual(['flush:start'])
    gate.resolve(undefined)
    await expect(pending).resolves.toMatchObject({ isError: false })
    expect(order).toEqual(['flush:start', 'flush:end', 'tool'])
  })

  it('does not dispatch when cancellation lands during the tool checkpoint', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('tool-checkpoint-cancel'))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { session } as Agent
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 gate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const gate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', async () => {
      order.push('flush:start')
      await gate.promise
      order.push('flush:end')
    })
    ctx.tools.register({
      name: 'write', description: 'side effect', parameters: {},
      output: { schema: { type: 'null' }, render: () => [] },
      execute: async () => { order.push('tool'); return null },
    })

    /** 中文说明：变量 pending 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const pending = ctx.tools.execute({
      callId: ToolCallId('write-cancelled'), name: 'write', arguments: {}, agent,
      signal: controller.signal,
    })
    await Promise.resolve()
    expect(order).toEqual(['flush:start'])
    controller.abort('cancelled during checkpoint')
    gate.resolve(undefined)

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      isError: true,
      error: {
        message: 'tool call aborted before dispatch',
        info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
      },
    })
    expect(order).toEqual(['flush:start', 'flush:end'])
  })

  it('turns a rejected checkpoint into an error result without running the tool body', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('tool-failure'))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { session } as Agent
    /** 中文说明：变量 ran 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ran = false
    ctx.on('session/flush', () => Promise.reject(new Error('disk unavailable')))
    ctx.tools.register({
      name: 'write', description: 'side effect', parameters: {},
      output: { schema: { type: 'null' }, render: () => [] },
      execute: async () => { ran = true; return null },
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await ctx.tools.execute({
      callId: ToolCallId('write-2'), name: 'write', arguments: {}, agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: disk unavailable' }])
    expect(ran).toBe(false)
  })

  it('reuses the outer checkpoint for a nested tool dispatch', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('nested-tool'))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { session } as Agent
    /** 中文说明：变量 flushes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let flushes = 0
    ctx.on('session/flush', () => { flushes += 1 })
    ctx.tools.register({
      name: 'nested', description: 'nested', parameters: {},
      output: { schema: { type: 'null' }, render: () => [] },
      execute: async () => null,
    })
    await ctx.tools.execute({
      callId: ToolCallId('nested-1'), name: 'nested', arguments: {}, agent,
      parent: Symbol('outer') as never,
      signal: new AbortController().signal,
    })
    expect(flushes).toBe(0)
  })

  it('checkpoints during pre-step processing', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('post-step'))
    /** 中文说明：变量 agent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agent = { session } as Agent
    /** 中文说明：变量 flushed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const flushed: string[] = []
    ctx.on('session/flush', (current) => { flushed.push(current.id) })
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step', { messages: [], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(flushed).toEqual([session.id])
  })
})

describe('session-checkpoint-policy lifecycle', () => {
  it('removes its wrappers when the owning fiber is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TestPersistence)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('disposed-policy'))
    /** 中文说明：变量 flushes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let flushes = 0
    ctx.on('session/flush', () => { flushes += 1 })
    ctx.llm.registerAdapter(['mock'], new RecordingAdapter([]))
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(checkpointPolicy)
    await drain(ctx.llm.stream({ provider: 'mock', model: 'mock', messages: [], sessionId: session.id }))
    expect(flushes).toBe(1)
    await fiber.dispose()
    await drain(ctx.llm.stream({ provider: 'mock', model: 'mock', messages: [], sessionId: session.id }))
    expect(flushes).toBe(1)
  })

  it('keeps the Loader-safe namespace plugin shape', () => {
    expect('default' in checkpointPolicy).toBe(false)
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(checkpointPolicy) as Record<string, unknown>
    expect(unwrapped).toBe(checkpointPolicy)
    expect(unwrapped.name).toBe('session-checkpoint-policy')
    expect(unwrapped.inject).toEqual(['llm', 'sessionPersistence', 'sessions', 'tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
