/**
 * 文件职责：验证交互与审批的 user-questions.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证交互与审批在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import UserQuestionService, {
  UserQuestionError,
  /** 中文说明：类型或类 AskUserQuestionRequest 约束宿主、交互或任务数据职责。 */
  type AskUserQuestionRequest,
  /** 中文说明：类型或类 UserQuestionProvider 约束宿主、交互或任务数据职责。 */
  type UserQuestionProvider,
} from '@deepseek-ai/dsh-user-questions'

/** 中文说明：函数 provider 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function provider(answer = 'approved'): UserQuestionProvider & { seen: AskUserQuestionRequest[] } {
  /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
  const seen: AskUserQuestionRequest[] = []
  return {
    seen,
    async ask(request) {
      seen.push(request)
      return { answers: [{ id: request.questions[0]?.id ?? 'missing', selected: [answer] }] }
    },
  }
}

/** 中文说明：函数 stubAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stubAgent(id: string, delegationDepth = 0): Agent {
  /** 中文说明：测试局部值 agentId，由紧邻初始化决定。 */
  const agentId = id as Agent['id']
  return {
    id: agentId,
    session: { id: agentId, header: { delegationDepth } },
  } as unknown as Agent
}

describe('UserQuestionService', () => {
  it('delegates ask requests to the registered provider', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = provider('yes')
    ctx.userQuestions.registerProvider(p)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
    expect(p.seen).toEqual([{ questions: [{ id: 'confirm', question: 'Proceed?' }] }])
  })

  it('rejects ask requests when no provider is registered', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_PROVIDER' })
  })

  it('registers providers with HMR-safe disposal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = provider()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.userQuestions.registerProvider(p)

    dispose()
    dispose()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('rejects duplicate providers instead of replacing the active UI', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    ctx.userQuestions.registerProvider(provider('first'))

    expect(() => ctx.userQuestions.registerProvider(provider('second')))
      .toThrow(UserQuestionError)
  })

  it('fails before reaching the provider when the signal is already aborted', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [{ id: 'confirm', selected: ['too late'] }] })) }
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }], signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects empty question batches before reaching the provider', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    await expect(ctx.userQuestions.ask({ questions: [] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a live runtime-owned agent before reaching the provider', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 root，由紧邻初始化决定。 */
    const root = stubAgent('root', 0)
    /** 中文说明：测试局部值 child，由紧邻初始化决定。 */
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: child,
    })).rejects.toMatchObject({
      name: 'UserQuestionError',
      code: 'DELEGATED_CALLER',
      message: "human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
    })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('reaches the provider for a lineage-bearing session resumed as a runtime root', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = provider('yes')
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent,
    })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
  })

  it('rejects a supplied agent when no live registry can attest it', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('unattested'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a stale agent object that reuses a live id', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
    const live = stubAgent('same-id')
    ctx.agents.enter(live, undefined)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('same-id'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects an intent whose approve label names none of its own options', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 question，由紧邻初始化决定。 */
    const question = { id: 'plan-review', question: 'Approve?', detail: '# Plan' }

    // A wrong label among offered options, and no options offered at all.
    /** 中文说明：测试局部值 options，由紧邻初始化决定。 */
    for (const options of [[{ label: 'Approve' }], undefined]) {
      await expect(ctx.userQuestions.ask({
        questions: [{
          ...question,
          ...(options === undefined ? {} : { options }),
          intent: { kind: 'plan-review', approve: 'Ship it' },
        }],
      })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    }
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a plan-review intent on a question carrying no plan to review', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    // Detail IS the plan for this intent, so a UI honouring it would ask the
    // user to approve something they cannot see.
    await expect(ctx.userQuestions.ask({
      questions: [{
        id: 'plan-review', question: 'Approve?',
        options: [{ label: 'Approve' }, { label: 'Keep planning' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('passes an intent through once its approve label names an offered option', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
    const p = provider('Approve')
    ctx.userQuestions.registerProvider(p)
    /** 中文说明：测试局部值 intent，由紧邻初始化决定。 */
    const intent = { kind: 'plan-review', approve: 'Approve' } as const

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.userQuestions.ask({
      questions: [
        { id: 'plain', question: 'Proceed?' },
        {
          id: 'plan-review', question: 'Approve?', detail: '# Plan',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent,
        },
      ],
    })

    expect(result.answers).toEqual([{ id: 'plain', selected: ['Approve'] }])
    expect(p.seen[0]?.questions[1]?.intent).toEqual(intent)
  })
})
