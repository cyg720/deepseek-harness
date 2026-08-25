/**
 * 文件职责：验证 invariant.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createUserMessage, ProviderRequestId } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RetryInvariant from '@deepseek-ai/dsh-llm-retry/invariant'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import { providerForOpenStep } from '../src/history.ts'

/** 中文说明：函数 setup 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(RetryInvariant)
  return ctx
}

/** 中文说明：函数 openStep 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function openStep(ctx: Context, id: string, turn = 1, step = 1) {
  /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const session = ctx.sessions.create(SessionId(id))
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step })
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock' } },
    reason: 'initial',
  })
  return session
}

/** 中文说明：函数 appendRetryTurn 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function appendRetryTurn(session: Session, turn: number) {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'mock', model: 'mock' } },
    reason: 'initial',
  })
  session.append('llm/retry', { turn, step: 1, ...normal })
}

/** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const failure = { message: 'provider busy', code: 'RATE_LIMIT', status: 429 }
/** 中文说明：变量 normal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const normal = {
  retryId: RetryId('normal-retry-chain'),
  provider: 'mock',
  mode: 'normal' as const,
  policyKey: 'normal-policy',
  retry: 1,
  maxRetries: 2,
  delayMs: 1,
  failure,
}
/** 中文说明：变量 always 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const always = {
  retryId: RetryId('always-retry-chain'),
  provider: 'mock',
  mode: 'always' as const,
  policyKey: 'always-policy',
  retry: 1,
  delayMs: 1,
  failure,
}

describe('llm-retry invariants', () => {
  it('has no provider without the requested open step or a route marker', () => {
    expect(providerForOpenStep([], 1, 1)).toBeUndefined()
    expect(providerForOpenStep([{
      type: 'step/start',
      data: { turn: 1, step: 1 },
    }] as never, 1, 1)).toBeUndefined()
  })

  it('accepts successive bounded and unbounded records inside their open steps', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = openStep(ctx, 'retry-invariant-valid')

    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...normal })
      session.append('llm/retry', {
        turn: 1, step: 1, ...normal, retry: 2, delayMs: 0,
      })
      /** 中文说明：变量 unbounded 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const unbounded = openStep(ctx, 'retry-invariant-always')
      unbounded.append('llm/retry', { turn: 1, step: 1, ...always })
    }).not.toThrow()
    expect(() => { ctx.emit('tools/change') }).not.toThrow()
  })

  it('validates the complete durable failure payload', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 complete 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const complete = openStep(ctx, 'retry-invariant-complete-failure')
    expect(() => {
      complete.append('llm/retry', {
        turn: 1,
        step: 1,
        ...always,
        failure: {
          message: 'provider busy',
          code: 'RATE_LIMIT',
          status: 429,
          providerRetryAfterMs: 25,
          requestId: ProviderRequestId('request-1'),
        },
      })
    }).not.toThrow()

    /** 中文说明：变量 invalidFailures 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const invalidFailures: readonly [string, unknown, RegExp][] = [
      ['null', null, /failure must be an object/],
      ['message-type', { message: 1, code: 'RATE_LIMIT' }, /failure\.message/],
      ['message-empty', { message: '', code: 'RATE_LIMIT' }, /failure\.message/],
      ['code-type', { message: 'failed', code: 1 }, /failure\.code/],
      ['code-empty', { message: 'failed', code: '' }, /failure\.code/],
      ['status-type', { message: 'failed', code: 'RATE_LIMIT', status: 429.5 }, /failure\.status/],
      ['status-low', { message: 'failed', code: 'RATE_LIMIT', status: 99 }, /failure\.status/],
      ['status-high', { message: 'failed', code: 'RATE_LIMIT', status: 600 }, /failure\.status/],
      [
        'retry-after-type',
        { message: 'failed', code: 'RATE_LIMIT', providerRetryAfterMs: '25' },
        /failure\.providerRetryAfterMs/,
      ],
      [
        'retry-after-zero',
        { message: 'failed', code: 'RATE_LIMIT', providerRetryAfterMs: 0 },
        /failure\.providerRetryAfterMs/,
      ],
      ['request-id-type', { message: 'failed', code: 'RATE_LIMIT', requestId: 1 }, /failure\.requestId/],
      ['request-id-empty', { message: 'failed', code: 'RATE_LIMIT', requestId: '' }, /failure\.requestId/],
    ]
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for (const [name, invalidFailure, message] of invalidFailures) {
      /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const session = openStep(ctx, `retry-invariant-failure-${name}`)
      expect(() => {
        session.append('llm/retry', {
          turn: 1, step: 1, ...always, failure: invalidFailure,
        } as never)
      }).toThrow(message)
    }
  })

  it.each([
    ['empty-retry-id', { ...normal, retryId: RetryId('') }, /retryId must be a non-empty string/],
    ['retry-zero', { ...normal, retry: 0 }, /positive safe integer/],
    ['retry-fraction', { ...normal, retry: 1.5 }, /positive safe integer/],
    ['max-zero', { ...normal, maxRetries: 0 }, /positive safe maxRetries/],
    ['max-fraction', { ...normal, maxRetries: 1.5 }, /positive safe maxRetries/],
    ['over-budget', { ...normal, retry: 3 }, /must not exceed/],
    ['always-maximum', { ...always, maxRetries: 2 }, /always mode must omit maxRetries/],
    ['unknown-mode', { ...always, mode: 'sometimes' }, /mode must be normal or always/],
    ['empty-provider', { ...always, provider: '' }, /provider must be a non-empty string/],
    ['empty-policy-key', { ...always, policyKey: '' }, /policyKey must be a non-empty string/],
    ['delay-negative', { ...normal, delayMs: -1 }, /delayMs/],
    ['delay-overflow', { ...normal, delayMs: MAX_TIMER_DELAY_MS + 1 }, /delayMs/],
    ['delay-type', { ...normal, delayMs: '1' }, /delayMs/],
  ])('rejects invalid retry data: %s', async (name, data, message) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = openStep(ctx, `retry-invariant-${name}`)
    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...data } as never)
    }).toThrow(message)
  })

  it('rejects records outside the currently open turn and step', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 absent 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const absent = ctx.sessions.create(SessionId('retry-invariant-no-turn'))
    expect(() => {
      absent.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open turn/)

    /** 中文说明：变量 wrongTurn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wrongTurn = openStep(ctx, 'retry-invariant-wrong-turn')
    expect(() => {
      wrongTurn.append('llm/retry', { turn: 2, step: 1, ...normal })
    }).toThrow(/open turn is 1/)

    /** 中文说明：变量 closedStep 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closedStep = openStep(ctx, 'retry-invariant-closed-step')
    closedStep.append('step/end', { turn: 1, step: 1 })
    expect(() => {
      closedStep.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open step/)

    /** 中文说明：变量 noStep 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noStep = ctx.sessions.create(SessionId('retry-invariant-no-step'))
    noStep.append('turn/start', { turn: 1 })
    expect(() => {
      noStep.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open step/)

    /** 中文说明：变量 wrongStep 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wrongStep = openStep(ctx, 'retry-invariant-wrong-step')
    expect(() => {
      wrongStep.append('llm/retry', { turn: 1, step: 2, ...normal })
    }).toThrow(/open step is 1\/1/)

    /** 中文说明：变量 closedTurn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const closedTurn = openStep(ctx, 'retry-invariant-closed-turn')
    closedTurn.append('step/end', { turn: 1, step: 1 })
    closedTurn.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } },
    })
    expect(() => {
      closedTurn.append('llm/retry', { turn: 1, step: 1, ...normal })
    }).toThrow(/inside an open turn/)
  })

  it('accepts successive retries in one step and rejects skipped numbering', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = openStep(ctx, 'retry-invariant-number-sequence')
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    session.append('llm/retry', { turn: 1, step: 1, ...normal, retry: 2 })

    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...always, retry: 2 })
    }).toThrow(/must equal provider policy retry 1/)
  })

  it('binds retry numbering to the provider policy and resets it for a new step', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 mismatch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mismatch = openStep(ctx, 'retry-invariant-numbering')
    mismatch.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => {
      mismatch.append('llm/retry', { turn: 1, step: 1, ...normal, retry: 1 })
    }).toThrow(/must equal provider policy retry 2/)

    /** 中文说明：变量 reset 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reset = openStep(ctx, 'retry-invariant-reset')
    reset.append('llm/retry', { turn: 1, step: 1, ...normal })
    reset.append('step/end', { turn: 1, step: 1 })
    reset.append('step/start', { turn: 1, step: 2 })
    expect(() => {
      reset.append('llm/retry', {
        turn: 1,
        step: 2,
        ...normal,
        retryId: RetryId('reset-step-2-retry-chain'),
      })
    }).not.toThrow()
  })

  it('keeps one retry identity per provider-policy chain', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 changed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const changed = openStep(ctx, 'retry-invariant-changed-chain-id')
    changed.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => changed.append('llm/retry', {
      turn: 1,
      step: 1,
      ...normal,
      retry: 2,
      retryId: RetryId('changed-retry-chain'),
    })).toThrow(/must preserve retryId/)

    /** 中文说明：变量 reused 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reused = openStep(ctx, 'retry-invariant-reused-chain-id')
    reused.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => reused.append('llm/retry', {
      turn: 1,
      step: 1,
      ...always,
      retryId: normal.retryId,
    })).toThrow(/already owned by another chain/)
  })

  it('validates retry-started correlation and uniqueness', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 empty 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const empty = openStep(ctx, 'retry-started-empty-id')
    expect(() => empty.append('llm/retry-started', {
      retryId: RetryId(''), turn: 1, step: 1, retry: 1,
    })).toThrow(/retryId must be a non-empty string/)

    /** 中文说明：变量 missing 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missing = openStep(ctx, 'retry-started-missing-schedule')
    expect(() => missing.append('llm/retry-started', {
      retryId: RetryId('missing-retry-chain'), turn: 1, step: 1, retry: 1,
    })).toThrow(/pairs no prior scheduled attempt/)

    /** 中文说明：变量 mismatch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const mismatch = openStep(ctx, 'retry-started-location-mismatch')
    mismatch.append('llm/retry', { turn: 1, step: 1, ...normal })
    expect(() => mismatch.append('llm/retry-started', {
      retryId: normal.retryId, turn: 2, step: 1, retry: 1,
    })).toThrow(/turn\/step must match/)

    /** 中文说明：变量 repeated 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const repeated = openStep(ctx, 'retry-started-repeated')
    repeated.append('llm/retry', { turn: 1, step: 1, ...normal })
    repeated.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })
    expect(() => repeated.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })).toThrow(/repeats one scheduled attempt/)
  })

  it('starts a fresh retry chain after incomplete predecessor boundaries', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)

    /** 中文说明：变量 missingEnd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingEnd = ctx.sessions.create(SessionId('retry-invariant-missing-end'))
    missingEnd.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'idle context' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendRetryTurn(missingEnd, 2)

    /** 中文说明：变量 nonFailureEnd 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const nonFailureEnd = ctx.sessions.create(SessionId('retry-invariant-non-failure-end'))
    nonFailureEnd.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    nonFailureEnd.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'idle context' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    appendRetryTurn(nonFailureEnd, 2)

    /** 中文说明：变量 missingStart 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const missingStart = ctx.sessions.create(SessionId('retry-invariant-missing-start'))
    missingStart.append('turn/end', { turn: 1, reason: { kind: 'error', error: failure },
    })
    appendRetryTurn(missingStart, 2)

    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).resolves.toBeDefined()
  })

  it('rejects a provider that does not match the failed request route', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = openStep(ctx, 'retry-invariant-provider')
    expect(() => {
      session.append('llm/retry', { turn: 1, step: 1, ...always, provider: 'other' })
    }).toThrow(/does not match the failed request provider mock/)
  })

  it('validates existing histories on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = ctx.sessions.create(SessionId('retry-invariant-late'))
    session.append('step/start', { turn: 1, step: 1 })
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).rejects.toThrow(/inside an open turn/)
  })

  it('accepts a scheduled and started attempt on late registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    /** 中文说明：变量 session 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const session = openStep(ctx, 'retry-invariant-late-started')
    session.append('llm/retry', { turn: 1, step: 1, ...normal })
    session.append('llm/retry-started', {
      retryId: normal.retryId, turn: 1, step: 1, retry: 1,
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(RetryInvariant)).resolves.toBeDefined()
  })
})
