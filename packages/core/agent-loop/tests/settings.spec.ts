/** The `agent-loop` settings section layered over the composition entry. */
/**
 * 文件职责：验证Agent Loop的 settings.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import AgentLoop, { AGENT_LOOP_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-loop'

/** The smallest real provider: one in-memory document, always writable. */
/** 中文说明：测试类型或类 MemorySettings 约束夹具数据和行为。 */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** 中文说明：测试辅助函数 boot 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
async function boot(): Promise<{ ctx: Context; settingsFiber: Fiber; loopFiber: Fiber }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定，仅在当前场景使用。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  /** 中文说明：测试局部值 settingsFiber，由紧邻初始化决定，仅在当前场景使用。 */
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  /** 中文说明：测试局部值 loopFiber，由紧邻初始化决定，仅在当前场景使用。 */
  const loopFiber = ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 4 })
  await loopFiber.await()
  return { ctx, settingsFiber, loopFiber }
}

describe('agent-loop settings section', () => {
  it('layers the stored parallel cap over the composition entry', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()
    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)

    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 1 })

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(1)
    await bench.ctx.fiber.dispose()
  })

  it('refuses a non-positive cap at the write', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()

    await expect(bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 0 }))
      .rejects.toThrow()

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)
    await bench.ctx.fiber.dispose()
  })

  it('never offers the composed agents array to the settings document', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()

    /** 中文说明：测试局部值 descriptor，由紧邻初始化决定，仅在当前场景使用。 */
    const descriptor = bench.ctx.settings.describe().find(row => String(row.ns) === 'agent-loop')

    expect(Object.keys(descriptor?.value as object)).toEqual(['maxParallelToolCalls'])
    await bench.ctx.fiber.dispose()
  })

  it('keeps serving the composed agents array to its own consumers', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()

    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 2 })

    expect(bench.ctx.agentLoop.config.agents).toEqual([])
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()
    await bench.ctx.settings.update(AGENT_LOOP_SETTINGS_NAMESPACE, { maxParallelToolCalls: 1 })
    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(1)

    await bench.settingsFiber.dispose()

    expect(bench.ctx.agentLoop.config.maxParallelToolCalls).toBe(4)
    await bench.ctx.fiber.dispose()
  })

  it('releases the namespace when the service unloads', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定，仅在当前场景使用。 */
    const bench = await boot()
    expect(bench.ctx.settings.describe().map(row => String(row.ns))).toContain('agent-loop')

    await bench.loopFiber.dispose()

    expect(bench.ctx.settings.describe().map(row => String(row.ns))).not.toContain('agent-loop')
    await bench.ctx.fiber.dispose()
  })
})
