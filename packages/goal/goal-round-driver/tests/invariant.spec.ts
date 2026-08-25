/**
 * 文件职责：验证目标管理的 invariant.spec.ts 行为与安全边界。
 * 技术维度：TypeScript、Cordis、会话事件、路径策略、判别联合和 Vitest。
 * 产品维度：保证目标管理操作可预测、可审计并在失败时保持一致。
 * 逻辑维度：构造请求与状态，驱动服务并断言输出和清理。
 * 关键边界：文件路径必须经过策略检查；目标引用含版本，过期修改必须拒绝。
 * 新手阅读建议：先读类型与测试夹具，再按校验、执行、事件折叠和错误流程阅读。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GoalId,
  /** 中文说明：类型或类 GoalSnapshotChangeMeta 约束文件或目标数据职责。 */
  type GoalSnapshotChangeMeta,
  /** 中文说明：类型或类 GoalView 约束文件或目标数据职责。 */
  type GoalView,
} from '@deepseek-ai/dsh-goal'
import * as GoalSessionInvariant from '@deepseek-ai/dsh-goal-round-driver/invariant'
import { renderGoalRoundPrompt } from '@deepseek-ai/dsh-goal-round-driver'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'

/** 中文说明：测试局部值 change，由紧邻初始化决定。 */
const change: GoalSnapshotChangeMeta = {
  kind: 'goal/change',
  version: 1,
  operation: 'create',
  goal: {
    id: GoalId('goal-round-driver-invariant'),
    revision: 1,
    objective: 'verify every continuation prompt',
    phase: 'active',
    maxGoalRounds: 2,
  },
  roundsStarted: 0,
  createdAt: 1,
  updatedAt: 1,
}

/** 中文说明：函数 view 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function view(roundsStarted: number): GoalView {
  return { ...change.goal, roundsStarted, createdAt: 1, updatedAt: 1, activation: 'armed' }
}

/** 中文说明：函数 appendChange 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendChange(session: Session): void {
  session.append('goal/change', change)
}

/** 中文说明：函数 appendRound 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function appendRound(session: Session, turn: number, content = renderGoalRoundPrompt(view(turn - 2), turn - 1)): void {
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source = { kind: 'goal', goalId: change.goal.id, revision: 1, round: turn - 1 } as const
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content, source,
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mount(sessionFirst = false): Promise<{ ctx: Context; session: Session }> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = ctx.sessions.create(SessionId('goal-round-driver-invariant'))
  if (!sessionFirst) {
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalSessionInvariant)
  }
  return { ctx, session }
}

describe('goal-round-driver prompt invariants', () => {
  it('reconstructs existing rounds and accepts the next canonical prompt', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await mount(true)
    appendChange(session)
    appendRound(session, 2)

    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(GoalSessionInvariant)

    expect(() => { appendRound(session, 3) }).not.toThrow()
    ctx.sessions.create(SessionId('goal-session-invariant-dispatch'))

    /** 中文说明：测试局部值 userSource，由紧邻初始化决定。 */
    const userSource = { kind: 'user' } as const
    session.append('turn/start', { turn: 4 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'ordinary human message' }],
      source: userSource,
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn: 4, reason: { kind: 'completed' } })

    /** 中文说明：测试局部值 stateSource，由紧邻初始化决定。 */
    const stateSource = {
      kind: 'goal', goalId: change.goal.id, revision: change.goal.revision, round: 0,
    } as never
    session.append('turn/start', { turn: 5 })
    expect(() => {
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'round zero is not a driver continuation' }],
        source: stateSource,
      }), { surfaceOp: 'append' })
    }).not.toThrow()
  })

  it('rejects a continuation whose content differs from the package renderer', async () => {
    /** 中文说明：测试局部值 { session }，由紧邻初始化决定。 */
    const { session } = await mount()
    appendChange(session)

    expect(() => {
      appendRound(session, 2, [{ type: 'text', text: 'counterfeit continuation' }])
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    }))
  })

  it('rejects a goal round without a reconstructable active goal', async () => {
    /** 中文说明：测试局部值 { session }，由紧邻初始化决定。 */
    const { session } = await mount()
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = { kind: 'goal', goalId: change.goal.id, revision: 1, round: 1 } as const
    session.append('turn/start', { turn: 1 })

    expect(() => {
      session.append('user/message', createUserMessage({
        content: renderGoalRoundPrompt(view(0), 1),
        source,
      }), { surfaceOp: 'append' })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    }))
  })

  it('attributes an invalid durable prefix during late loading', async () => {
    /** 中文说明：测试局部值 { ctx, session }，由紧邻初始化决定。 */
    const { ctx, session } = await mount(true)
    session.append('goal/change', { ...change, extra: true } as never)
    appendRound(session, 2)
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(GoalSessionInvariant)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-goal-round-driver',
    })
  })
})
