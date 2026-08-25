/**
 * 文件职责：验证 multi-subagent.spec.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import SubagentRuntime, { type SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as fork from '../src/index.ts'

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

/**
 * The two in-process backends coexist on one context: the SAME parent agent
 * delegates to a `spawn` child (fresh) and a `fork` child (seeded with its log),
 * and keeps working itself. This is the multi-provider coexistence the seam
 * exists for — the named registry lets one runtime hold both transports.
 */
/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(script: Script) {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountInvariants(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
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

describe('multi-subagent coexistence (spawn + fork on one context)', () => {
  it('both providers register and coexist', async () => {
    const { ctx } = await setup([])
    expect(ctx.subagents.list().sort()).toEqual(['fork', 'spawn'])
  })

  it('the same parent drives a spawn child AND a fork child, then keeps working', async () => {
    // Script order: parent turn 1, spawn child, fork child, parent turn 2.
    const { ctx, parent } = await setup([
      textResponse('parent turn one'),
      textResponse('spawn child reply'),
      textResponse('fork child reply'),
      textResponse('parent turn two'),
    ])

    // Parent does one real turn first, so the fork has a completed turn to seed.
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent q1' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：变量 parentPrefixLen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentPrefixLen = parent.session.events.length

    // Delegate to a fresh spawn child.
    /** 中文说明：变量 spawnRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnRun = await start(ctx, 'spawn', { prompt: [{ type: 'text', text: 'spawn task' }], parent })
    /** 中文说明：变量 spawnResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnResult = await spawnRun.result
    expect(spawnResult.stopReason).toBe('completed')
    expect(text(spawnResult.output)).toBe('spawn child reply')

    // Delegate to a fork child (seeded with the parent's turn-1 prefix).
    /** 中文说明：变量 forkRun 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forkRun = await start(ctx, 'fork', { prompt: [{ type: 'text', text: 'fork task' }], parent })
    /** 中文说明：变量 forkResult 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forkResult = await forkRun.result
    expect(forkResult.stopReason).toBe('completed')
    expect(text(forkResult.output)).toBe('fork child reply')

    // The two children are distinct sessions, both lineage-stamped to the parent.
    /** 中文说明：变量 spawnChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spawnChild = ctx.agents.get(spawnRun.id)!
    /** 中文说明：变量 forkChild 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const forkChild = ctx.agents.get(forkRun.id)!
    expect(spawnChild.session.header.id).not.toBe(forkChild.session.header.id)
    expect(spawnChild.session.header.parentSession).toBe(parent.session.header.id)
    expect(forkChild.session.header.parentSession).toBe(parent.session.header.id)
    // The fork child inherited the parent's prefix; the spawn child did not.
    expect(forkChild.session.events.slice(0, parentPrefixLen).some(e => e.type === 'user/message')).toBe(true)

    await spawnRun.dispose()
    await forkRun.dispose()

    // The parent is unaffected and keeps working after both delegations.
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent q2' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    /** 中文说明：函数值 lastParentMessage 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const lastParentMessage = parent.session.events.findLast(e => e.type === 'assistant/message')
    expect(lastParentMessage?.type === 'assistant/message' && text(lastParentMessage.data.message.content)).toBe('parent turn two')
    // The parent's OWN log never recorded the children's internal steps — its
    // only subagent-related entries would be tool/call+tool/result IF it had
    // used the tool, but here we called the service directly, so the parent log
    // is purely its own two turns.
    expect(parent.session.events.filter(e => e.type === 'turn/end')).toHaveLength(2)
  })
})
