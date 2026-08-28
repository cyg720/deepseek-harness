/**
 * 文件职责：验证 invariant.spec.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type {
  SubagentProvider,
  SubagentRunEndInfo,
  SubagentRunInfo,
} from '@deepseek-ai/dsh-subagent'
import * as SubagentInvariant from '@deepseek-ai/dsh-subagent/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SubagentInvariant)
  return ctx
}

/** 中文说明：函数值 provider 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const provider = (name: string): SubagentProvider => ({
  name,
  capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
  inheritsParentContext: false,
  start: async () => { throw new Error('not used') },
})

/** 中文说明：函数值 start 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const start = (overrides: Partial<SubagentRunInfo> = {}): SubagentRunInfo => ({
  runId: SubagentRunId('run-1'),
  provider: 'mock',
  id: SessionId('child-1'),
  local: false,
  ...overrides,
})

/** 中文说明：函数值 end 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const end = (overrides: Partial<SubagentRunEndInfo> = {}): SubagentRunEndInfo => ({
  ...start(),
  stopReason: 'completed',
  ...overrides,
})

/** 中文说明：函数 emitRun 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function emitRun(ctx: Context, name: 'subagent/start', info: SubagentRunInfo): void
/** 中文说明：函数 emitRun 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function emitRun(ctx: Context, name: 'subagent/end', info: SubagentRunEndInfo): void
/** 中文说明：函数 emitRun 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function emitRun(ctx: Context, name: 'subagent/start' | 'subagent/end', info: SubagentRunInfo | SubagentRunEndInfo): void {
  ctx.emit(scopeTarget(ctx.subagents, {}), name as 'subagent/start', info)
}

describe('subagent invariants', () => {
  it('accepts provider and run lifecycle pairs', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 mock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    emitRun(ctx, 'subagent/start', start())
    emitRun(ctx, 'subagent/end', end())
    ctx.emit('subagent/provider-removed', 'mock')
    ctx.emit('tools/change')
  })

  it('rejects malformed provider transitions', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => { ctx.emit('subagent/provider-added', provider('')) }).toThrow(/names must be non-empty/)
    /** 中文说明：变量 mock 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mock = provider('mock')
    ctx.emit('subagent/provider-added', mock)
    expect(() => { ctx.emit('subagent/provider-added', mock) }).toThrow(/repeated "mock"/)
    expect(() => { ctx.emit('subagent/provider-removed', 'missing') }).toThrow(/unknown provider/)
  })

  it('rejects malformed and unpaired run transitions', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => { emitRun(ctx, 'subagent/start', start({ provider: '' })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    expect(() => { emitRun(ctx, 'subagent/start', start({ runId: SubagentRunId('') })) })
      .toThrow(/provider, runId, and child id must be non-empty/)
    emitRun(ctx, 'subagent/start', start())
    expect(() => { emitRun(ctx, 'subagent/start', start()) }).toThrow(/repeated run id/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ runId: SubagentRunId('missing') })) })
      .toThrow(/no matching subagent\/start/)
    expect(() => { emitRun(ctx, 'subagent/end', end({ id: SessionId('other') })) })
      .toThrow(/identity diverges/)
  })

  it('accepts the recorded provider name after registration ends', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 historical 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const historical = provider('historical')
    ctx.emit('subagent/provider-added', historical)
    ctx.emit('subagent/provider-removed', historical.name)

    emitRun(ctx, 'subagent/start', start({ provider: historical.name }))
    emitRun(ctx, 'subagent/end', end({ provider: historical.name }))
  })
})
