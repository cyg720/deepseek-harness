/**
 * 文件职责：验证交互与审批的 invariant.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import * as ApprovalInvariant from '@deepseek-ai/dsh-user-approval/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(ApprovalInvariant)
  return ctx
}

/** 中文说明：函数 startTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function startTurn(session: Session): void {
  session.append('turn/start', { turn: 1 })
}

describe('approval invariants', () => {
  it('accepts paired audit events and closed policy values', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ApprovalRequestId('ask-1')
    session.append('approval/asked', { id, toolName: 'bash' })
    session.append('approval/decided', { id, outcome: 'allowed-once' })
    session.append('approval/policy', { policy: 'never' })
  })

  it('rebuilds an unmatched question from an existing session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ApprovalRequestId('ask-resume')
    session.append('approval/asked', { id, toolName: 'bash' })
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ApprovalInvariant)
    expect(() => session.append('approval/decided', { id, outcome: 'cancelled' })).not.toThrow()
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  })

  it('adopts a bare session first observed through publication', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('bare-approval-session'))
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ApprovalRequestId('bare-ask')
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    const asked = {
      type: 'approval/asked', seq: SessionSeq(0), time: 0, data: { id, toolName: 'bash' },
    } as const
    /** 中文说明：测试局部值 decided，由紧邻初始化决定。 */
    const decided = {
      type: 'approval/decided', seq: SessionSeq(1), time: 1, data: { id, outcome: 'rejected' as const },
    } as const
    expect(() => {
      ctx.emit('session/event', session, {
        type: 'turn/start', seq: SessionSeq(0), time: 0,
        data: { turn: 1 },
      })
      ctx.emit('session/event', session, asked)
      ctx.emit('session/event', session, decided)
    }).not.toThrow()
  })

  it('rejects audit events outside any open turn', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    expect(() => session.append('approval/asked', {
      id: ApprovalRequestId('ask-1'), toolName: 'bash',
    })).toThrow(/outside any open turn/)
    expect(() => session.append('approval/decided', {
      id: ApprovalRequestId('ask-1'), outcome: 'rejected',
    })).toThrow(/outside any open turn/)
  })

  it('rejects an unenclosed audit event when replaying an existing session', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('approval/asked', {
      id: ApprovalRequestId('ask-replay'), toolName: 'bash',
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(ApprovalInvariant).then(() => undefined)).rejects.toThrow(/outside any open turn/)
  })

  it('rejects malformed and unpaired audit events', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create()
    startTurn(session)
    /** 中文说明：测试局部值 id，由紧邻初始化决定。 */
    const id = ApprovalRequestId('ask-1')
    expect(() => session.append('approval/asked', { id, toolName: '' }))
      .toThrow(/toolName must be non-empty/)
    session.append('approval/asked', { id, toolName: 'bash' })
    expect(() => session.append('approval/asked', { id, toolName: 'bash' }))
      .toThrow(/repeated open id/)
    expect(() => session.append('approval/decided', {
      id: ApprovalRequestId('missing'), outcome: 'rejected',
    })).toThrow(/no matching approval\/asked/)
    expect(() => session.append('approval/decided', { id, outcome: 'maybe' as never }))
      .toThrow(/unknown outcome/)
    expect(() => session.append('approval/policy', { policy: 'always' as never }))
      .toThrow(/unknown policy/)
  })
})
