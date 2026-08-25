/**
 * 文件职责：验证 continuation.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import type { GenerateOptions, MessageId, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime, {
  SubagentError,
  SUBAGENT_DESCRIPTOR_VERSION,
} from '../src/index.ts'
import type { SubagentRunEndInfo, SubagentRunInfo } from '../src/index.ts'
import * as SubagentInvariant from '../src/invariant.ts'

/** 中文说明：type Script 定义本测试所需的数据或行为，用于表达子代理场景。 */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** One scripted response that may wait on a caller-released gate before streaming. */
/** 中文说明：interface GatedEntry 定义本测试所需的数据或行为，用于表达子代理场景。 */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
/** 中文说明：class GatedAdapter 定义本测试所需的数据或行为，用于表达子代理场景。 */
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
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const chunk of entry.chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

// Each persistence-backed temp root cleans up by closing its handle before
// removing the directory: Windows rmSync over a dir holding a still-open handle
// fails with EPERM.
/** 中文说明：函数值 cleanups 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  /** 中文说明：变量 errors 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const errors: unknown[] = []
  /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
  for (const cleanup of cleanups.splice(0)) {
    try { await cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'temp-root cleanup failed')
})

/** Boot the full continuable stack: loop, persistence, providers, and subagents. */
/** 中文说明：函数 setupWith 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setupWith(adapter: LlmAdapter, options: { persistence?: boolean } = {}) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  /** 中文说明：函数值 disposePersistence 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  let disposePersistence: (() => Promise<void>) | undefined
  /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let root: string | undefined
  if (options.persistence !== false) {
    root = mkdtempSync(join(tmpdir(), 'dsh-subagent-continuation-'))
    /** 中文说明：变量 persistedRoot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistedRoot = root
    /** 中文说明：变量 persistenceFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
    disposePersistence = () => persistenceFiber.dispose()
    cleanups.push(async () => {
      await persistenceFiber.dispose()
      rmSync(persistedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], adapter)
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, disposePersistence, root }
}

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(script: Script, options: { persistence?: boolean } = {}) {
  /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const adapter = new MockAdapter(script)
  /** 中文说明：变量 booted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const booted = await setupWith(adapter, options)
  return { ...booted, adapter }
}

/** 中文说明：变量 testSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testSignal = new AbortController().signal

/** 中文说明：函数 startSpec 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function startSpec(parent: Agent, provider = 'spawn', signal: AbortSignal = testSignal) {
  return {
    provider,
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal,
  }
}

/** 中文说明：函数 message 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function message(text: string) {
  return [{ type: 'text' as const, text }]
}

/** 中文说明：函数 hasUserText 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function hasUserText(events: readonly SessionEvent[], text: string): boolean {
  return events.some(event => event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text === text))
}

/** Caller-supplied user message texts in log order (runtime-context snapshots excluded). */
/** 中文说明：函数 userTexts 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function userTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
    ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : [])
}

/** 中文说明：函数 followup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function followup(
  ctx: Context,
  parent: Agent,
  childId: SessionId,
  content: ReturnType<typeof message>,
  signal: AbortSignal = testSignal,
) {
  return ctx.subagents.followup(parent, childId, content, {
    source: { kind: 'user' },
    signal,
  })
}

/**
 * Exercise manager-wide teardown through the package-private owner rather than
 * adding the irreversible operation to the public service contract.
 */
/** 中文说明：函数 drainManager 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function drainManager(ctx: Context): Promise<void> {
  /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const manager = (ctx.subagents as unknown as {
    continuations?: { drain(): Promise<void> }
  }).continuations
  if (manager === undefined) throw new Error('expected a bound continuation manager')
  return manager.drain()
}

/** Wait until a child's Activation is gone, i.e. its handle finished disposal. */
/** 中文说明：函数 waitNoActivation 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

/**
 * Keep the top-level test parent out of a scripted model corpus. Every child
 * settlement wakes its parent, so a suite that scripts only child responses
 * would otherwise spend them on the parent's own turns.
 */
/** 中文说明：函数 parkParent 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function parkParent(ctx: Context, parent: Agent): void {
  ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
    if (subject !== parent) return next()
    return { kind: 'reject' as const }
  })
}

/** Observe calls at the Agent cancellation boundary without a production event. */
/** 中文说明：函数 observeCancel 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function observeCancel(agent: Agent, callback: () => void): void {
  /** 中文说明：变量 cancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const cancel = agent.cancel.bind(agent)
  /** 中文说明：变量 observed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let observed = false
  vi.spyOn(agent, 'cancel').mockImplementation((cause, options) => {
    if (!observed) {
      observed = true
      callback()
    }
    cancel(cause, options)
  })
}

describe('SubagentRuntime.startContinuable', () => {
  it('returns both identities at inbox acceptance, without waiting for the turn or the log', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('first answer')])
    /** 中文说明：变量 enqueued 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const enqueued: { id: MessageId; loggedYet: boolean }[] = []
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      // Acceptance is the boundary `startContinuable` resolves at, so observe
      // the log state exactly there rather than after later microtasks.
      enqueued.push({ id: message.id, loggedYet: hasUserText(agent.session.events, 'child task') })
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))

    expect(started.childId).toMatch(/[0-9a-f-]{36}/)
    // The returned id is exactly the accepted inbox message's id, and nothing
    // was logged or requested to earn it.
    expect(enqueued).toEqual([{ id: started.messageId, loggedYet: false }])
    expect(adapter.requests).toEqual([])

    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'child task')).toBe(true)
  })

  it('uses a caller-reserved child identity and rejects a duplicate reservation', async () => {
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('reserved answer'), gate: release.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 reservedId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reservedId = SessionId('00000000-0000-4000-8000-000000000123')

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      ...startSpec(parent),
      childId: reservedId,
    })
    expect(started.childId).toBe(reservedId)
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      childId: reservedId,
    })).rejects.toMatchObject({ code: 'DUPLICATE_CHILD' })

    release.resolve(undefined)
    await waitNoActivation(ctx, reservedId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(reservedId)
    expect(loaded.meta.id).toBe(reservedId)

    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      childId: reservedId,
    })).rejects.toMatchObject({ code: 'DUPLICATE_CHILD' })
    expect(ctx.agents.get(reservedId)).toBeUndefined()
  })

  it('rejects without ids when the provider has no prepareContinuable capability', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：函数值 start 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const start = vi.fn(async () => { throw new Error('must not dispatch') })
    ctx.subagents.registerProvider({
      name: 'one-shot',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start,
    })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'one-shot')))
      .rejects.toThrow(/does not support continuable children/)
    expect(start).not.toHaveBeenCalled()
    // No child Agent and no session were created.
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('rejects synchronously when persistence is not configured', async () => {
    const { ctx, parent } = await setup([textResponse('unused')], { persistence: false })
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toThrow(/require session persistence/)
  })

  it('publishes the reserved child id and appends the pre-turn descriptor', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 descriptorIndex 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const descriptorIndex = loaded.events.findIndex(event => event.type === 'subagent/descriptor')
    /** 中文说明：函数值 turnStartIndex 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const turnStartIndex = loaded.events.findIndex(event => event.type === 'turn/start')
    expect(descriptorIndex).toBeGreaterThanOrEqual(0)
    expect(descriptorIndex).toBeLessThan(turnStartIndex)
    /** 中文说明：变量 descriptor 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descriptor = loaded.events[descriptorIndex] as SessionEvent<'subagent/descriptor'>
    expect(descriptor.data).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'child task',
      agentProvider: 'mock',
      agentModel: 'mock',
    })
    // Model-hidden: the descriptor never carries surface metadata.
    expect('surfaceOp' in descriptor).toBe(false)
    expect(loaded.meta.id).toBe(started.childId)
    expect(loaded.meta.parentSession).toBe(SessionId('parent'))
    expect(loaded.meta.origin).toBe('subagent')
  })

  it('rolls the child back completely when the caller signal aborts before acceptance', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    // Abort inside the child's creation window: setup runs before publication.
    ctx.on('agent/created', ({ agent: child }) => {
      if (child !== parent) controller.abort('caller gave up')
    })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'spawn', controller.signal)))
      .rejects.toThrow()
    // No Activation, no live child Agent, and no parent ownership remains.
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
  })

  it('rolls the child back when the signal aborts between publication and acceptance', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    // `subagent/start` fires once the epoch is resident, before the prompt is
    // submitted, so cancelling here lands squarely in the handoff window.
    ctx.on('subagent/start', () => { controller.abort('caller gave up') })

    await expect(ctx.subagents.startContinuable(startSpec(parent, 'spawn', controller.signal)))
      .rejects.toThrow()

    // No resident child and no queued turn survive the abort.
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
  })

  it('rolls an unpublished Activation back when lifecycle publication fails', async () => {
    const { ctx, parent } = await setup([textResponse('unused')])
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', info => void ends.push(info))
    ctx.on('internal/dispatch', (_mode, eventName) => {
      if (eventName === 'subagent/start') throw new Error('start publication failed')
    }, { global: true })

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toThrow(/start publication failed/)

    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
    })
    expect(ends).toEqual([])
    await expect(drainManager(ctx)).resolves.toBeUndefined()
  })

  it('rejects a continuable child that would exceed the configured depth cap', async () => {
    const { ctx, parent } = await setup([])
    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: { prompt: message('deep'), parent, maxDepth: 0 },
    })).rejects.toThrow(/exceeds maxDepth 0/)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('rejects an invalid continuable depth cap before provider preparation', async () => {
    const { ctx, parent } = await setup([])
    await expect(ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: { prompt: message('deep'), parent, maxDepth: Number.NaN },
    })).rejects.toThrow(/non-negative safe integer/)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([SessionId('parent')])
  })

  it('omits undeclared composition fields from the descriptor', async () => {
    const { ctx } = await setup([])
    // A routeless parent declares no provider/model, and this start declares no
    // persona or tool filter, so the descriptor records only what exists.
    /** 中文说明：变量 routeless 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const routeless = ctx.agentLoop.create(SessionId('routeless'), {})
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(routeless))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    /** 中文说明：函数值 descriptor 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const descriptor = child.session.events.find(event => event.type === 'subagent/descriptor')

    expect(descriptor?.data).toEqual({
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label: 'child task',
    })
    await drainManager(ctx)
  })

  it('records a declared tool filter in the descriptor', async () => {
    const { ctx } = await setup([])
    // Register one global tool so the filter names something real.
    ctx.tools.register(defineTool({
      name: 'noop',
      description: 'does nothing',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {} },
        render: () => [{ type: 'text', text: 'noop' }],
      },
      execute: () => Promise.resolve({}),
    }))
    /** 中文说明：变量 routeless 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const routeless = ctx.agentLoop.create(SessionId('routeless-filtered'), {})
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      ...startSpec(routeless),
      request: { prompt: message('filtered work'), parent: routeless, toolFilter: { deny: ['noop'] } },
    })
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })

    expect(child.session.events.find(event => event.type === 'subagent/descriptor')?.data)
      .toEqual({
        version: SUBAGENT_DESCRIPTOR_VERSION,
        mode: 'continuable',
        provider: 'spawn',
        label: 'child task',
        toolFilter: { deny: ['noop'] },
      })
    await drainManager(ctx)
  })

  it('cold-resumes without inventing a model route the descriptor never declared', async () => {
    const { ctx, root } = await setup([textResponse('first')])
    /** 中文说明：变量 routeless 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const routeless = ctx.agentLoop.create(SessionId('routeless-resume'), {})
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(routeless))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 fresh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fresh = new Context()
    await mountAgentLoopTestDependencies(fresh)
    /** 中文说明：变量 freshPersistence 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const freshPersistence = await fresh.plugin(JsonlSessionPersistence, { root: root! })
    // This context opened a second handle on the same root; register it so
    // afterEach closes it before removing the root (even on a failure path).
    cleanups.push(async () => { await freshPersistence.dispose() })
    await fresh.plugin(AgentLoop, { agents: [] })
    await fresh.plugin(SubagentRuntime)
    await fresh.plugin(SubagentSpawn, { providerName: 'spawn' })
    /** 中文说明：变量 freshParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const freshParent = fresh.agentLoop.create(SessionId('routeless-resume'), {})
    await followup(fresh, freshParent, started.childId, message('resume routeless'))

    /** 中文说明：函数值 resumed 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const resumed = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = fresh.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    expect(resumed.options.provider).toBeUndefined()
    expect(resumed.options.model).toBeUndefined()
    await drainManager(fresh)
  })

  it('continues turn numbering after an inherited fork prefix and pre-turn descriptor', async () => {
    const { ctx, parent } = await setup([
      textResponse('parent turn'),
      textResponse('forked child'),
    ])
    // Complete one parent turn so fork has a prefix to contribute.
    parent.followup(createUserMessage({ content: message('parent work'), source: { kind: 'user' } }))
    await parent.whenIdle()

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent, 'fork'))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 descriptorIndex 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const descriptorIndex = loaded.events.findIndex(event => event.type === 'subagent/descriptor')
    /** 中文说明：变量 childTurn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childTurn = loaded.events.slice(descriptorIndex + 1)
      .find(event => event.type === 'turn/start')
    // The first child turn after the descriptor continues the inherited prefix
    // rather than restarting at 1, so the replayed child log stays balanced.
    expect(descriptorIndex).toBeGreaterThanOrEqual(0)
    expect(childTurn?.type === 'turn/start' && childTurn.data.turn).toBe(2)
    expect(loaded.meta.seedLength).toBeGreaterThan(0)
  })

  it('records the declared persona in the descriptor and reapplies it on cold resume', async () => {
    const { ctx, parent } = await setup([textResponse('scoped'), textResponse('resumed')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: {
        prompt: message('scoped work'),
        parent,
        persona: 'You are scoped.',
      },
    })
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    /** 中文说明：函数值 descriptor 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const descriptor = loaded.events.find(event => event.type === 'subagent/descriptor')
    expect(descriptor?.data).toMatchObject({ persona: 'You are scoped.' })

    // Cold resume reconstructs the declared composition from that descriptor.
    await followup(ctx, parent, started.childId, message('resume it'))
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(resumed.events, 'resume it')).toBe(true)
  })
})

describe('SubagentRuntime.followup residency routing', () => {
  it('enqueues in the same Activation while it is running, preserving one inbox FIFO', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
      { chunks: textResponse('third') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)
    expect(child?.status).toBe('running')

    // Both messages queue behind the open turn, in call order.
    /** 中文说明：变量 firstMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const firstMessage = await followup(ctx, parent, started.childId, message('first follow-up'))
    /** 中文说明：变量 secondMessage 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const secondMessage = await followup(ctx, parent, started.childId, message('second follow-up'))
    expect(firstMessage).not.toBe(secondMessage)
    // Still the same Activation: no second child Agent was created.
    expect(ctx.agents.get(started.childId)).toBe(child)

    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'first follow-up', 'second follow-up'])
  })

  it('cold-resumes a settled child into a new Activation', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 messageId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messageId = await followup(ctx, parent, started.childId, message('continue please'))
    expect(messageId).toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'continue please'])
    // One descriptor only: cold resume never re-seeds it.
    expect(loaded.events.filter(event => event.type === 'subagent/descriptor')).toHaveLength(1)
  })

  it('cold-resumes after the initial provider unregisters', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SubagentInvariant)
    /** 中文说明：变量 disposeProvider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeProvider = ctx.subagents.registerProvider({
      name: 'retired',
      capabilities: { outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: async () => { throw new Error('one-shot start is not used') },
      prepareContinuable: () => Promise.resolve({}),
    })
    /** 中文说明：变量 starts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const starts: SubagentRunInfo[] = []
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/start', info => void starts.push(info))
    ctx.on('subagent/end', info => void ends.push(info))

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent, 'retired'))
    await waitNoActivation(ctx, started.childId)
    disposeProvider()
    expect(ctx.subagents.getProvider('retired')).toBeUndefined()

    await expect(followup(ctx, parent, started.childId, message('continue without provider')))
      .resolves.toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })

    expect(starts.map(info => info.provider)).toEqual(['retired', 'retired'])
    expect(ends.map(info => info.runId)).toEqual(starts.map(info => info.runId))
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'continue without provider'])
  })

  it('wakes a waiting Activation instead of cold-resuming it', async () => {
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      // The child delegates, then finishes its own turn while the grandchild runs.
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
      { chunks: textResponse('woken') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // The child starts its own continuable grandchild, then goes quiescent.
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThanOrEqual(2) })
    await vi.waitFor(() => {
      expect(child.status).toBe('idle')
      expect(ctx.agents.get(started.childId)).toBe(child)
    }, { timeout: 5_000 })
    // Waiting retains the handle: the same Agent is still live.
    expect(ctx.agents.get(started.childId)).toBe(child)

    await followup(ctx, parent, started.childId, message('while waiting'))
    // Woken back to running on the SAME Activation.
    expect(ctx.agents.get(started.childId)).toBe(child)

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    // This child is itself a parent, so its grandchild's settlement notice is
    // an ordinary later user message in its log.
    expect(userTexts(loaded.events).slice(0, 2)).toEqual(['child task', 'while waiting'])
    expect(userTexts(loaded.events).slice(2).join('\n')).toContain('finished and will do no further work')
  })

  it('rejects a parent that is not the durable direct parent', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 stranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })

    await expect(followup(ctx, stranger, started.childId, message('mine now')))
      .rejects.toThrow(/belongs to another parent session/)
  })

  it('reports an unresumable child whose persisted log has no supported descriptor', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    // A one-shot child has durable identity but no supported continuation state.
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    await run.result
    await ctx.sessions.flush(run.localAgent!.session)
    /** 中文说明：变量 oneShotId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShotId = run.id
    await run.dispose()

    await expect(followup(ctx, parent, oneShotId, message('continue')))
      .rejects.toThrow(/no supported continuation state/)
  })

  it('reports an unknown child id as unavailable', async () => {
    const { ctx, parent } = await setup([])
    await expect(followup(ctx, parent, SessionId('missing'), message('hello')))
      .rejects.toMatchObject({ code: 'NOT_RESUMABLE' })
  })

  it('propagates cancellation while inspecting a cold child', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 inspectStarted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inspectStarted = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 inspect 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect').mockImplementation((_id, signal) => {
      return new Promise<never>((_resolve, reject) => {
        if (signal === undefined) {
          reject(new Error('cold inspection must receive the followup signal'))
          return
        }
        inspectStarted.resolve(undefined)
        signal.addEventListener('abort', () => {
          reject(reason)
        }, { once: true })
      })
    })
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cold inspection cancelled')

    try {
      /** 中文说明：变量 delivery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const delivery = followup(ctx, parent, started.childId, message('cancel me'), controller.signal)
      await inspectStarted.promise
      controller.abort(reason)
      await expect(delivery).rejects.toBe(reason)
    } finally {
      inspect.mockRestore()
    }
  })

  it('preserves a SubagentError raised while cold-materializing a child', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new SubagentError('materialization denied', 'UNAUTHORIZED')
    ctx.agents.resume = () => Promise.reject(failure)

    await expect(followup(ctx, parent, started.childId, message('continue')))
      .rejects.toBe(failure)
  })

  it('cold-resumes a delivery that lost the race with final disposal', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after the race')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Deliver in the same tick the settlement watcher opens its transaction:
    // exactly one side wins the cutoff. A delivery that loses awaits release and
    // cold-resumes rather than reaching a handle being torn down.
    /** 中文说明：函数值 delivery 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const delivery = child.whenIdle().then(() =>
      followup(ctx, parent, started.childId, message('raced')))

    await expect(delivery).resolves.toBeTypeOf('string')
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'raced')).toBe(true)
  })
})

describe('continuable child ownership', () => {
  it('keeps a parent Activation waiting until its child completes disposal', async () => {
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))

    await vi.waitFor(() => {
      expect(child.status).toBe('idle')
      expect(ctx.agents.get(started.childId)).toBe(child)
    }, { timeout: 5_000 })
    // Child-first: the parent handle is retained while the grandchild is live.
    expect(ctx.agents.get(started.childId)).toBe(child)
    expect(ctx.agents.get(grandchild.childId)).toBeDefined()

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('does not add a top-level parent to the waiting graph', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    // The top-level parent remains independently registered after its child settles.
    expect(ctx.agents.get(parent.id)).toBe(parent)
  })
})

describe('continuable durability and teardown', () => {
  it('settles when the best-effort final flush has no listeners', async () => {
    /** 中文说明：变量 releaseResponse 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseResponse = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('unconfirmed answer'), gate: releaseResponse.promise },
    ])
    const { ctx, parent, disposePersistence } = await setupWith(adapter)
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Remove every persistence listener; the final flush is advisory.
    await disposePersistence!()
    releaseResponse.resolve(undefined)

    await waitNoActivation(ctx, started.childId)
    expect(warnings.some(warning => warning.includes('final session flush'))).toBe(false)
  })

  it('logs a failed final flush after every listener settles without failing the Activation', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    /** 中文说明：变量 peerFlushed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let peerFlushed = false
    ctx.logger.warn = (message: string) => { warnings.push(message) }
    ctx.on('subagent/end', info => void ends.push(info))
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) throw new Error('disk full')
    })
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) peerFlushed = true
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    expect(peerFlushed).toBe(true)
    expect(warnings.some(warning => warning.includes('best-effort final session flush failed'))).toBe(true)
    expect(ends.at(-1)?.stopReason).toBe('completed')
  })

  it('logs a teardown failure reached through normal settlement', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = (message: string) => { warnings.push(message) }

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('normal settlement cleanup failed')
    }

    hold.resolve(undefined)

    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => {
      expect(warnings.some(warning => warning.includes('normal settlement cleanup failed'))).toBe(true)
    }, { timeout: 5_000 })
  })

  it('disposes every live Activation forest child-first on manager teardown', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(ctx.agents.get(grandchild.childId)).toBeDefined() })

    /** 中文说明：变量 disposals 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposals: SessionId[] = []
    ctx.on('agent/disposed', ({ agent }) => { disposals.push(agent.id) })
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    // Let the held model call observe its cancellation so quiescence can settle.
    hold.resolve(undefined)
    await drained

    // Child-first: the grandchild's disposal precedes its parent's.
    expect(disposals.indexOf(grandchild.childId)).toBeGreaterThanOrEqual(0)
    expect(disposals.indexOf(grandchild.childId))
      .toBeLessThan(disposals.indexOf(started.childId))
    // Durable sessions survive process-local teardown.
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.id).toBe(started.childId)
  })

  it('drains one parent forest without disabling a sibling parent forest', async () => {
    /** 中文说明：变量 releaseTarget 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseTarget = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseSibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseSibling = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('target child'), gate: releaseTarget.promise },
      { chunks: textResponse('sibling child'), gate: releaseSibling.promise },
      { chunks: textResponse('target grandchild'), gate: releaseGrandchild.promise },
      { chunks: textResponse('sibling follow-up') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 siblingParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const siblingParent = ctx.agentLoop.create(
      SessionId('sibling-parent'),
      { provider: 'mock', model: 'mock' },
    )
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 sibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sibling = await ctx.subagents.startContinuable(startSpec(siblingParent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 targetChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targetChild = ctx.agents.get(target.childId)!
    /** 中文说明：变量 siblingChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const siblingChild = ctx.agents.get(sibling.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(targetChild))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(3) })
    /** 中文说明：变量 cancellations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellations: SessionId[] = []
    observeCancel(targetChild, () => { cancellations.push(targetChild.id) })
    /** 中文说明：变量 grandchildAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    observeCancel(grandchildAgent, () => { cancellations.push(grandchildAgent.id) })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    /** 中文说明：变量 convergedDrain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const convergedDrain = ctx.subagents.drainContinuableDescendants([parent])

    // The scoped cutoff stops only the selected forest. The sibling child stays
    // resident and can accept later work while target cleanup is still blocked.
    expect(cancellations).toEqual([target.childId, grandchild.childId])
    expect(ctx.agents.get(target.childId)).toBe(targetChild)
    expect(ctx.agents.get(grandchild.childId)).toBeDefined()
    expect(ctx.agents.get(sibling.childId)).toBe(siblingChild)
    await expect(followup(ctx, siblingParent, sibling.childId, message('still live')))
      .resolves.toBeTypeOf('string')
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await expect(followup(ctx, parent, target.childId, message('too late')))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseTarget.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await Promise.all([drained, convergedDrain])
    expect(ctx.agents.get(target.childId)).toBeUndefined()
    expect(ctx.agents.get(grandchild.childId)).toBeUndefined()
    expect(ctx.agents.get(sibling.childId)).toBe(siblingChild)
    // The exact root remains closed until its host disposes it, even after all
    // current descendants are gone.
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseSibling.resolve(undefined)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('retains a continuable root while draining only its descendants', async () => {
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
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 cancellations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellations: SessionId[] = []
    /** 中文说明：变量 grandchildAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    observeCancel(grandchildAgent, () => { cancellations.push(grandchildAgent.id) })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([child])

    expect(cancellations).toEqual([grandchild.childId])
    expect(ctx.agents.get(started.childId)).toBe(child)
    releaseGrandchild.resolve(undefined)
    await drained
    expect(ctx.agents.get(grandchild.childId)).toBeUndefined()
    expect(ctx.agents.get(started.childId)).toBe(child)
    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'DRAINING' })

    releaseChild.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('releases only selected direct children', async () => {
    /** 中文说明：变量 releaseTarget 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseTarget = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseSibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseSibling = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('target'), gate: releaseTarget.promise },
      { chunks: textResponse('sibling'), gate: releaseSibling.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 sibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sibling = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 targetAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targetAgent = ctx.agents.get(target.childId)!
    /** 中文说明：变量 siblingAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const siblingAgent = ctx.agents.get(sibling.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(targetAgent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(3) })
    /** 中文说明：变量 cancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancel = vi.spyOn(targetAgent, 'cancel')

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableChildren(parent, [target.childId, target.childId])

    expect(cancel).toHaveBeenCalledWith({ kind: 'parent' })
    expect(ctx.agents.get(sibling.childId)).toBe(siblingAgent)
    releaseTarget.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await drained
    expect(ctx.agents.get(target.childId)).toBeUndefined()
    expect(ctx.agents.get(grandchild.childId)).toBeUndefined()
    expect(ctx.agents.get(sibling.childId)).toBe(siblingAgent)
    releaseSibling.resolve(undefined)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('reports selected-child disposal failures after releasing the child', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('target'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(target.childId)!
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('selected cleanup failed')
    }

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableChildren(parent, [target.childId])
    hold.resolve(undefined)

    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    expect(ctx.agents.get(target.childId)).toBeUndefined()
  })

  it('rejects selected-child teardown through another live parent', async () => {
    /** 中文说明：变量 release 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('target'), gate: release.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = ctx.agentLoop.create(SessionId('other-parent'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    await expect(ctx.subagents.drainContinuableChildren(other, [target.childId]))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(ctx.agents.get(target.childId)).toBeDefined()

    release.resolve(undefined)
    await waitNoActivation(ctx, target.childId)
  })

  it('rejects selected-child teardown through a stale parent identity', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = { ...parent, id: parent.id } as unknown as Agent

    await expect(ctx.subagents.drainContinuableChildren(stale, []))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('finds scoped descendants after an intermediate one-shot Agent leaves the registry', async () => {
    /** 中文说明：变量 releaseIntermediate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseIntermediate = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseDescendant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseDescendant = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('one-shot'), gate: releaseIntermediate.promise },
      { chunks: textResponse('continuable descendant'), gate: releaseDescendant.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot task',
      prompt: message('one-shot task'),
      parent,
      signal: testSignal,
    })
    /** 中文说明：变量 intermediate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const intermediate = run.localAgent
    expect(intermediate).toBeDefined()
    if (intermediate === undefined) throw new Error('spawn must publish a local Agent')
    /** 中文说明：变量 descendant 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descendant = await ctx.subagents.startContinuable(startSpec(intermediate))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })

    /** 中文说明：变量 intermediateId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const intermediateId = intermediate.id
    /** 中文说明：变量 disposingIntermediate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposingIntermediate = run.dispose()
    releaseIntermediate.resolve(undefined)
    await disposingIntermediate
    expect(ctx.agents.get(intermediateId)).toBeUndefined()
    expect(ctx.agents.get(descendant.childId)).toBeDefined()
    /** 中文说明：变量 cancellations 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancellations: SessionId[] = []
    /** 中文说明：变量 descendantAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const descendantAgent = ctx.agents.get(descendant.childId)!
    observeCancel(descendantAgent, () => { cancellations.push(descendantAgent.id) })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([parent])

    expect(cancellations).toEqual([descendant.childId])
    releaseDescendant.resolve(undefined)
    await drained
    expect(ctx.agents.get(descendant.childId)).toBeUndefined()
  })

  it('awaits and rolls back an admitted materialization below a scoped root', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { ownerCtx: Context }
    }).continuations
    /** 中文说明：变量 agents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const agents = manager.ownerCtx.agents
    /** 中文说明：变量 create 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const create = agents.create.bind(agents)
    /** 中文说明：变量 published 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const published = Promise.withResolvers<SessionId>()
    /** 中文说明：变量 releaseMaterialization 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseMaterialization = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 createSpy 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const createSpy = vi.spyOn(agents, 'create').mockImplementation(async (options) => {
      /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handle = await create(options)
      published.resolve(handle.agent.id)
      await releaseMaterialization.promise
      return handle
    })

    try {
      /** 中文说明：变量 starting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const starting = ctx.subagents.startContinuable(startSpec(parent))
      /** 中文说明：变量 childId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const childId = await published.promise
      /** 中文说明：变量 drainResolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      let drainResolved = false
      /** 中文说明：函数值 drained 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const drained = ctx.subagents.drainContinuableDescendants([parent]).then(() => {
        drainResolved = true
      })
      await Promise.resolve()
      expect(drainResolved).toBe(false)

      releaseMaterialization.resolve(undefined)
      await expect(starting).rejects.toMatchObject({ code: 'DRAINING' })
      await drained
      expect(ctx.agents.get(childId)).toBeUndefined()
    } finally {
      createSpy.mockRestore()
    }
  })

  it('ignores a stale scoped root without disabling its live same-id Agent', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = { ...parent, id: parent.id } as unknown as Agent

    await ctx.subagents.drainContinuableDescendants([stale])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))

    await waitNoActivation(ctx, started.childId)
  })

  it('reports a scoped teardown failure after releasing the selected branch', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('target child'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped child reap failed')
    }

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    hold.resolve(undefined)

    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('rejects new materialization and delivery once draining begins', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await drainManager(ctx)

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await expect(followup(ctx, parent, started.childId, message('too late')))
      .rejects.toMatchObject({ code: 'DRAINING' })
  })

  it('rejects an initial prompt when drain starts after materialization', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 drains 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drains: Promise<void>[] = []
    /** 中文说明：变量 accepted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const accepted: MessageId[] = []
    ctx.on('subagent/start', () => { drains.push(drainManager(ctx)) })
    ctx.on('agent/inbox/inserted', ({ message }) => { accepted.push(message.id) })

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await Promise.all(drains)

    expect(accepted).toEqual([])
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('waits for a published materialization to finish rollback before drain resolves', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    /** 中文说明：变量 drains 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drains: Promise<void>[] = []
    ctx.on('agent/created', ({ agent: child }) => {
      if (child === parent) return
      /** 中文说明：函数值 draining 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const draining = drainManager(ctx).then(() => { order.push('drain') })
      drains.push(draining)
    })
    ctx.on('agent/disposed', ({ agent: child }) => {
      if (child !== parent) order.push('disposed')
    })

    // `agent/created` runs after registry publication but before materialize()
    // receives the handle and installs the Activation.
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await Promise.all(drains)

    expect(order).toEqual(['disposed', 'drain'])
    expect(ctx.agents.list()).toEqual([parent])
  })

  it('admits a live follow-up before a later drain can begin disposal', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'before drain')) {
        order.push('enqueue')
      }
    })
    observeCancel(child, () => { order.push('cancel') })

    /** 中文说明：变量 delivery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delivery = followup(ctx, parent, started.childId, message('before drain'))
    // Let the child-lock operation reach the live admission cutoff. Admission
    // and inbox submission must then complete in one synchronous span.
    await Promise.resolve()
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)

    await expect(delivery).resolves.toBeTypeOf('string')
    await drained
    expect(order).toEqual(['enqueue', 'cancel'])
  })

  it('has no automatic replay for an accepted but unlogged message', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('first'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Accepted into the inbox, but this queued turn never opens.
    await followup(ctx, parent, started.childId, message('never logged'))

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    // Only what actually reached the log is reconstructable.
    expect(hasUserText(loaded.events, 'never logged')).toBe(false)
  })
})

describe('continuable review regressions', () => {
  it('rechecks exact parent liveness after cold-resume materialization', async () => {
    const { ctx } = await setup([textResponse('first')])
    /** 中文说明：变量 parentId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentId = SessionId('replaceable-parent')
    /** 中文说明：变量 originalParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originalParent = await ctx.agents.create({
      sessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(originalParent.agent))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { ownerCtx: Context }
    }).continuations
    /** 中文说明：变量 ownerAgents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ownerAgents = manager.ownerCtx.agents
    /** 中文说明：变量 originalResume 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const originalResume = ownerAgents.resume.bind(ownerAgents)
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseResume 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseResume = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 resumeSpy 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const resumeSpy = vi.spyOn(ownerAgents, 'resume').mockImplementation(async (options) => {
      /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const handle = await originalResume(options)
      resumed.resolve(undefined)
      await releaseResume.promise
      return handle
    })

    /** 中文说明：变量 delivery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const delivery = followup(
      ctx,
      originalParent.agent,
      started.childId,
      message('must not cross parent replacement'),
    )
    await resumed.promise
    await originalParent.dispose()
    /** 中文说明：变量 replacement 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replacement = await ctx.agents.create({
      sessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    releaseResume.resolve(undefined)

    await expect(delivery).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    resumeSpy.mockRestore()
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'must not cross parent replacement')).toBe(false)
    await replacement.dispose()
  })

  it('clears the accepted reservation when Agent.followup throws', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { accepted: Set<MessageId> }>
      }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!
    /** 中文说明：变量 realFollowup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realFollowup = child.followup.bind(child)
    child.followup = () => {
      throw new Error('synthetic inbox failure')
    }

    await expect(followup(ctx, parent, started.childId, message('throws')))
      .rejects.toThrow(/synthetic inbox failure/)
    expect(activation.accepted.size).toBe(0)

    child.followup = realFollowup
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained
  })

  it('reports the child\'s own terminal reason, not teardown success', async () => {
    // The child hits its token ceiling; teardown still succeeds.
    const { ctx, parent } = await setupWith(new MockAdapter([
      [{ type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'partial' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
        { type: 'finish', reason: { kind: 'max-tokens' } }],
    ]))
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Deriving this from disposal success would report the failure as completed.
    expect(ends[0]!.stopReason).toBe('max-tokens')
  })

  it('rejects a live delivery whose caller signal aborted before admission', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 before 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const before = child.session.events.length

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('caller gave up')
    await expect(followup(ctx, parent, started.childId, message('cancelled'), controller.signal))
      .rejects.toThrow()

    // Nothing was enqueued, so no later turn can carry it.
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'cancelled')).toBe(false)
    expect(before).toBeGreaterThan(0)
  })

  it('reports this epoch\'s own output, captured while the child was still live', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    parkParent(ctx, parent)
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Handle disposal unregisters the child, so the edge's content must have
    // been captured before that — an after-the-fact lookup would find nothing.
    expect(ends[0]!.lastAssistantMessage).toEqual([{ type: 'text', text: 'first answer' }])

    // A cold resume is a new epoch: it must report its OWN answer, never the
    // previous epoch's, which the replayed transcript still contains.
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })
    expect(ends[1]!.lastAssistantMessage).toEqual([{ type: 'text', text: 'second answer' }])
  })

  it('keeps the epoch\'s earlier text past a final empty usage-only message', async () => {
    // A tool-only max-tokens step records an empty assistant/message for
    // usage. The terminal event retains the previous assistant content,
    // including its tool call but not the intervening tool result.
    const { ctx, parent } = await setup([
      toolCallResponse('t1', 'noop', {}, 'partial one'),
      [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: CallId('t2'), name: 'noop', argumentsDelta: '{}' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('t2'), name: 'noop', arguments: '{}' } },
        { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'max-tokens' } },
      ],
    ])
    ctx.tools.register(defineTool({
      name: 'noop',
      description: 'does nothing',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {} },
        render: () => [{ type: 'text', text: 'noop' }],
      },
      execute: () => Promise.resolve({}),
    }))
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('max-tokens')
    expect(ends[0]!.lastAssistantMessage).toEqual([
      { type: 'text', text: 'partial one' },
      { type: 'tool-call', id: 't1', name: 'noop', arguments: '{}' },
    ])
  })

  it('reports a resumed epoch that opened no turn without the previous answer', async () => {
    const { ctx, parent } = await setup([textResponse('first answer')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })
    // Block the resumed prompt so this epoch produces nothing of its own.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' }
    })
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Reading the whole session would resurrect 'first answer' here. The
    // rejection discarded the claimed follow-up, so the epoch reads as refused.
    expect(ends[0]!.lastAssistantMessage).toBeUndefined()
    expect(ends[0]!.stopReason).toBe('refusal')
  })

  it('reports handle-disposal failure on the terminal edge', async () => {
    const { ctx, parent } = await setup([textResponse('answer')])
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    /** 中文说明：函数值 activation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const activation = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = manager.activations.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped cleanup failed')
    }

    await expect(drainManager(ctx)).rejects.toThrow()
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    // Emitting before disposal would have reported this failed epoch as success.
    expect(ends[0]!.stopReason).toBe('error')
  })

  it('reports a pre-disposal teardown failure on the terminal edge', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', info => void ends.push(info))

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { observer: { capture: (child: Agent) => void } }>
      }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!
    activation.observer.capture = () => { throw new Error('capture failed') }

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('error')
  })

  it('preserves independent pre-disposal and handle-disposal failures', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, {
          handle: { dispose: () => Promise<void> }
          observer: { capture: (child: Agent) => void }
        }>
      }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = activation.handle.dispose.bind(activation.handle)
    activation.observer.capture = () => { throw new Error('capture failed') }
    activation.handle.dispose = async () => {
      await realDispose()
      throw new Error('scoped cleanup failed')
    }

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    /** 中文说明：函数值 failure 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const failure = await drained.catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    expect(String(failure)).toContain('capture failed')
    expect(String(failure)).toContain('scoped cleanup failed')
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('cancels a running turn before the best-effort final flush', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('slow'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 order 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const order: string[] = []
    ctx.on('session/flush', (session) => {
      if (session.header.parentSession !== undefined) order.push('flush')
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    observeCancel(child, () => { order.push('cancel') })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained

    // Flushing a still-running turn cannot cover the events cancellation adds.
    expect(order.indexOf('cancel')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('cancel')).toBeLessThan(order.lastIndexOf('flush'))
  })

  it('releases an accepted message that is discarded instead of run', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    // Queue a turn, then cancel so it is discarded rather than dequeued. The
    // Activation must still reach settlement instead of waiting on that id.
    await followup(ctx, parent, started.childId, message('discarded'))

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained

    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'discarded')).toBe(false)
  })

  it('settles after a delivery discarded inside its own admission window', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!

    // Cancel from the synchronous enqueue observer: the discard fires after the
    // id is recorded but before `followup()` returns.
    /** 中文说明：函数值 off 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const off = child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'doomed')) {
        child.cancel({ kind: 'user' })
      }
    })
    await followup(ctx, parent, started.childId, message('doomed'))
    off()

    releaseFirst.resolve(undefined)
    // Retaining the discarded id would pin residency at `running` forever, so
    // reaching no-Activation without an explicit drain is the assertion.
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'doomed')).toBe(false)
  })

  it('releases older ids discarded during a later admission window', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: {
        activations: Map<SessionId, { accepted: Set<MessageId> }>
      }
    }).continuations
    /** 中文说明：变量 activation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const activation = manager.activations.get(started.childId)!

    await followup(ctx, parent, started.childId, message('queued'))
    expect(activation.accepted.size).toBe(1)
    /** 中文说明：函数值 off 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const off = child.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'doomed')) {
        child.cancel({ kind: 'user' })
      }
    })
    await followup(ctx, parent, started.childId, message('doomed'))
    off()

    expect(activation.accepted.size).toBe(0)
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('reports a prompt a pre-step rejection discarded as refusal', async () => {
    const { ctx, parent } = await setup([])
    parkParent(ctx, parent)
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })
    // A UserPromptSubmit deny or a policy plugin: the child claims its prompt,
    // the rejection discards it, and no step ever runs.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' }
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    // The parent would otherwise believe a vetoed delivery was done and never
    // resend it — the one failure the settlement promise says cannot happen.
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('refusal')
  })

  it('retains the Activation while an accepted message is still in the inbox', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 registeredAtEnqueue 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registeredAtEnqueue: boolean[] = []
    // A synchronous inbox observer runs before the admitting microtask, the
    // exact window where `Agent.status` is still idle.
    ctx.on('agent/inbox/inserted', ({ agent }) => {
      if (agent.session.header.parentSession !== undefined) {
        registeredAtEnqueue.push(ctx.agents.get(agent.id) === agent)
      }
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)
    await followup(ctx, parent, started.childId, message('queued'))

    expect(registeredAtEnqueue.length).toBeGreaterThan(0)
    expect(registeredAtEnqueue).not.toContain(false)
    expect(ctx.agents.get(started.childId)).toBe(child)
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    // Two child turns; the third request is the parent's own turn on the
    // settlement notice.
    expect(adapter.requests.filter(request => request.sessionId === started.childId)).toHaveLength(2)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'queued')).toBe(true)
  })
})

/** Every settlement notice this agent received, in order, as flat text. */
/** 中文说明：函数 settlementNotices 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function settlementNotices(agent: Agent): { sender: string; text: string; summary: string }[] {
  /** 中文说明：函数值 logged 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const logged = agent.session.events.flatMap(event => event.type === 'user/message' ? [event.data] : [])
  return [...logged, ...agent.inbox.nextStep, ...agent.inbox.nextTurn].flatMap((message) => {
    if (message.source.kind !== 'subagent-settled') return []
    return [{
      sender: message.source.senderSessionId,
      summary: message.source.summary,
      text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
    }]
  })
}

describe('continuable report delivery', () => {
  it('wakes an idle parent for a next-step report', async () => {
    /** 中文说明：变量 releaseChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('child answer'), gate: releaseChild.promise },
      { chunks: textResponse('parent report ack') },
      { chunks: textResponse('parent settlement ack') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.sessionId === started.childId)).toHaveLength(1)
    })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)
    expect(child).toBeDefined()

    /** 中文说明：变量 messageId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const messageId = await ctx.subagents.reportFrom(child!, message('an explicit report'), {
      delivery: 'next-step',
      signal: testSignal,
    })

    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.sessionId === parent.id)).toHaveLength(1)
    })
    /** 中文说明：函数值 report 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const report = parent.session.events.flatMap(event => event.type === 'user/message'
      && event.data.source.kind === 'subagent-report' ? [event.data] : [])[0]
    expect(report?.id).toBe(messageId)

    releaseChild.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.sessionId === parent.id)).toHaveLength(2)
    })
  })
})

describe('continuable settlement delivery', () => {
  it('tells the parent what the child finished with, without being asked', async () => {
    const { ctx, parent } = await setup([textResponse('the answer'), textResponse('parent ack')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    /** 中文说明：变量 notice 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notice = settlementNotices(parent)[0]!
    expect(notice.sender).toBe(started.childId)
    expect(notice.text).toBe(
      `Background subagent ${started.childId} finished and will do no further work unless you send it more.`
      + '\nIts closing message:\nthe answer',
    )
    // The collapsed row states the outcome without the child's content.
    expect(notice.summary).toBe(
      `Background subagent ${started.childId} finished and will do no further work unless you send it more.`,
    )
  })

  it('delivers even when the child already reported for itself', async () => {
    const { ctx, parent } = await setup([textResponse('the answer'), textResponse('parent ack')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = ctx.agents.get(started.childId)
      expect(live).toBeDefined()
      return live!
    })
    await ctx.subagents.reportFrom(child, message('an explicit report'), {
      delivery: 'quiet',
      signal: testSignal,
    })
    await waitNoActivation(ctx, started.childId)

    // The contract is unconditional precisely so the parent-side tool
    // description can promise it; bookkeeping "did it report?" would make the
    // promise conditional on a channel this manager does not own.
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
  })

  it('delivers the terminal reason when the child never had a chance to report', async () => {
    const { ctx, parent } = await setup([maxTokensResponse('half an ans'), textResponse('parent ack')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} ran out of room before it finished.`
      + '\nIts closing message:\nhalf an ans',
    )
  })

  it('tells the parent a policy-rejected delivery was declined, not finished', async () => {
    const { ctx, parent } = await setup([textResponse('parent ack')])
    // A pre-step rejection on the child — a UserPromptSubmit deny, a policy
    // plugin — discards the claimed prompt without running it.
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === parent) return next()
      return { kind: 'reject' }
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} declined the task.`
      + '\nIt left no closing message.',
    )
  })

  it('reports a turn that failed before reaching its first step', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('the answer'), gate: releaseFirst.promise },
      { chunks: textResponse('parent ack') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    // The shipped durability checkpoint (`dsh-session-checkpoint-policy`) is
    // fail-closed at the step boundary, so a rejected write ends the turn after
    // it claimed its messages and before it entered a step.
    ctx.on('agent/pre-step', async ({ agent: subject, turn }, next) => {
      if (subject.session.header.parentSession === undefined || turn < 2) return next()
      throw new Error('ENOSPC: no space left on device')
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await followup(ctx, parent, started.childId, message('second task'))
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    // The parent must not be told the child finished: the delivery it is still
    // waiting on was claimed out of the inbox and then swallowed by the failure.
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(child.events, 'second task')).toBe(false)
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} failed before it finished.`
      + '\nIts closing message:\nthe answer',
    )
  })

  it('reports accepted work cut short before its first step as stopped', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseCheckpoint = Promise.withResolvers<undefined>()
    /** 中文说明：变量 atCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const atCheckpoint = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('the answer'), gate: releaseFirst.promise }])
    const { ctx, parent } = await setupWith(adapter)
    // A step-boundary participant — the shipped durability checkpoint, a hook,
    // prompt assembly — holding the child's second turn open before its first
    // step, which is where teardown cancellation then catches it.
    ctx.on('agent/pre-step', async ({ agent: subject, turn }, next) => {
      if (subject.session.header.parentSession === undefined || turn < 2) return next()
      atCheckpoint.resolve(undefined)
      await releaseCheckpoint.promise
      return next()
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    // Queued while turn 1 still runs, so turn 2 opens and claims it without a
    // second model call: the Activation is mid-turn when the drain cancels it.
    await followup(ctx, parent, started.childId, message('second task'))
    releaseFirst.resolve(undefined)
    await atCheckpoint.promise
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    releaseCheckpoint.resolve(undefined)
    await drained

    // Turn 2 leaves a balanced no-step `aborted` end, so the log alone would
    // answer with turn 1's clean completion and tell the parent its still-unrun
    // task had finished.
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} was stopped before it finished.`
      + '\nIts closing message:\nthe answer',
    )
  })

  it('reports a child stopped before it ever reached the model as stopped', async () => {
    /** 中文说明：变量 releaseCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseCheckpoint = Promise.withResolvers<undefined>()
    /** 中文说明：变量 atCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const atCheckpoint = Promise.withResolvers<undefined>()
    const { ctx, parent } = await setupWith(new GatedAdapter([]))
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject.session.header.parentSession === undefined) return next()
      atCheckpoint.resolve(undefined)
      await releaseCheckpoint.promise
      return next()
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await atCheckpoint.promise
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    releaseCheckpoint.resolve(undefined)
    await drained

    // This epoch closed no stepped turn at all, which on its own reads as "had
    // nothing to report"; only the interruption distinguishes it from a child
    // that genuinely finished with no output.
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} was stopped before it finished.`
      + '\nIt left no closing message.',
    )
  })

  it('reports a child an ancestor interrupted before its first step as stopped', async () => {
    /** 中文说明：变量 atCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const atCheckpoint = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseCheckpoint 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseCheckpoint = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('parent ack') }])
    const { ctx, parent } = await setupWith(adapter)
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject.session.header.parentSession === undefined) return next()
      atCheckpoint.resolve(undefined)
      await releaseCheckpoint.promise
      return next()
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await atCheckpoint.promise
    // The shipped interrupt path: nothing about it runs inside this manager, so
    // no pre-cancel sample could see it — the child's own log has to say so.
    ctx.subagents.interrupt(started.childId, { kind: 'ancestor', agent: parent })
    releaseCheckpoint.resolve(undefined)
    await waitNoActivation(ctx, started.childId)

    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} was stopped before it finished.`
      + '\nIt left no closing message.',
    )
  })

  it('reports accepted work cancelled before any turn could open as stopped', async () => {
    /** 中文说明：变量 releaseChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseGrandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseGrandchild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseMaintenance 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseMaintenance = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('the answer'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = ctx.agents.get(started.childId)
      expect(live).toBeDefined()
      return live!
    })
    // A descendant keeps the child resident once its own turn closes, so the
    // maintenance phase below is reachable without racing settlement.
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(ctx.agents.get(grandchild.childId)).toBeDefined() })
    releaseChild.resolve(undefined)
    await vi.waitFor(() => { expect(child.status).toBe('idle') })

    // Context maintenance folds into `idle` and defers waking work, so this
    // delivery is accepted with no turn to claim it.
    /** 中文说明：函数值 maintaining 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const maintaining = child.runMaintenance(async () => { await releaseMaintenance.promise })
    await followup(ctx, parent, started.childId, message('never runs'))
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    releaseMaintenance.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await maintaining
    await drained

    // Turn 1 closed cleanly and no later turn opened, so the cancelled queue is
    // the only record that this epoch was cut short.
    expect(hasUserText(child.session.events, 'never runs')).toBe(false)
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} was stopped before it finished.`
      + '\nIts closing message:\nthe answer',
    )
  })

  it('withholds an outcome the harness could not durably release', async () => {
    const { ctx, parent } = await setup([textResponse('the answer'), textResponse('parent ack')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose(): Promise<void> } }> }
    }).continuations
    /** 中文说明：函数值 activation 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const activation = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = manager.activations.get(started.childId)
      expect(live).toBeDefined()
      return live!
    })
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = activation.handle.dispose.bind(activation.handle)
    activation.handle.dispose = async () => {
      await dispose()
      throw new Error('scope unwind failed')
    }

    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(1) })
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} failed before it finished.\nIt left no closing message.`,
    )
  })

  it('gives an idle parent one ordinary turn on the notice', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('the answer'), textResponse('parent ack')])
    /** 中文说明：变量 turnStarts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turnStarts: number[] = []
    ctx.on('session/event', (session, event) => {
      if (session.id === parent.id && event.type === 'turn/start') turnStarts.push(event.data.turn)
    })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => {
      expect(adapter.requests.filter(request => request.sessionId === parent.id)).toHaveLength(1)
    })
    expect(turnStarts).toEqual([1])
  })

  it('batches simultaneous notices into one step of a busy parent', async () => {
    /** 中文说明：变量 releaseChildren 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChildren = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseParent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseParent = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('parent works'), gate: releaseParent.promise },
      { chunks: textResponse('first child'), gate: releaseChildren.promise },
      { chunks: textResponse('second child'), gate: releaseChildren.promise },
      { chunks: textResponse('parent reacts') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    // Open a parent turn first, so both notices arrive while it is running.
    parent.followup(createUserMessage({ content: message('start working'), source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(parent.status).toBe('running') })

    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await ctx.subagents.startContinuable(startSpec(parent))
    releaseChildren.resolve(undefined)
    await waitNoActivation(ctx, first.childId)
    await waitNoActivation(ctx, second.childId)

    // Both notices are waiting for the same step boundary, not two turns.
    expect(parent.inbox.nextStep).toHaveLength(2)
    expect(parent.inbox.nextTurn).toHaveLength(0)
    /** 中文说明：变量 turnStarts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turnStarts: number[] = []
    ctx.on('session/event', (session, event) => {
      if (session.id === parent.id && event.type === 'turn/start') turnStarts.push(event.data.turn)
    })
    releaseParent.resolve(undefined)
    await vi.waitFor(() => { expect(settlementNotices(parent)).toHaveLength(2) })
    expect(turnStarts).toEqual([])
    // Both children released together, so which settles first is not ordered.
    expect(new Set(settlementNotices(parent).map(entry => entry.sender)))
      .toEqual(new Set([first.childId, second.childId]))
  })

  it('holds a maintaining parent live until it can read the notice', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 releaseSecond 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseSecond = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('outer') },
      { chunks: textResponse('first inner'), gate: releaseFirst.promise },
      { chunks: textResponse('second inner'), gate: releaseSecond.promise },
      { chunks: textResponse('outer reacts') },
      { chunks: textResponse('root reacts') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 outer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outer = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 middle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const middle = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = ctx.agents.get(outer.childId)
      expect(live).toBeDefined()
      return live!
    })
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = await ctx.subagents.startContinuable(startSpec(middle))
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = await ctx.subagents.startContinuable(startSpec(middle))
    await vi.waitFor(() => { expect(middle.status).toBe('idle') })

    // `Agent.status` folds maintenance into `idle`, and a waking send behind it
    // only arms a deferred wake. The first child's release moves the middle
    // Activation's settlement watcher onto its quiescence race; the second one
    // then arrives at exactly the point where an unaccounted delivery would be
    // judged quiet, settled, and cancelled — clearing the inbox it sits in.
    /** 中文说明：变量 maintaining 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const maintaining = Promise.withResolvers<undefined>()
    /** 中文说明：函数值 maintenance 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const maintenance = middle.runMaintenance(async () => { await maintaining.promise })
    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, first.childId)
    releaseSecond.resolve(undefined)
    await waitNoActivation(ctx, second.childId)
    expect(ctx.agents.get(outer.childId)).toBe(middle)

    maintaining.resolve(undefined)
    await maintenance
    await vi.waitFor(() => { expect(settlementNotices(middle)).toHaveLength(2) })
    expect(settlementNotices(middle).map(entry => entry.sender))
      .toEqual([first.childId, second.childId])
    await waitNoActivation(ctx, outer.childId)
  })

  it('delivers before releasing the ownership that lets the parent settle', async () => {
    /** 中文说明：变量 releaseChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('outer') },
      { chunks: textResponse('inner'), gate: releaseChild.promise },
      { chunks: textResponse('outer reacts') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 outer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outer = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 middle 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const middle = await vi.waitFor(() => {
      /** 中文说明：变量 live 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const live = ctx.agents.get(outer.childId)
      expect(live).toBeDefined()
      return live!
    })
    /** 中文说明：变量 inner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const inner = await ctx.subagents.startContinuable(startSpec(middle))
    await vi.waitFor(() => { expect(middle.status).toBe('idle') })

    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { ownedChildren: Set<SessionId> }> }
    }).continuations
    /** 中文说明：变量 ownedAtDelivery 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let ownedAtDelivery: SessionId[] | undefined
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (agent !== middle || message.source.kind !== 'subagent-settled') return
      ownedAtDelivery = [...manager.activations.get(middle.id)!.ownedChildren]
    })

    releaseChild.resolve(undefined)
    await waitNoActivation(ctx, inner.childId)
    // Still owned at delivery: the parent is structurally unable to settle in
    // the window the notice crosses, rather than winning a race against it.
    expect(ownedAtDelivery).toEqual([inner.childId])
    await waitNoActivation(ctx, outer.childId)
  })

  it('does not wake a parent whose own teardown already began', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('interrupted'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeDefined() })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await drained

    // Delivered and durably logged, but no turn: waking a parent the host is
    // about to dispose spends a model request nothing reads. What happens to the
    // message when that parent is disposed next is pinned by the test below.
    expect(settlementNotices(parent)).toHaveLength(1)
    expect(settlementNotices(parent)[0]!.text).toBe(
      `Background subagent ${started.childId} was stopped before it finished.`
      + '\nIt left no closing message.',
    )
    expect(parent.session.events.some(event => event.type === 'agent/inbox/spliced')).toBe(true)
    expect(parent.session.events.some(event => event.type === 'turn/start')).toBe(false)
    expect(parent.status).toBe('idle')
  })

  it('does not wake a parent below a scoped teardown root', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('interrupted'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeDefined() })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    hold.resolve(undefined)
    await drained

    expect(settlementNotices(parent)).toHaveLength(1)
    expect(parent.session.events.some(event => event.type === 'turn/start')).toBe(false)
  })

  it('records but cannot deliver a teardown notice once the parent is disposed too', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('interrupted'), gate: hold.promise }])
    const { ctx } = await setupWith(adapter)
    /** 中文说明：变量 parentId 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentId = SessionId('closing-parent')
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = await ctx.agents.create({
      sessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(host.agent))
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeDefined() })

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([host.agent])
    hold.resolve(undefined)
    await drained
    expect(settlementNotices(host.agent)).toHaveLength(1)

    // Disposal is a `keepInbox: false` cancel, so it durably cancels the notice
    // it never claimed. Teardown delivery therefore reaches a parent that is
    // still resident — a resumed one reads the log, not a pending message — and
    // no wording anywhere may promise otherwise.
    await host.dispose()
    /** 中文说明：变量 resumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resumed = await ctx.agents.resume({
      resumeSessionId: parentId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(settlementNotices(resumed.agent)).toEqual([])
    await resumed.dispose()
    // The account is still in the durable log: delivered, then cancelled unread.
    /** 中文说明：变量 persisted 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persisted = await ctx.sessionPersistence.load(parentId)
    expect(persisted.events.flatMap(event => event.type === 'agent/inbox/spliced'
      ? [{ inserted: event.data.inserted.length, removed: event.data.removedCount ?? 0 }]
      : [])).toEqual([{ inserted: 1, removed: 0 }, { inserted: 0, removed: 1 }])
  })

  it('drops the notice without disturbing teardown when the parent is gone', async () => {
    /** 中文说明：变量 releaseChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseChild = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('answer'), gate: releaseChild.promise }])
    const { ctx } = await setupWith(adapter)
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = (text: string) => { warnings.push(text) }
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = await ctx.agents.create({
      sessionId: SessionId('disposable-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(host.agent))
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    releaseChild.resolve(undefined)
    await host.dispose()
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(warnings).toEqual([])
  })

  it('logs a rejected notice instead of failing the child\'s teardown', async () => {
    const { ctx, parent } = await setup([textResponse('the answer')])
    /** 中文说明：变量 warnings 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const warnings: string[] = []
    ctx.logger.warn = (text: string) => { warnings.push(text) }
    vi.spyOn(parent, 'followup').mockImplementation(() => {
      throw new Error('parent closed during delivery')
    })
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })
    expect(ends[0]!.stopReason).toBe('completed')
    expect(warnings.some(warning => warning.includes('settlement notice was not delivered'))).toBe(true)
  })

  it('stays silent about a child the caller was told does not exist', async () => {
    const { ctx, parent } = await setup([])
    /** 中文说明：变量 drains 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drains: Promise<void>[] = []
    ctx.on('subagent/start', () => { drains.push(drainManager(ctx)) })

    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    await Promise.all(drains)
    expect(settlementNotices(parent)).toEqual([])
  })
})

describe('continuable lifecycle observation', () => {
  it('emits one paired start/end per residency epoch', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('second')])
    parkParent(ctx, parent)
    /** 中文说明：变量 starts 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const starts: SubagentRunInfo[] = []
    /** 中文说明：变量 ends 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ends: SubagentRunEndInfo[] = []
    ctx.on('subagent/start', (info) => { starts.push(info) })
    ctx.on('subagent/end', (info) => { ends.push(info) })

    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(1) })

    // A cold resume is a NEW epoch with its own pair.
    await followup(ctx, parent, started.childId, message('again'))
    await waitNoActivation(ctx, started.childId)
    await vi.waitFor(() => { expect(ends).toHaveLength(2) })

    expect(starts).toHaveLength(2)
    expect(starts.map(info => info.id)).toEqual([started.childId, started.childId])
    expect(starts.map(info => info.provider)).toEqual(['spawn', 'spawn'])
    // Each end pairs its own start's runId.
    expect(ends.map(info => info.runId)).toEqual(starts.map(info => info.runId))
    // Both epochs ran their own scripted response; neither exhausted the corpus.
    expect(ends.map(info => info.stopReason)).toEqual(['completed', 'completed'])
  })
})

describe('continuable public API', () => {
  it('exposes no host authority, residency query, cancellation, steering, or report operation', async () => {
    const { ctx } = await setup([])
    /** 中文说明：变量 subagents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const subagents: Record<string, unknown> = ctx.subagents as unknown as Record<string, unknown>
    /** 中文说明：该循环依次处理代理事件；循环变量仅在当前循环中有效。 */
    for (const absent of [
      'activationState',
      'cancel',
      'kill',
      'report',
      'resume',
      'steer',
      'steerContinuable',
      'userAuthority',
    ]) {
      expect(subagents[absent]).toBeUndefined()
    }
    // No steering tool and no report tool are registered by this seam.
    /** 中文说明：函数值 names 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('report')
    expect(names).not.toContain('steer_subagent')
  })

  it('keeps one-shot runs free of a steering capability', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    expect('steer' in run).toBe(false)
    await run.result
    await run.dispose()
  })

  it('reports a caller-signal abort before acceptance without delivering', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('caller gave up')
    await expect(followup(ctx, parent, started.childId, message('aborted'), controller.signal))
      .rejects.toThrow()

    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'aborted')).toBe(false)
  })

  it('does not cancel an accepted turn when the caller signal aborts afterwards', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    await followup(ctx, parent, started.childId, message('survives'), controller.signal)
    // After acceptance the manager owns the Activation independently.
    controller.abort('caller gave up')

    releaseFirst.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(hasUserText(loaded.events, 'survives')).toBe(true)
  })
})

describe('continuable errors', () => {
  it('rejects a duplicate Activation at the agent registry collision boundary', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Drop the Activation without disposing the Agent, leaving the id live but
    // unmanaged. Materialization must not adopt it.
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, unknown> }
    }).continuations
    manager.activations.delete(started.childId)

    await expect(followup(ctx, parent, started.childId, message('hello')))
      .rejects.toThrow(SubagentError)
    expect(ctx.agents.get(started.childId)).toBe(child)
    hold.resolve(undefined)
  })

  it('rejects a parent that is no longer the live registry entry', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    // A stale parent reference: same id, not the exact live entry.
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = { ...parent, id: parent.id } as unknown as Agent

    await expect(followup(ctx, stale, started.childId, message('stale')))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    void child
  })

  it('rejects establishing a child under a parent whose disposal already began', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('child'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })

    // Begin the parent Activation's teardown, then try to give it a child.
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'DRAINING' })
    hold.resolve(undefined)
    await drained
  })

  it('reports a failing branch after every branch settles, without pinning the rest', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('child done') },
      { chunks: textResponse('grandchild'), gate: hold.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(started.childId)
      expect(found).toBeDefined()
      return found!
    })
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(ctx.agents.get(grandchild.childId)).toBeDefined() })
    // Make the grandchild's own handle disposal reject: scope teardown failure
    // propagates, unlike a contained `agent/disposed` listener throw.
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { handle: { dispose: () => Promise<void> } }> }
    }).continuations
    /** 中文说明：变量 branch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const branch = manager.activations.get(grandchild.childId)!
    /** 中文说明：变量 realDispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const realDispose = branch.handle.dispose.bind(branch.handle)
    branch.handle.dispose = async () => {
      await realDispose()
      throw new Error('grandchild reap failed')
    }

    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = drainManager(ctx)
    hold.resolve(undefined)
    await expect(drained).rejects.toMatchObject({ code: 'ACTIVATION_TEARDOWN_FAILED' })
    // The other branch still released, and durable sessions survive.
    expect(ctx.agents.get(started.childId)).toBeUndefined()
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.id).toBe(started.childId)
  })

  it('rolls the transfer back when ownership registration fails after handle transfer', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('parent child'), gate: hold.promise },
      { chunks: textResponse('unused') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 outer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const outer = await ctx.subagents.startContinuable(startSpec(parent))
    /** 中文说明：函数值 child 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const child = await vi.waitFor(() => {
      /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const found = ctx.agents.get(outer.childId)
      expect(found).toBeDefined()
      return found!
    })
    // Begin the would-be parent's disposal, then race a grandchild into it. The
    // handle transfers before ownership registration rejects, so the rollback
    // must leave no Activation and no live Agent behind.
    /** 中文说明：变量 manager 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const manager = (ctx.subagents as unknown as {
      continuations: { activations: Map<SessionId, { disposal: Promise<void> | undefined }> }
    }).continuations
    /** 中文说明：函数值 before 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const before = new Set(ctx.agents.list().map(agent => agent.id))
    manager.activations.get(outer.childId)!.disposal = Promise.resolve()

    await expect(ctx.subagents.startContinuable(startSpec(child)))
      .rejects.toMatchObject({ code: 'ACTIVATION_CLOSING' })
    await vi.waitFor(() => {
      expect(ctx.agents.list().map(agent => agent.id).filter(id => !before.has(id))).toEqual([])
    })
    hold.resolve(undefined)
  })

  it('reapplies the descriptor model route on cold resume', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('resumed')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable({
      ...startSpec(parent),
      request: {
        prompt: message('routed work'),
        parent,
        agentOptions: { provider: 'mock', model: 'child-model' },
      },
    })
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.events.find(event => event.type === 'subagent/descriptor')?.data)
      .toMatchObject({ agentProvider: 'mock', agentModel: 'child-model' })

    // The resumed Activation runs on the declared route, not the parent's.
    await followup(ctx, parent, started.childId, message('again'))
    await vi.waitFor(() => {
      expect(ctx.agents.get(started.childId)?.options.model).toBe('child-model')
    })
    await waitNoActivation(ctx, started.childId)
  })

  it('unloading the manager drains its live activations', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('child'), gate: hold.promise }])
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-continuation-'))
    /** 中文说明：变量 persistenceFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
    cleanups.push(async () => {
      await persistenceFiber.dispose()
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    /** 中文说明：变量 serviceFiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const serviceFiber = await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    ctx.llm.registerAdapter(['mock'], adapter)
    /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(ctx.agents.get(started.childId)).toBeDefined() })

    // Manager unload uses the same drain, so no child outlives its runtime.
    /** 中文说明：变量 disposal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposal = serviceFiber.dispose()
    hold.resolve(undefined)
    await disposal
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })
})

describe('SubagentRuntime.interrupt', () => {
  it('aborts the current turn durably, parks accepted follow-ups, and resumes them only on a waking send', async () => {
    /** 中文说明：变量 releaseFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const releaseFirst = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([
      { chunks: textResponse('first'), gate: releaseFirst.promise },
      { chunks: textResponse('second') },
      { chunks: textResponse('third') },
      { chunks: textResponse('fourth') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    await followup(ctx, parent, started.childId, message('parked B'))
    await followup(ctx, parent, started.childId, message('parked C'))
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(child, 'cancel')

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })

    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    // Cancellation is cooperative: the held model call observes it on release.
    releaseFirst.resolve(undefined)
    await child.whenIdle()
    // Parked, not resumed: no second model request follows the abort, the
    // accepted follow-ups stay pending, and the same Activation stays resident.
    expect(adapter.requests).toHaveLength(1)
    expect(child.inbox.nextTurn).toHaveLength(2)
    expect(child.status).toBe('idle')
    expect(ctx.agents.get(started.childId)).toBe(child)

    // Only an explicit waking send restores the driver; the parked items then
    // run before it in the existing FIFO order.
    await followup(ctx, parent, started.childId, message('waking D'))
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(userTexts(loaded.events)).toEqual(['child task', 'parked B', 'parked C', 'waking D'])
    /** 中文说明：变量 turnEnds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turnEnds = loaded.events
      .filter(event => event.type === 'turn/end')
      .map(event => (event).data.reason.kind)
    expect(turnEnds).toEqual(['aborted', 'completed', 'completed', 'completed'])
  })

  it('interrupts only the target while its resident descendant keeps running', async () => {
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
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 grandchildAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    /** 中文说明：变量 childCancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childCancel = vi.spyOn(child, 'cancel')
    /** 中文说明：变量 grandchildCancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildCancel = vi.spyOn(grandchildAgent, 'cancel')

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })

    expect(childCancel).toHaveBeenCalledTimes(1)
    releaseChild.resolve(undefined)
    await child.whenIdle()
    // The target parks as a waiting owner; the published descendant was never
    // signalled and keeps its own turn open.
    expect(grandchildCancel).not.toHaveBeenCalled()
    expect(ctx.agents.get(started.childId)).toBe(child)
    expect(ctx.agents.get(grandchild.childId)).toBe(grandchildAgent)

    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
    /** 中文说明：变量 loaded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loaded = await ctx.sessionPersistence.load(grandchild.childId)
    /** 中文说明：变量 turnEnds 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const turnEnds = loaded.events
      .filter(event => event.type === 'turn/end')
      .map(event => (event).data.reason.kind)
    expect(turnEnds).toEqual(['completed'])
  })

  it('authorizes the human address against the live target\'s durable direct parent', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(child, 'cancel')

    expect(() => { ctx.subagents.interrupt(started.childId, {
      kind: 'user',
      parentSessionId: SessionId('stranger'),
    }) }).toThrow(/belongs to another parent session/)
    expect(cancelSpy).not.toHaveBeenCalled()

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    expect(cancelSpy).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    hold.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })

  it('lets a deep exact live ancestor interrupt its descendant with the parent cause', async () => {
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
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 grandchild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchild = await ctx.subagents.startContinuable(startSpec(child))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 grandchildAgent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    /** 中文说明：变量 childCancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childCancel = vi.spyOn(child, 'cancel')
    /** 中文说明：变量 grandchildCancel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const grandchildCancel = vi.spyOn(grandchildAgent, 'cancel')

    // Deep ancestor: the top-level parent interrupts the grandchild.
    ctx.subagents.interrupt(grandchild.childId, { kind: 'ancestor', agent: parent })
    expect(grandchildCancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: true })
    // Direct ancestor: the same authority kind covers the immediate parent.
    ctx.subagents.interrupt(started.childId, { kind: 'ancestor', agent: parent })
    expect(childCancel).toHaveBeenCalledWith({ kind: 'parent' }, { keepInbox: true })

    releaseChild.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('rejects self, sibling, stale, and unrelated ancestor callers without touching the target', async () => {
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
    /** 中文说明：变量 targetStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const targetStart = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = ctx.agents.get(targetStart.childId)!
    /** 中文说明：变量 siblingStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const siblingStart = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    /** 中文说明：变量 sibling 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const sibling = ctx.agents.get(siblingStart.childId)!
    /** 中文说明：变量 stranger 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })
    /** 中文说明：变量 stale 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stale = { ...parent, id: parent.id } as unknown as Agent
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(target, 'cancel')

    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: target }) })
      .toThrow(/cannot interrupt itself/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: sibling }) })
      .toThrow(/not a live descendant/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: stranger }) })
      .toThrow(/not a live descendant/)
    expect(() => { ctx.subagents.interrupt(targetStart.childId, { kind: 'ancestor', agent: stale }) })
      .toThrow(/exact live ancestor/)
    // A stale caller is rejected before target lookup, even for an absent id.
    expect(() => { ctx.subagents.interrupt(SessionId('missing'), { kind: 'ancestor', agent: stale }) })
      .toThrow(/exact live ancestor/)
    expect(cancelSpy).not.toHaveBeenCalled()

    releaseA.resolve(undefined)
    releaseB.resolve(undefined)
    await waitNoActivation(ctx, targetStart.childId)
    await waitNoActivation(ctx, siblingStart.childId)
  })

  it('accepts absent and one-shot ids as no-ops without touching the one-shot Agent', async () => {
    const { ctx, parent } = await setup([textResponse('one shot')])
    ctx.subagents.interrupt(SessionId('missing'), { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(SessionId('missing'), { kind: 'ancestor', agent: parent })

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await ctx.subagents.start('spawn', {
      label: 'one-shot work',
      prompt: message('one-shot work'),
      parent,
      signal: testSignal,
    })
    /** 中文说明：变量 oneShot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oneShot = run.localAgent!
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(oneShot, 'cancel')
    ctx.subagents.interrupt(run.id, { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(run.id, { kind: 'ancestor', agent: parent })
    expect(cancelSpy).not.toHaveBeenCalled()
    await run.result
    await run.dispose()
  })

  it('accepts an interrupt after natural completion', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)
    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    ctx.subagents.interrupt(started.childId, { kind: 'ancestor', agent: parent })
  })

  it('accepts an interrupt that lost the race with disposal without signalling twice', async () => {
    /** 中文说明：变量 hold 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hold = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new GatedAdapter([{ chunks: textResponse('working'), gate: hold.promise }])
    const { ctx, parent } = await setupWith(adapter)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(started.childId)!
    /** 中文说明：变量 cancelSpy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cancelSpy = vi.spyOn(child, 'cancel')

    // Scoped teardown opens the disposal transaction synchronously and issues
    // its own whole-Activation cancel before this call returns.
    /** 中文说明：变量 drained 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    expect(cancelSpy).toHaveBeenCalledTimes(1)

    // Interrupt after the cutoff: accepted no-op, no second signal, no waiting.
    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    expect(cancelSpy).toHaveBeenCalledTimes(1)

    hold.resolve(undefined)
    await drained
  })
})
