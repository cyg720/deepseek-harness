/**
 * 文件职责：验证 subagent-fork-in-process.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as fork from '../src/index.ts'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'

/** 中文说明：type Script 定义本测试所需的数据或行为，用于表达子代理场景。 */
type Script = ConstructorParameters<typeof MockAdapter>[0]

/** 中文说明：函数 mountInvariants 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function mountInvariants(ctx: Context): Promise<void> {
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
}

/** 中文说明：函数 start 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function start(ctx: Context, provider: string, request: Omit<SubagentStartRequest, 'signal'> & { signal?: AbortSignal }) {
  return ctx.subagents.start(provider, { signal: request.signal ?? new AbortController().signal, ...request })
}

/** A bare `stop` finish that streams no content → the turn ends `completed`
 * with NO `assistant/message` of its own. */
/** 中文说明：变量 emptyStop 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const emptyStop: StreamChunk[] = [{ type: 'finish', reason: { kind: 'stop' } }]

/**
 * Drives the REAL fork backend with a real loop + scripted mock MODEL + the
 * real invariant service and package companions. The session contribution replays a seeded child log on
 * `session/created`, so a malformed (unbalanced) fork seed makes these tests
 * THROW — that is the regression guard for the completed-turn-prefix boundary.
 */
/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(script: Script) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(fork, { providerName: 'fork' })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  /** 中文说明：变量 parent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

/** 中文说明：函数 text 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function text(blocks: { type: string; text?: string }[]): string {
  return blocks.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-subagent-fork-in-process', () => {
  it('emits subagent/start only after the seeded child is published', async () => {
    const { ctx, parent } = await setup([textResponse('child answer')])
    /** 中文说明：变量 childAtStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let childAtStart: ReturnType<typeof ctx.agents.get>
    ctx.on('subagent/start', (info) => {
      if (info.provider === 'fork') childAtStart = ctx.agents.get(info.id)
    })

    /** 中文说明：变量 starting 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const starting = start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child q' }], parent })
    expect(childAtStart).toBeUndefined()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await starting
    expect(childAtStart).toBe(ctx.agents.get(run.id))
    expect(childAtStart?.id).toBe(run.id)

    await run.result
    await run.dispose()
  })

  it('forks an UNSEEDED (fresh) child when the parent has no completed turn', async () => {
    // The parent has never completed a turn → empty prefix → the provider omits
    // the seed → the child runs fresh. Exercises the `seed.length > 0` false arm.
    const { ctx, parent } = await setup([textResponse('fresh child')])
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child q' }], parent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(text(result.output)).toBe('fresh child')
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    // Only the child's own turn — no seeded parent turns.
    expect(child.session.events.filter(e => e.type === 'turn/end')).toHaveLength(1)
    expect(child.session.header.seedLength).toBeUndefined()
    await run.dispose()
  })

  it('seeds every completed parent turn through the last turn/end', async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('second'), textResponse('child')])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'q1' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'q2' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 parentPrefixLen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentPrefixLen = parent.session.events.length

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child q' }], parent })
    await run.result
    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    expect(child.session.header.seedLength).toBe(parentPrefixLen)
    expect(child.session.events.slice(0, parentPrefixLen).at(-1)?.type).toBe('turn/end')
    expect(child.session.events.slice(0, parentPrefixLen).filter(e => e.type === 'turn/end')).toHaveLength(2)
    await run.dispose()
  })

  it('seeds the child with the parent\'s completed-turn prefix (child inherits context)', async () => {
    const { ctx, parent } = await setup([textResponse('parent answer'), textResponse('child answer')])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent question' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 parentPrefixLen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentPrefixLen = parent.session.events.length

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child question' }], parent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(text(result.output)).toBe('child answer')

    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    // The child's log STARTS with the parent's prefix (seeded), then its own turn.
    expect(child.session.events.length).toBeGreaterThan(parentPrefixLen)
    // The seeded prefix carried the parent's user message.
    /** 中文说明：函数值 seededUser 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const seededUser = child.session.events.slice(0, parentPrefixLen).find(e => e.type === 'user/message')
    expect(seededUser).toBeDefined()
    // Lineage stamped.
    expect(child.session.header.parentSession).toBe(parent.session.header.id)
    // The seed boundary is recorded on the header (= the seeded prefix length),
    // so a reload / replay harness can tell the inherited prefix from the
    // child's own events.
    expect(child.session.header.seedLength).toBe(parentPrefixLen)
    await run.dispose()
  })

  it('produces an invariant-CLEAN seed: forking mid-turn excludes the open turn', async () => {
    // Drive the parent so it has one completed turn, then start a SECOND turn that is still
    // open (a hanging model call), and fork while it's in flight. The seed must stop after the
    // balanced first turn; including the open turn would fail invariant replay during start.
    const { ctx, parent } = await setup([textResponse('done'), 'hang', textResponse('child')])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'q1' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    // Start a second turn that hangs (open turn/start + open step, never ends).
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'q2' }], source: { kind: 'user' } }))
    await new Promise(r => setTimeout(r, 20)) // let the hanging turn open

    // Forking now must NOT throw (the open second turn is excluded from the seed).
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child q' }], parent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(text(result.output)).toBe('child')

    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = ctx.agents.get(run.id)!
    // The child's seed has exactly the ONE completed parent turn (the open one excluded).
    /** 中文说明：函数值 seedTurnEnds 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const seedTurnEnds = child.session.events.filter(e => e.type === 'turn/end')
    // 1 from the seeded parent turn + 1 from the child's own completed turn.
    expect(seedTurnEnds.length).toBe(2)

    parent.cancel({ kind: 'user' })
    await run.dispose()
  })

  it('captures structured output through the shipped plugin (seeded child, driver runtime)', async () => {
    const { ctx, parent } = await setup([
      textResponse('parent turn'),
      toolCallResponse('c1', STRUCTURED_OUTPUT_TOOL, { answer: 9 }),
    ])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'warm up' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', {
      prompt: [{ type: 'text', text: 'report structured' }],
      parent,
      outputSchema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] },
    })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.structured).toEqual({ answer: 9 })
    // Run-scoped runtime: nothing stays registered after the settle.
    expect(ctx.tools.get(STRUCTURED_OUTPUT_TOOL)).toBeUndefined()
    await run.dispose()
  })

  it('does NOT return the seeded parent output when the child produces no message of its own', async () => {
    // `readResult` must scan only child-owned events after the seed. The child emits no assistant
    // message, so scanning the whole log would incorrectly return the parent's distinctive text.
    const { ctx, parent } = await setup([textResponse('parent stale'), emptyStop])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent question' }], source: { kind: 'user' } }))
    await parent.whenIdle()

    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'child question' }], parent })
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await run.result
    // The child completed its own (empty) turn — completed, but with NO output
    // borrowed from the seeded parent prefix.
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([])
    await run.dispose()
  })

  it('advertises every start-time capability (depthLimit, outputSchema, toolFilter, persona)', async () => {
    const { ctx } = await setup([])
    expect(ctx.subagents.getProvider('fork')!.capabilities).toEqual({ outputSchema: true, depthLimit: true, toolFilter: true, persona: true })
  })

  it('unregisters the provider when its fiber is disposed (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(AgentRegistry)
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin(fork, { providerName: 'fork' })
    expect(ctx.subagents.list()).toEqual(['fork'])
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })

  it('contributes the completed-turn prefix as a continuable child\'s seed', async () => {
    const { ctx, parent } = await setup([textResponse('parent turn'), textResponse('child answer')])
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = ctx.subagents.getProvider('fork')!
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal

    // Before any completed parent turn there is nothing to inherit, so the
    // child starts fresh rather than carrying an empty seed.
    /** 中文说明：变量 fresh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fresh = await provider.prepareContinuable!({
      sessionId: SessionId('continuable-fresh'),
      parent,
      signal,
    })
    expect(fresh.seed).toBeUndefined()

    // Complete one parent turn, then the prefix is captured once at creation.
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 seeded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seeded = await provider.prepareContinuable!({
      sessionId: SessionId('continuable-seeded'),
      parent,
      signal,
    })
    expect(seeded.seed).toBeDefined()
    /** 中文说明：变量 lastSeeded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lastSeeded = seeded.seed!.at(-1)
    // The seed ends at a completed turn, so it replays as a valid child log.
    expect(lastSeeded?.type).toBe('turn/end')
    expect(seeded.seed!.map(event => event.seq)).toEqual(seeded.seed!.map((_event, index) => index))
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in fork).toBe(false)
    expect(fork.name).toBe('subagent-fork-in-process')
    expect(fork.inject).toEqual(['subagents'])
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    /** 中文说明：变量 unwrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unwrapped = loader.unwrapExports(fork) as Record<string, unknown>
    expect(unwrapped).toBe(fork)
    expect(unwrapped.name).toBe('subagent-fork-in-process')
    expect(unwrapped.inject).toEqual(['subagents'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
