/**
 * 文件职责：验证 invariant.spec.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from '@deepseek-ai/dsh-workflow'
import * as WorkflowInvariant from '@deepseek-ai/dsh-workflow/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(WorkflowInvariant)
  return ctx
}

/** 中文说明：函数值 info 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const info = (overrides: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo => ({
  id: WorkflowRunId('workflow-1'),
  meta: { name: 'review', description: 'Review a change' },
  ...overrides,
})

/** 中文说明：函数值 agent 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const agent = (overrides: Partial<WorkflowAgentInfo> = {}): WorkflowAgentInfo => ({
  seq: 1,
  label: 'reviewer',
  childId: SessionId('child-1'),
  ...overrides,
})

/** 中文说明：函数值 agentEnd 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const agentEnd = (overrides: Partial<WorkflowAgentEndInfo> = {}): WorkflowAgentEndInfo => ({
  ...agent(),
  outcome: 'completed',
  ...overrides,
})

/** 中文说明：函数值 result 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const result = (overrides: Partial<WorkflowResultInfo> = {}): WorkflowResultInfo => ({
  stopReason: 'completed',
  agentsStarted: 1,
  ...overrides,
})

describe('workflow invariants', () => {
  it('accepts a complete workflow and child lifecycle', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = info()
    ctx.emit('workflow/start', run)
    ctx.emit('workflow/phase', run, 'inspect')
    ctx.emit('workflow/log', run, 'working')
    ctx.emit('workflow/agent-start', run, agent())
    ctx.emit('workflow/agent-end', run, agentEnd())
    ctx.emit('workflow/end', run, result())
    ctx.emit('tools/change')
  })

  it('rejects invalid run identity and enclosure', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => { ctx.emit('workflow/start', info({ id: WorkflowRunId('') })) }).toThrow(/must be non-empty/)
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = info()
    ctx.emit('workflow/start', run)
    expect(() => { ctx.emit('workflow/start', run) }).toThrow(/repeated run id/)
    expect(() => { ctx.emit('workflow/log', info({ meta: { name: 'other', description: 'x' } }), 'x') })
      .toThrow(/meta diverges/)
    /** 中文说明：变量 fresh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fresh = await setup()
    expect(() => { fresh.emit('workflow/log', info(), 'x') }).toThrow(/no matching workflow\/start/)
  })

  it('rejects malformed and unpaired child lifecycles', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 run 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const run = info()
    ctx.emit('workflow/start', run)
    expect(() => { ctx.emit('workflow/agent-start', run, agent({ seq: 0 })) }).toThrow(/seq must be positive/)
    ctx.emit('workflow/agent-start', run, agent())
    expect(() => { ctx.emit('workflow/agent-start', run, agent()) }).toThrow(/repeated seq/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ seq: 2 })) }).toThrow(/no matching start/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ childId: SessionId('other') })) })
      .toThrow(/identity diverges/)
    expect(() => { ctx.emit('workflow/agent-end', run, agentEnd({ outcome: 'unknown' as never })) })
      .toThrow(/unknown outcome/)
  })

  it('rejects inconsistent terminal results', async () => {
    /** 中文说明：变量 active 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const active = await setup()
    active.emit('workflow/start', info())
    active.emit('workflow/agent-start', info(), agent())
    expect(() => { active.emit('workflow/end', info(), result()) }).toThrow(/without workflow\/agent-end/)

    /** 中文说明：变量 count 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const count = await setup()
    count.emit('workflow/start', info())
    count.emit('workflow/agent-start', info(), agent())
    count.emit('workflow/agent-end', info(), agentEnd())
    expect(() => { count.emit('workflow/end', info(), result({ agentsStarted: 0 })) })
      .toThrow(/covering every observed agent start/)

    /** 中文说明：变量 completed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const completed = await setup()
    completed.emit('workflow/start', info())
    expect(() => { completed.emit('workflow/end', info(), result({ error: 'unexpected' })) })
      .toThrow(/absent exactly for completed/)

    /** 中文说明：变量 failed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failed = await setup()
    failed.emit('workflow/start', info())
    expect(() => { failed.emit('workflow/end', info(), result({ stopReason: 'error' })) })
      .toThrow(/absent exactly for completed/)
  })
})
