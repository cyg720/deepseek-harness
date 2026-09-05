/**
 * 文件职责：验证交互与审批的 approval.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { carrierKeyOf, createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService, { ApprovalOutcome, ApprovalRequest, setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'

/**
 * A minimal Agent stand-in — the service only reaches `agent.session.append`
 * and indexed log reads. Seeded inside an open turn by default (request()'s
 * turn-enclosure precondition); pass `seed` to stage idle/closed logs.
 * Returns the recorded audit appends alongside the fake.
 */
/* 中文说明：函数 fakeAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function fakeAgent(seed: Array<{ type: string }> = [{ type: 'turn/start' }, { type: 'user/message' }]): { agent: Agent; appended: Array<{ type: string; data: Record<string, unknown> }> } {
  /** 中文说明：测试局部值 appended，由紧邻初始化决定。 */
  const appended: Array<{ type: string; data: Record<string, unknown> }> = []
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [...seed]
  const agent = {
    session: {
      get seq() { return events.length },
      eventAt: (seq: number) => events[seq],
      append: (type: string, data: Record<string, unknown>) => {
        const event = { type, data }
        events.push(event)
        appended.push(event)
        return event as unknown as SessionEvent
      },
    },
  } as unknown as Agent
  return { agent, appended }
}

/** 中文说明：函数 mounted 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function mounted(): Promise<Context> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(ApprovalService)
  return ctx
}

/** 中文说明：函数 requestOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function requestOf(agent: Agent, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { agent, toolName: 'echo', ...overrides }
}

describe('ApprovalService.request', () => {
  it('throws before appending anything when no turn has ever opened (idle ask)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent([])

    await expect(ctx.approval.request(requestOf(agent))).rejects.toThrow(/outside an open turn/)
    expect(appended).toHaveLength(0)
  })

  it('throws between turns — a closed turn does not satisfy the enclosure precondition', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent([{ type: 'turn/start' }, { type: 'turn/end' }])

    await expect(ctx.approval.request(requestOf(agent))).rejects.toThrow(/outside an open turn/)
    expect(appended).toHaveLength(0)
  })

  it('fails closed to unavailable when nobody listens, auditing the asked/decided pair', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()

    const outcome = await ctx.approval.request(requestOf(agent, { callId: ToolCallId('call-1'), reason: 'hook says ask' }))

    expect(outcome).toBe('unavailable')
    expect(appended.map(e => e.type)).toEqual(['approval/asked', 'approval/decided'])
    /** 中文说明：测试局部值 [asked, decided]，由紧邻初始化决定。 */
    const [asked, decided] = appended
    expect(asked?.data).toMatchObject({ toolName: 'echo', callId: 'call-1', reason: 'hook says ask' })
    expect(decided?.data).toMatchObject({ outcome: 'unavailable' })
    expect(decided?.data['id']).toBe(asked?.data['id'])
  })

  it('omits absent optional fields from the asked audit event', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()

    await ctx.approval.request(requestOf(agent))

    expect(Object.keys(appended[0]?.data ?? {}).sort()).toEqual(['id', 'toolName'])
  })

  it('borrows the exact readonly request for scoped dispatch and audit', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()
    /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定。 */
    let scope!: Scope
    /** 中文说明：测试局部值 scopeFiber，由紧邻初始化决定。 */
    const scopeFiber = await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent)
    }, { inject: ['approval'] }))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let received: ApprovalRequest | undefined
    /** 中文说明：测试局部值 carrier: unknown，由紧邻初始化决定。 */
    let carrier: unknown
    scope.ctx.on('approval/request', function (req) {
      received = req
      carrier = carrierKeyOf(this)
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    /** 中文说明：测试局部值 request，由紧邻初始化决定。 */
    const request = requestOf(agent, {
      toolName: 'scoped-tool',
      callId: ToolCallId('scoped-call'),
      reason: 'scoped reason',
    })

    await expect(ctx.approval.request(request)).resolves.toBe('allowed-once')
    expect(carrier).toBe(agent)
    expect(received).toBe(request)
    expect(appended).toHaveLength(2)
    expect(appended[0]?.data).toMatchObject({
      toolName: 'scoped-tool',
      callId: 'scoped-call',
      reason: 'scoped reason',
    })
    expect(appended[1]?.data).toMatchObject({ outcome: 'allowed-once' })
    expect(appended[1]?.data['id']).toBe(appended[0]?.data['id'])
    await scopeFiber.dispose()
  })

  it('contains an approval/asked observer throw after append and still completes the pair', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('asked-observer-throw'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { session } as unknown as Agent
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'approval/asked') throw new Error('observer failed after asked append')
    })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('allowed-once')

    const audit = session.snapshotEvents().filter(event => event.type.startsWith('approval/'))
    const asked = session.snapshotEvents().find((event): event is SessionEvent<'approval/asked'> => event.type === 'approval/asked')
    const decided = session.snapshotEvents().find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')
    expect(audit.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(decided?.data.id).toBe(asked?.data.id)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session/event listener threw: Error: observer failed after asked append'))
  })

  it('contains an approval/decided observer throw after append and still resolves', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = ctx.sessions.create(SessionId('decided-observer-throw'))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { session } as unknown as Agent
    /** 中文说明：测试局部值 warn，由紧邻初始化决定。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'approval/decided') throw new Error('observer failed after decided append')
    })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('rejected')

    const audit = session.snapshotEvents().filter(event => event.type.startsWith('approval/'))
    const asked = session.snapshotEvents().find((event): event is SessionEvent<'approval/asked'> => event.type === 'approval/asked')
    const decided = session.snapshotEvents().find((event): event is SessionEvent<'approval/decided'> => event.type === 'approval/decided')
    expect(audit.map(event => event.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome: 'rejected' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('session/event listener threw: Error: observer failed after decided append'))
  })

  it('propagates an append failure that prevented audit log growth', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('append failed before log growth')
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = {
      session: {
        seq: 1,
        eventAt: () => ({ type: 'turn/start' }),
        append: () => { throw failure },
      },
    } as unknown as Agent

    await expect(ctx.approval.request(requestOf(agent))).rejects.toBe(failure)
  })

  it('returns the first answering listener outcome (single decision slot)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    /** 中文说明：测试局部值 secondRan，由紧邻初始化决定。 */
    let secondRan = false
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    ctx.on('approval/request', () => {
      secondRan = true
      return Promise.resolve<ApprovalOutcome>('rejected')
    })

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('allowed-once')
    expect(secondRan).toBe(false)
  })

  it('lets a non-owning listener delegate via next() down to the fail-closed default', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    ctx.on('approval/request', (_req, next) => next())

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('unavailable')
  })

  it('dispatches to global and matching agent-scoped listeners, never a foreign scope', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent，由紧邻初始化决定。 */
    const { agent: agentA } = fakeAgent()
    /** 中文说明：测试局部值 { agent，由紧邻初始化决定。 */
    const { agent: agentB } = fakeAgent()
    /** 中文说明：测试局部值 scopeA!: Scope，由紧邻初始化决定。 */
    let scopeA!: Scope
    /** 中文说明：测试局部值 scopeB!: Scope，由紧邻初始化决定。 */
    let scopeB!: Scope
    /** 中文说明：测试局部值 scopesFiber，由紧邻初始化决定。 */
    const scopesFiber = await ctx.plugin(Object.assign((inner: Context) => {
      scopeA = createScope(inner, agentA)
      scopeB = createScope(inner, agentB)
    }, { inject: ['approval'] }))
    /** 中文说明：测试局部值 heard，由紧邻初始化决定。 */
    const heard: string[] = []
    ctx.on('approval/request', (req, next) => {
      heard.push(req.agent === agentA ? 'global:A' : 'global:B')
      return next()
    })
    scopeA.ctx.on('approval/request', (_req, next) => {
      heard.push('scoped:A')
      return next()
    })
    scopeB.ctx.on('approval/request', (_req, next) => {
      heard.push('scoped:B')
      return next()
    })

    await expect(ctx.approval.request(requestOf(agentA))).resolves.toBe('unavailable')
    await expect(ctx.approval.request(requestOf(agentB))).resolves.toBe('unavailable')

    expect(heard).toEqual(['global:A', 'scoped:A', 'global:B', 'scoped:B'])
    await scopesFiber.dispose()
  })

  it('keys the scoped dispatch carrier to the exact request agent', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    /** 中文说明：测试局部值 scope!: Scope，由紧邻初始化决定。 */
    let scope!: Scope
    /** 中文说明：测试局部值 scopeFiber，由紧邻初始化决定。 */
    const scopeFiber = await ctx.plugin(Object.assign((inner: Context) => {
      scope = createScope(inner, agent)
    }, { inject: ['approval'] }))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seenKey: object | undefined
    scope.ctx.on('approval/request', function (req, next) {
      seenKey = carrierKeyOf(this)
      expect(req.agent).toBe(agent)
      return next()
    })

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('unavailable')

    expect(seenKey).toBe(agent)
    await scopeFiber.dispose()
  })

  it('contains a throwing answerer as unavailable', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()
    ctx.on('approval/request', () => Promise.reject(new Error('transport died')))

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('unavailable')
    expect(appended[1]?.data).toMatchObject({ outcome: 'unavailable' })
  })

  it('normalizes a rogue non-vocabulary answer to unavailable', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    // A JS answerer can return anything; the seam must not leak it into
    // callers' closed-union switches.
    ctx.on('approval/request', () => Promise.resolve('yolo' as ApprovalOutcome))

    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('unavailable')
  })

  it('settles cancelled immediately on an already-aborted signal without asking anyone', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()
    /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
    let asked = false
    ctx.on('approval/request', () => {
      asked = true
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })

    /** 中文说明：测试局部值 outcome，由紧邻初始化决定。 */
    const outcome = await ctx.approval.request(requestOf(agent, { signal: AbortSignal.abort() }))

    expect(outcome).toBe('cancelled')
    expect(asked).toBe(false)
    expect(appended.map(e => e.type)).toEqual(['approval/asked', 'approval/decided'])
    expect(appended[1]?.data).toMatchObject({ outcome: 'cancelled' })
  })

  it('resolves cancelled when the signal aborts mid-question and discards the late answer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()
    /** 中文说明：测试局部值 settleLate，由紧邻初始化决定。 */
    let settleLate: ((outcome: ApprovalOutcome) => void) | undefined
    ctx.on('approval/request', () => new Promise<ApprovalOutcome>((resolve) => { settleLate = resolve }))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()

    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.approval.request(requestOf(agent, { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')

    // The answerer settles after the fact: no second decided event appears.
    settleLate?.('allowed-once')
    await Promise.resolve()
    expect(appended.filter(e => e.type === 'approval/decided')).toHaveLength(1)
    expect(appended[1]?.data).toMatchObject({ outcome: 'cancelled' })
  })

  it('discards a late REJECTION after abort without an unhandled rejection', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    /** 中文说明：测试局部值 rejectLate，由紧邻初始化决定。 */
    let rejectLate: ((error: Error) => void) | undefined
    ctx.on('approval/request', () => new Promise<ApprovalOutcome>((_resolve, reject) => { rejectLate = reject }))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()

    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.approval.request(requestOf(agent, { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')

    rejectLate?.(new Error('answered too late'))
    // Drain microtasks: the contained rejection must not escape the seam.
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })

  it('resolves the answer when the signal never aborts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()

    await expect(ctx.approval.request(requestOf(agent, { signal: controller.signal }))).resolves.toBe('rejected')
  })

  it('issues a fresh id per request', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()

    await ctx.approval.request(requestOf(agent))
    await ctx.approval.request(requestOf(agent))

    /** 中文说明：测试局部值 ids，由紧邻初始化决定。 */
    const ids = appended.filter(e => e.type === 'approval/asked').map(e => e.data['id'])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('drops a disposed plugin listener from the chain (HMR safety)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await mounted()
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = fakeAgent()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin((inner: Context) => {
      inner.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    })
    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('allowed-once')

    await fiber.dispose()
    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('unavailable')
  })
})

describe('approval policy (the approval/policy fold)', () => {
  /** 中文说明：测试局部值 NEVER_SENTENCE，由紧邻初始化决定。 */
  const NEVER_SENTENCE = 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).'
  /** 中文说明：测试局部值 ASK_SENTENCE，由紧邻初始化决定。 */
  const ASK_SENTENCE = 'Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.'

  /**
   * An agent stand-in over a REAL Session — gate and context fold real events;
   * the opened turn satisfies request()'s enclosure precondition.
   */
  /* 中文说明：函数 sessionAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function sessionAgent(id: string): { agent: Agent; session: Session } {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId(id))
    session.append('turn/start', { turn: 1 })
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = { id, session } as unknown as Agent
    return { agent, session }
  }

  it('folds to the last event, or undefined without one', () => {
    const service = new ApprovalService(new Context(), {})
    const { session } = sessionAgent('sess-fold')
    expect(service.overrideOf(session)).toBeUndefined()
    setApprovalPolicy(session, 'never')
    setApprovalPolicy(session, 'ask')
    expect(service.overrideOf(session)).toBe('ask')
    expect(session.snapshotEvents().at(-1)).toMatchObject({ type: 'approval/policy', data: { policy: 'ask' } })
  })

  it('rejects a policy outside the closed vocabulary before appending', () => {
    /** 中文说明：测试局部值 append，由紧邻初始化决定。 */
    const append = vi.fn()
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = { append } as unknown as Session

    expect(() => { setApprovalPolicy(session, 'sometimes' as Parameters<typeof setApprovalPolicy>[1]) })
      .toThrow('approval policy must be one of "ask" or "never"')
    expect(append).not.toHaveBeenCalled()
  })

  it('defaults a schema-less construction to ask (the ?? narrows the optional TYPE)', async () => {
    // Direct construction bypasses the plugin schema (the SystemPrompt-test
    // precedent for covering a defaulted Config field's type-narrowing ??).
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    /** 中文说明：测试局部值 service，由紧邻初始化决定。 */
    const service = new ApprovalService(ctx, {})
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = sessionAgent('sess-bare-config')
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    await expect(service.request({ agent, toolName: 'echo' })).resolves.toBe('allowed-once')
  })

  it('contains an answerer that throws SYNCHRONOUSLY as unavailable', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = sessionAgent('sess-syncthrow')
    ctx.on('approval/request', () => { throw new Error('sync bug') })
    await expect(ctx.approval.request({ agent, toolName: 'echo' })).resolves.toBe('unavailable')
  })

  it('a never config rejects deterministically without consulting any answerer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(ApprovalService, { policy: 'never' })
    /** 中文说明：测试局部值 consulted，由紧邻初始化决定。 */
    const consulted = vi.fn()
    ctx.on('approval/request', (_req, next) => { consulted(); return next() })
    /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
    const { agent, session } = sessionAgent('sess-gate-1')
    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    // The audit pair still lands on the session log.
    expect(session.snapshotEvents().filter(e => e.type === 'approval/asked')).toHaveLength(1)
    expect(session.snapshotEvents().filter(e => e.type === 'approval/decided')).toHaveLength(1)
  })

  it('the gate decides FIRST even against an answerer registered before the service (prepend)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    await ctx.plugin(ApprovalService, { policy: 'never' })
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = sessionAgent('sess-gate-2')
    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('rejected')
  })

  it('never is unbypassable even by an answerer PREPENDED after the service mounts', async () => {
    // Cordis prepend unshifts ahead of every existing listener, including any gate LISTENER the
    // service could register — which is exactly why the 'never' decision lives inside request()
    // instead. This eager grant would bypass a listener-based gate and therefore must never run.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(ApprovalService, { policy: 'never' })
    /** 中文说明：测试局部值 consulted，由紧邻初始化决定。 */
    const consulted = vi.fn()
    ctx.on('approval/request', () => { consulted(); return Promise.resolve<ApprovalOutcome>('allowed-once') }, { prepend: true })
    /** 中文说明：测试局部值 { agent, appended }，由紧邻初始化决定。 */
    const { agent, appended } = fakeAgent()
    await expect(ctx.approval.request(requestOf(agent))).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    expect(appended.map(e => e.type)).toEqual(['approval/asked', 'approval/decided'])
  })

  it('a session override outranks the configured default, in both directions', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(ApprovalService, { policy: 'never' })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
    const { agent, session } = sessionAgent('sess-gate-3')
    expect(ctx.approval.overrideOf(session)).toBeUndefined()
    setApprovalPolicy(session, 'ask')
    expect(ctx.approval.overrideOf(session)).toBe('ask')
    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('allowed-once')
    setApprovalPolicy(session, 'never')
    await expect(ctx.approval.request({ agent, toolName: 'bash' })).resolves.toBe('rejected')
  })

  it('queues a live policy switch for the next model step', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
    const { agent, session } = sessionAgent('sess-policy-notice')
    /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
    const inject = vi.fn<Agent['inject']>()
    /** 中文说明：测试局部值 liveAgent，由紧邻初始化决定。 */
    const liveAgent = { ...agent, inject } as Agent

    ctx.approval.setPolicy(liveAgent, 'never')
    ctx.approval.setPolicy(liveAgent, 'never')

    expect(ctx.approval.overrideOf(session)).toBe('never')
    expect(inject).toHaveBeenCalledOnce()
    expect(inject.mock.calls[0]?.[0]).toMatchObject({
      content: [{
        type: 'text',
        text: 'The approval policy changed from "ask" to "never" (changed by the user).',
      }],
      source: { kind: 'plugin', plugin: 'user-approval' },
    })
  })

  it('contributes the complete current ask or never policy as cache-safe context', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 askAgent，由紧邻初始化决定。 */
    const askAgent = sessionAgent('sess-sect-ask').agent
    /** 中文说明：测试局部值 { agent，由紧邻初始化决定。 */
    const { agent: neverAgent, session } = sessionAgent('sess-sect-never')
    setApprovalPolicy(session, 'never')
    /** 中文说明：测试局部值 contextFor，由紧邻初始化决定。 */
    const contextFor = async (context: object) =>
      (await ctx.systemPrompt.assemble(context)).contexts.find(entry => entry.name === 'approval:policy')?.text
    expect(await contextFor({ agent: askAgent })).toBe(ASK_SENTENCE)
    expect(await contextFor({ agent: neverAgent })).toBe(NEVER_SENTENCE)
    // A bare assemble (no agent) has no session to state.
    expect(await contextFor({})).toBe('')
  })

  it('reflects the latest durable switch in cache-safe context and stays byte-stable while unchanged', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 { agent, session }，由紧邻初始化决定。 */
    const { agent, session } = sessionAgent('sess-context-switch')
    /** 中文说明：测试局部值 contextFor，由紧邻初始化决定。 */
    const contextFor = async () =>
      (await ctx.systemPrompt.assemble({ agent })).contexts.find(entry => entry.name === 'approval:policy')?.text
    expect(await contextFor()).toBe(ASK_SENTENCE)
    expect(await contextFor()).toBe(ASK_SENTENCE)
    setApprovalPolicy(session, 'never')
    setApprovalPolicy(session, 'ask')
    setApprovalPolicy(session, 'never')
    expect(await contextFor()).toBe(NEVER_SENTENCE)
    expect(await contextFor()).toBe(NEVER_SENTENCE)
  })

  it('disposes the runtime-context contribution with the service', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(ApprovalService)
    /** 中文说明：测试局部值 { agent }，由紧邻初始化决定。 */
    const { agent } = sessionAgent('sess-hmr-service-live')
    /** 中文说明：测试局部值 contextFor，由紧邻初始化决定。 */
    const contextFor = async () =>
      (await ctx.systemPrompt.assemble({ agent })).contexts.find(context => context.name === 'approval:policy')
    expect(await contextFor()).toBeDefined()
    await fiber.dispose()
    expect(await contextFor()).toBeUndefined()
  })
})
