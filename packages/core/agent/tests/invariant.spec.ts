import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 装配代理不变量测试上下文。@returns 已安装注册表与伴生插件的 Context。@example await setup()。 */
async function setup(): Promise<Context> {
  // 新的测试上下文。
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(AgentInvariant)
  return ctx
}

/** 创建最小代理替身。@param id 稳定代理 id。@returns 仅供事件身份比较的 Agent。@example mockAgent('a1')。 */
function mockAgent(id: string): Agent {
  return { id } as unknown as Agent
}

// 代理状态不变量测试套件。
describe('agent status invariants', () => {
  // 验证 idle/running 间真实切换被接受。
  it('accepts lifecycle transitions between idle and running', async () => {
    // 已装配上下文与目标代理。
    const ctx = await setup()
    const agent = mockAgent('a1')
    expect(() => {
      ctx.emit(scopeTarget(agent, agent), 'agent/status', { agent, status: 'idle' })
      ctx.emit(scopeTarget(agent, agent), 'agent/status', { agent, status: 'running' })
      ctx.emit(scopeTarget(agent, agent), 'agent/status', { agent, status: 'idle' })
    }).not.toThrow()
  })

  // 验证连续相同状态作为 no-op 被拒绝。
  it('rejects a no-op transition', async () => {
    // 已装配上下文与单个代理。
    const ctx = await setup()
    const agent = mockAgent('a3')
    ctx.emit(scopeTarget(agent, agent), 'agent/status', { agent, status: 'running' })
    expect(() => { ctx.emit(scopeTarget(agent, agent), 'agent/status', { agent, status: 'running' }) })
      .toThrow(/no-op transition/)
  })

  // 验证不同代理的相同状态不会互相构成 no-op。
  it('tracks agents independently', async () => {
    // 已装配上下文和两个独立代理。
    const ctx = await setup()
    const a = mockAgent('a5')
    const b = mockAgent('b5')
    ctx.emit(scopeTarget(a, a), 'agent/status', { agent: a, status: 'running' })
    expect(() => { ctx.emit(scopeTarget(b, b), 'agent/status', { agent: b, status: 'running' }) }).not.toThrow()
  })
})
/**
 * 文件职责：验证代理状态不变量接受真实状态切换、拒绝无变化事件并按代理独立跟踪。
 * 技术维度：使用 Vitest、Cordis 作用域事件和真实 InvariantRegistry/AgentInvariant。
 * 产品维度：防止会话记录重复无效状态，同时允许多个代理并发拥有独立生命周期。
 * 逻辑维度：setup 装配检查器，mockAgent 创建最小代理；三个用例覆盖合法、no-op 和双代理。
 * 关键边界：测试代理仅含 id 并通过类型断言构造；事件必须使用各自代理作用域。
 * 新手阅读建议：先看两个辅助函数，再比较三个用例中 emit 的状态序列和代理对象。
 */
