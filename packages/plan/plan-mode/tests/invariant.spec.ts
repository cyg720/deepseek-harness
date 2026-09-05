/**
 * 文件职责：验证 invariant.spec.ts 覆盖的计划模式行为、持久化与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身。
 * 产品维度：保障 Agent 使用计划模式时得到稳定且可重放的结果。
 * 逻辑维度：准备上下文与事件，触发被测流程，再核对状态、输出和资源清理。
 * 关键边界：持久化事件必须可重放；连接和异步资源必须在用例结束时释放。
 * 新手阅读建议：先读辅助函数，再按 describe/it 阅读正常、恢复与失败场景。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as PlanModeInvariant from '@deepseek-ai/dsh-plan-mode/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(PlanModeInvariant)
  return ctx
}

/** 中文说明：函数 event 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function event(active: unknown): SessionEvent {
  return { type: 'plan/mode', seq: SessionSeq(0), time: 0, data: { active } } as SessionEvent
}

/** 中文说明：函数 emitTurnStart 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function emitTurnStart(ctx: Context, session: Session): void {
  ctx.emit('session/event', session, {
    type: 'turn/start', seq: SessionSeq(0), time: 0,
    data: { turn: 1 },
  })
}

describe('plan-mode stream invariants', () => {
  it('accepts either boolean state', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('plan-state'))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event(true)) }).not.toThrow()
    expect(() => { ctx.emit('session/event', session, event(false)) }).not.toThrow()
    ctx.emit('session/event', session, {
      type: 'turn/end', seq: SessionSeq(3), time: 3, data: { turn: 1, reason: { kind: 'completed' } },
    })
  })

  it.each([42, 'plan', undefined])('rejects invalid durable plan state %j', async (active) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId(`invalid-${String(active)}`))
    emitTurnStart(ctx, session)
    expect(() => { ctx.emit('session/event', session, event(active)) })
      .toThrow(/expected a boolean/)
  })

  it('accepts standalone plan state between turns (the idle immediate commit)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => ctx.sessions.create().append('plan/mode', { active: true }))
      .not.toThrow()
  })

  it('ignores unrelated dispatches and session events', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = Session.create(SessionId('unrelated'))
    expect(() => {
      ctx.emit('tools/change')
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects invalid existing state on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('plan/mode', { active: 'plan' as unknown as boolean })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).rejects.toThrow(/expected a boolean/)
  })

  it('replays enclosed existing plan state through its closing boundary', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    session.append('plan/mode', { active: true })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it('accepts standalone existing plan state on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('plan/mode', { active: true })
    await ctx.plugin(InvariantRegistry, { enabled: true })

    await expect(ctx.plugin(PlanModeInvariant).then(() => undefined)).resolves.toBeUndefined()
  })
})
