/**
 * 文件职责：验证 list-agents.spec.ts 覆盖的子代理工具行为与生命周期。
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
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/list-agents.ts'
import { parkParent } from './park-parent.ts'

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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 中文说明：函数 setupWith 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupWith(adapter: MockAdapter | GatedAdapter) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-list-agents-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
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
    callId: CallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Wait until a continuable child released its current Activation. */
/* 中文说明：函数 waitNoActivation 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

describe('dsh-tool-subagent-control/list-agents', () => {
  it('registers list_agents once, globally, with only the optional scope parameter', async () => {
    const { ctx } = await setup([])
    /** 中文说明：函数值 schemas 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'list_agents')
    expect(schemas).toHaveLength(1)
    /** 中文说明：变量 parameters 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parameters = schemas[0]!.parameters as {
      properties?: Record<string, { enum?: string[] }>
      required?: string[]
    }
    expect(Object.keys(parameters.properties ?? {})).toEqual(['scope'])
    expect(parameters.properties?.scope?.enum).toEqual(['children', 'descendants'])
    expect(parameters.required ?? []).toEqual([])
    expect(schemas[0]!.description).toContain('send_message')
    expect(schemas[0]!.description).toContain('interrupt_agent')
  })

  it('renders the empty result as (no subagents)', async () => {
    const { ctx, parent } = await setup([])
    await ctx.sessions.flush(parent.session)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('(no subagents)')
  })

  it('renders children and diagnostics in array order with registry-derived statuses', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'real child',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    // Pin the render deterministically past the service: the tool is a thin
    // adapter, so its fixed text forms are what this test pins. Status comes
    // from the live Agent registry, stubbed per candidate id.
    /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const entries: SubagentListEntry[] = [
      {
        kind: 'child',
        id: SessionId('one-shot-child'),
        label: 'finished once',
        mode: 'one-shot',
        activity: 'inactive',
        hasChildren: false,
      },
      {
        kind: 'child',
        id: started.childId,
        label: 'real child',
        mode: 'continuable',
        activity: 'inactive',
        hasChildren: false,
      },
      {
        kind: 'child',
        id: SessionId('running-child'),
        label: 'still working',
        mode: 'continuable',
        activity: 'running',
        hasChildren: true,
      },
      {
        kind: 'child',
        id: SessionId('waiting-child'),
        label: 'waiting on descendants',
        mode: 'continuable',
        activity: 'running',
        hasChildren: true,
      },
      { kind: 'diagnostic', id: SessionId('broken-child'), reason: 'corrupt' },
    ]
    ctx.subagents.listChildren = () => Promise.resolve(entries)
    /** 中文说明：变量 agents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agents = new Map<string, { status: 'running' | 'idle' }>([
      ['running-child', { status: 'running' }],
      ['waiting-child', { status: 'idle' }],
    ])
    vi.spyOn(ctx.agents, 'get').mockImplementation(id => agents.get(id) as never)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    // `ready` is the resumable counterpart to a live `running` record, not a
    // claim that the child's conversation ended with a result to collect.
    expect(text(result)).toBe(
      `${started.childId} [ready] — real child\n`
      + 'running-child [running] — still working\n'
      + 'waiting-child [idle] — waiting on descendants\n'
      + 'broken-child [diagnostic: corrupt]',
    )
  })

  it('resolves omitted scope to children and forwards the tool cancellation signal', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    /** 中文说明：变量 listChildren 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listChildren = vi.spyOn(ctx.subagents, 'listChildren').mockResolvedValue([])

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', {}, parent, signal)

    expect(result.isError).toBe(false)
    expect(listChildren).toHaveBeenCalledWith(parent.id, signal)
  })

  it('lists a real settled continuable child and omits a real one-shot sibling', async () => {
    const { ctx, parent } = await setup([textResponse('once'), textResponse('done')])
    /** 中文说明：变量 oneShot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShot = await ctx.subagents.start('spawn', {
      label: 'finished once',
      prompt: [{ type: 'text', text: 'one-shot task' }],
      parent,
      signal: new AbortController().signal,
    })
    await oneShot.result
    await oneShot.dispose()
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'summarize the doc',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', {}, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`${started.childId} [ready] — summarize the doc`)
  })

  it('describes ready as resumable and pins the status vocabulary', async () => {
    const { ctx } = await setup([])
    /** 中文说明：函数值 schema 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'list_agents')
    // Completion reaches the parent through its notice; listing is discovery,
    // so its inactive status must not send the model looking for a result.
    expect(schema?.description).toContain('you are told when one finishes')
    expect(schema?.description).toContain('resumable, not terminal')
    // The enum is the closed vocabulary the model renders, so pin it rather than
    // scanning prose that legitimately reads "not to poll for completion".
    /** 中文说明：变量 variants 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const variants = ctx.tools.get('list_agents')?.output.schema.items?.oneOf ?? []
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = variants.find(variant => variant.properties?.kind?.enum?.includes('child'))
    expect(child?.properties?.status?.enum).toEqual(['running', 'idle', 'ready'])
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', {})
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
    expect(ctx.tools.schemas().some(schema => schema.name === 'list_agents')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'list_agents')).toBe(false)
  })

  it('has the namespace-plugin export shape', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-list-agents')
    expect(tool.inject).toEqual(['tools', 'subagents', 'agents'])
    expect(typeof tool.apply).toBe('function')
  })

  it('walks the complete descendant tree in pre-order with parent and depth annotations', async () => {
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
      label: 'waiting branch',
      request: { prompt: [{ type: 'text', text: 'branch work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'nested leaf',
      request: { prompt: [{ type: 'text', text: 'leaf work' }], parent: child },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    // The branch finishes its own turn but stays resident waiting on the
    // grandchild it owns: the live-registry `idle` status.
    releaseChild.resolve(undefined)
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId)?.status).toBe('idle')
    }, { timeout: 5_000 })

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', { scope: 'descendants' }, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      `${started.childId} [idle] parent=${parent.id} depth=1 — waiting branch\n`
      + `${grandchild.childId} [running] parent=${started.childId} depth=2 — nested leaf`,
    )

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('omits one-shot intermediates from descendants output while surfacing what they own', async () => {
    const { ctx, parent } = await setup([])
    // Deterministic service rows: a one-shot intermediate owning a continuable
    // leaf, plus a positioned diagnostic. The tool filters only the one-shot.
    ctx.subagents.listDescendants = () => Promise.resolve([
      {
        kind: 'child',
        id: SessionId('one-shot-mid'),
        label: 'one-shot intermediate',
        mode: 'one-shot',
        activity: 'inactive',
        hasChildren: true,
        parentId: parent.id,
        depth: 1,
      },
      {
        kind: 'child',
        id: SessionId('deep-leaf'),
        label: 'deep leaf',
        mode: 'continuable',
        activity: 'inactive',
        hasChildren: false,
        parentId: SessionId('one-shot-mid'),
        depth: 2,
      },
      {
        kind: 'diagnostic',
        id: SessionId('broken-node'),
        reason: 'unavailable',
        parentId: parent.id,
        depth: 1,
      },
    ])
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', { scope: 'descendants' }, parent)
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      'deep-leaf [ready] parent=one-shot-mid depth=2 — deep leaf\n'
      + `broken-node [diagnostic: unavailable] parent=${parent.id} depth=1`,
    )
  })

  it('preserves explicit descendants scope and forwards the tool cancellation signal', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    /** 中文说明：变量 listDescendants 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listDescendants = vi.spyOn(ctx.subagents, 'listDescendants').mockResolvedValue([])

    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await callTool(ctx, 'list_agents', { scope: 'descendants' }, parent, signal)

    expect(result.isError).toBe(false)
    expect(listDescendants).toHaveBeenCalledWith(parent.id, signal)
  })
})
