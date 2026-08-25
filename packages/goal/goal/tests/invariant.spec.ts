/**
 * 文件职责：验证目标工具与投影的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证目标工具与投影可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：构造事件与配置，驱动入口并断言结果。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GoalId,
  /** 中文说明：类型或类 GoalSnapshotChangeMeta 约束 Hook、守卫或目标数据职责。 */
  type GoalSnapshotChangeMeta,
} from '@deepseek-ai/dsh-goal'
import * as GoalInvariantCompanion from '@deepseek-ai/dsh-goal/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

/** 中文说明：测试局部值 change，由紧邻初始化决定。 */
const change: GoalSnapshotChangeMeta = {
  kind: 'goal/change',
  version: 1,
  operation: 'create',
  goal: {
    id: GoalId('goal-invariant'),
    revision: 1,
    objective: 'check the stream',
    phase: 'active',
    maxGoalRounds: 2,
  },
  roundsStarted: 0,
  createdAt: 1,
  updatedAt: 1,
}

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(GoalInvariantCompanion)
  return ctx
}

describe('goal stream invariants', () => {
  it('accepts canonical goal snapshots and sequential admitted rounds', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('goal-invariant-valid'))
    session.append('goal/change', change)
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'continue' }],
        source: { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 },
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })

  it('rejects a malformed goal change before committing it and keeps the fold reusable', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('goal-invariant-invalid'))
    expect(() => {
      session.append('goal/change', { ...change, extra: true } as never)
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal',
    }))
    expect(session.seq).toBe(0)
    expect(() => {
      session.append('goal/change', change)
    }).not.toThrow()
  })

  it('reconstructs an existing durable goal before checking later rounds', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('goal-invariant-late-load'))
    session.append('goal/change', change)

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalInvariantCompanion)
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'continue after load' }],
        source: { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 },
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })
})
