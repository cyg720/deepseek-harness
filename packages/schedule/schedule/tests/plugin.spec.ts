/**
 * 文件职责：验证 plugin.spec.ts 覆盖的计划调度行为与失败场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和受控系统资源。
 * 产品维度：保障 Agent 使用计划调度时得到稳定且可诊断的结果。
 * 逻辑维度：准备配置与资源，触发被测流程，再核对结果、事件、错误和清理。
 * 关键边界：平台能力可能不同；持久化数据和外部输入不可信；异步资源必须完全释放。
 * 新手阅读建议：先读辅助函数和平台条件，再看正常路径，最后阅读恢复与失败用例。
 */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as toolSchedule from '../src/index.ts'

/** 中文说明：class PersistenceProbe 定义本测试所需的数据或行为，用于表达计划调度场景。 */
class PersistenceProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }
}

/** 中文说明：函数 harness 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function harness(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(PersistenceProbe)
  ctx.on('session/flush', () => {})
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

/** 中文说明：函数 settle 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function settle(): Promise<void> {
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('Schedule plugin composition', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in toolSchedule).toBe(false)
    expect(toolSchedule.name).toBe('schedule')
    expect(toolSchedule.inject).toEqual(['agents', 'sessions', 'tools', 'sessionPersistence'])
    /** 中文说明：变量 loader 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(toolSchedule)).toBe(toolSchedule)
  })

  it('installs only on future root agents and unwinds on plugin disposal', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 existing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const existing = await ctx.agents.create({ sessionId: SessionId('schedule-existing') })
    /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plugin = await ctx.plugin(toolSchedule)
    expect(ctx.tools.get('schedule_create', existing.agent)).toBeUndefined()
    expect(ctx.tools.get('schedule_create')).toBeUndefined()

    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await ctx.agents.create({ sessionId: SessionId('schedule-root') })
    expect(ctx.tools.get('schedule_create', root.agent)?.name).toBe('schedule_create')
    expect(ctx.tools.get('schedule_list', root.agent)?.name).toBe('schedule_list')
    expect(ctx.tools.get('schedule_delete', root.agent)?.name).toBe('schedule_delete')
    expect(ctx.tools.get('schedule_create')).toBeUndefined()

    /** 中文说明：函数值 created 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const created = await ctx.agents.withInitiator(root.agent, () => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('schedule-plugin-create'),
      name: 'schedule_create',
      arguments: { prompt: 'future reminder', after_seconds: 3_600 },
      agent: root.agent,
    }))
    expect(created.isError).toBe(false)
    if (created.isError) throw new Error('expected Schedule create value')
    expect(created.value).toMatchObject({ id: 'schedule-1', deliveryMode: 'session-local' })
    agentEvents(ctx, root.agent).emit('agent/status', { status: 'running' })
    agentEvents(ctx, root.agent).emit('agent/status', { status: 'idle' })

    /** 中文说明：变量 child 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const child = await root.agent.ctx.agents.create({ sessionId: SessionId('schedule-child') })
    expect(ctx.agents.roots()).toEqual([existing.agent, root.agent])
    expect(ctx.tools.get('schedule_create', child.agent)).toBeUndefined()

    /** 中文说明：变量 departing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const departing = await ctx.agents.create({ sessionId: SessionId('schedule-departing') })
    expect(ctx.tools.get('schedule_create', departing.agent)).toBeDefined()
    await departing.dispose()
    expect(ctx.tools.get('schedule_create', departing.agent)).toBeUndefined()

    await plugin.dispose()
    expect(ctx.tools.get('schedule_create', root.agent)).toBeUndefined()
    expect(ctx.tools.get('schedule_list', root.agent)).toBeUndefined()
    expect(ctx.tools.get('schedule_delete', root.agent)).toBeUndefined()

    await child.dispose()
    await root.dispose()
    await existing.dispose()
    await ctx.fiber.dispose()
  })

  it('does not checkpoint unrelated idle sessions', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await harness()
    /** 中文说明：变量 plugin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const plugin = await ctx.plugin(toolSchedule)
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await ctx.agents.create({ sessionId: SessionId('schedule-unrelated-idle') })
    await settle()
    /** 中文说明：变量 flushes 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let flushes = 0
    /** 中文说明：函数值 stopFlush 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stopFlush = ctx.on('session/flush', (session) => {
      if (session === root.agent.session) flushes += 1
    })

    agentEvents(ctx, root.agent).emit('agent/status', { status: 'running' })
    agentEvents(ctx, root.agent).emit('agent/status', { status: 'idle' })
    await settle()
    expect(flushes).toBe(0)

    stopFlush()
    await root.dispose()
    await plugin.dispose()
    await ctx.fiber.dispose()
  })
})
