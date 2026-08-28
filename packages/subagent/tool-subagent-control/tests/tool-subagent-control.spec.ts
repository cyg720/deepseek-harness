/**
 * 文件职责：验证 tool-subagent-control.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/index.ts'
import { parkParent } from './park-parent.ts'
import { TestSessionQuery } from './test-session-query.ts'

/** One scripted response that may wait on a caller-released gate before streaming. */
/* 中文说明：interface GatedEntry 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
/* 中文说明：class GatedAdapter 定义本测试所需的数据或行为，用于表达子代理工具场景。 */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private script: GatedEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：变量 entry 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entry = this.script.shift()
    if (!entry) throw new Error('GatedAdapter: script exhausted')
    if (entry.gate) await entry.gate
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const chunk of entry.chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：变量 roots 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const roots: string[] = []
afterEach(() => {
  /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

/** 中文说明：函数 setupWith 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupWith(adapter: MockAdapter | GatedAdapter) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-subagent-control-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(tool)
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  parkParent(ctx, parent)
  return { ctx, parent, adapter }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  return setupWith(new MockAdapter(script))
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** 中文说明：变量 calls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let calls = 0
/** 中文说明：函数 callTool 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: unknown,
  signal: AbortSignal = testToolSignal,
) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Wait until a child's Activation released its handle. */
/* 中文说明：函数 waitNoActivation 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

describe('dsh-tool-subagent-control', () => {
  it('registers send_message once, globally, with the two required parameters', async () => {
    const { ctx } = await setup([])
    /** 中文说明：函数值 schemas 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'send_message')
    expect(schemas).toHaveLength(1)
    /** 中文说明：变量 props 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['message', 'subagent_id'])
    // The continuable path has no Task, so the schema must not promise one.
    expect(schemas[0]!.description).not.toContain('job_output')
    expect(schemas[0]!.description).not.toContain('job id')
    // Follow-up ordering is model-visible: it cannot redirect the open turn.
    expect(schemas[0]!.description).toContain('next turn')
  })

  it('cold-resumes a settled child and reports the queued next turn', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'and then?',
    }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`message queued as the next turn for subagent ${started.childId}`)
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 followUp 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const followUp = loaded.events.findLast(event => event.type === 'user/message')
    // The durable message source records the calling agent without granting authority.
    expect(followUp?.type === 'user/message' && followUp.data.source).toEqual({
      kind: 'coordinator',
      form: 'relay',
      senderSessionId: parent.id,
    })
  })

  it('queues behind an open turn instead of joining it', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('first'), textResponse('second')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'also consider Y',
    }, parent)
    expect(result.isError).toBe(false)

    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 prompts 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    // A follow-up is its own later turn, never steering inside the first one.
    expect(prompts).toEqual(['long work', 'also consider Y'])
  })

  it('reports a delivery failure as an errored, not-delivered result', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'send_message', {
      subagent_id: 'no-such-child',
      message: 'hello?',
    }, parent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unavailable')
  })

  it('rejects a caller that is not the child\'s durable direct parent', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 stranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'mine now',
    }, stranger)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('another parent session')
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'send_message', { subagent_id: 'x', message: 'y' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('unregisters with its plugin fiber (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(tool)
    expect(ctx.tools.schemas().some(schema => schema.name === 'send_message')).toBe(true)
    expect(ctx.tools.schemas().some(schema => schema.name === 'interrupt_agent')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'send_message')).toBe(false)
    expect(ctx.tools.schemas().some(schema => schema.name === 'interrupt_agent')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-control')
    expect(tool.inject).toEqual(['tools', 'subagents'])
    expect(typeof tool.apply).toBe('function')
  })
})

describe('dsh-tool-subagent-control interrupt_agent', () => {
  it('registers interrupt_agent with the single agent_id parameter and current-turn wording', async () => {
    const { ctx } = await setup([])
    /** 中文说明：函数值 schemas 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'interrupt_agent')
    expect(schemas).toHaveLength(1)
    /** 中文说明：变量 props 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['agent_id'])
    expect(schemas[0]!.description).toContain('current turn')
    expect(schemas[0]!.description).toContain('send_message')
  })

  it('interrupts a running direct child with the parent cause, parking its queue', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('held'), gate: releaseFirst.promise },
      { chunks: textResponse('parked answer') },
      { chunks: textResponse('waking answer') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 queued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const queued = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'parked follow-up',
    }, parent)
    expect(queued.isError).toBe(false)
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(child, 'cancel')

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`interrupt requested for agent ${started.childId}`)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseFirst.resolve(undefined)
    await child.whenIdle()
    // Parked, not resumed: the queued follow-up waits for a waking send.
    expect(adapter.requests).toHaveLength(1)
    expect(child.inbox.nextTurn).toHaveLength(1)

    /** 中文说明：变量 waking 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waking = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'wake up',
    }, parent)
    expect(waking.isError).toBe(false)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 prompts 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    expect(prompts).toEqual(['long work', 'parked follow-up', 'wake up'])
  })

  it('lets a deep live ancestor interrupt a descendant it did not directly create', async () => {
    /** 中文说明：变量 releaseChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'grandchild',
      request: { prompt: [{ type: 'text', text: 'grandchild work' }], parent: child },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 grandchildAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(grandchildAgent, 'cancel')

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'interrupt_agent', { agent_id: grandchild.childId }, parent)

    expect(result.isError).toBe(false)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseChild.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('rejects self, sibling, and unrelated callers without touching the target', async () => {
    /** 中文说明：变量 releaseA 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseA = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseB 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseB = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('a'), gate: releaseA.promise },
      { chunks: textResponse('b'), gate: releaseB.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'target',
      request: { prompt: [{ type: 'text', text: 'a' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 sibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sibling = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'sibling',
      request: { prompt: [{ type: 'text', text: 'b' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 targetAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targetAgent = ctx.agents.get(target.childId)!
    /** 中文说明：变量 siblingAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const siblingAgent = ctx.agents.get(sibling.childId)!
    /** 中文说明：变量 stranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(targetAgent, 'cancel')

    /** 中文说明：变量 self 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const self = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, targetAgent)
    expect(self.isError).toBe(true)
    expect(text(self)).toContain('cannot interrupt itself')
    /** 中文说明：变量 fromSibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fromSibling = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, siblingAgent)
    expect(fromSibling.isError).toBe(true)
    expect(text(fromSibling)).toContain('not a live descendant')
    /** 中文说明：变量 fromStranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fromStranger = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, stranger)
    expect(fromStranger.isError).toBe(true)
    expect(text(fromStranger)).toContain('not a live descendant')
    expect(cancelSpy).not.toHaveBeenCalled()

    releaseA.resolve(undefined)
    releaseB.resolve(undefined)
    await waitNoActivation(ctx, target.childId)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('accepts an absent target as a no-op without cold-resuming it', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'settled child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 settled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const settled = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)
    expect(settled.isError).toBe(false)
    expect(text(settled)).toBe(`interrupt requested for agent ${started.childId}`)
    /** 中文说明：变量 unknown 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unknown = await callTool(ctx, 'interrupt_agent', { agent_id: 'no-such-agent' }, parent)
    expect(unknown.isError).toBe(false)
    // No cold resume: the settled target never rematerialized.
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'interrupt_agent', { agent_id: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })
})
