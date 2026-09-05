/**
 * 文件职责：验证 llm/token-meter 中 turn usage spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { deriveTurnTokenUsage } from '../src/turn-usage.ts'

/**
 * 功能说明：处理 event 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param type （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param data （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEvent；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 event(seq, type, data)，并按返回类型处理结果。
 */
function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

type UsageOverrides = { [Key in keyof TokenUsage]?: TokenUsage[Key] | undefined }

/**
 * 功能说明：处理 usage 相关流程；使用场景由所在模块及调用位置决定。
 * @param overrides （UsageOverrides）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TokenUsage；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 usage(overrides)，并按返回类型处理结果。
 */
function usage(overrides: UsageOverrides = {}): TokenUsage {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = {
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 170,
    cacheReadTokens: 50,
    ...overrides,
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[, entry]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([, entry])，并按返回类型处理结果。
   */
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as unknown as TokenUsage
}

/**
 * 功能说明：处理 message 相关流程；使用场景由所在模块及调用位置决定。
 * @param seq （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param tokenUsage （TokenUsage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param provider （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param model （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param step （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 message(seq, tokenUsage, provider, model, step)，
 * 并按返回类型处理结果。
 */
function message(
  seq: number,
  tokenUsage?: TokenUsage,
  provider = 'deepseek',
  model = 'deepseek-chat',
  step = 1,
  streamTokenUsage = tokenUsage,
) {
  return event(seq, 'assistant/message', {
    turn: 1,
    step,
    stream: [
      { type: 'chunk', time: seq, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      ...(streamTokenUsage === undefined
        ? []
        : [{ type: 'chunk' as const, time: seq, chunk: { type: 'usage' as const, usage: streamTokenUsage } }]),
    ],
    message: {
      id: `message-${seq}`,
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      source: { kind: 'model', provider, model },
    },
    ...tokenUsage === undefined ? {} : { usage: tokenUsage },
  })
}

function attempt(seq: number, chunks: readonly StreamChunk[], step = 1): SessionEvent {
  return event(seq, 'assistant/attempt', {
    turn: 1,
    step,
    stream: chunks.map((chunk, index) => ({ type: 'chunk', time: seq + index, chunk })),
  })
}

function completeAttempt(...middle: readonly SessionEvent[]): SessionEvent[] {
  return [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    ...middle,
    event(90, 'step/end', { turn: 1, step: 1 }),
    event(91, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('deriveTurnTokenUsage', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('preserves authoritative totals and explicit optional buckets', () => {
    expect(deriveTurnTokenUsage(completeAttempt(message(3, usage({
      cacheWriteTokens: 0,
      reasoningTokens: 8,
    }))))).toEqual({
      uncachedInputTokens: 100,
      outputTokens: 20,
      totalTokens: 170,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
      reasoningTokens: 8,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('derives an exact total only when both cache buckets are present', () => {
    expect(deriveTurnTokenUsage(completeAttempt(message(3, usage({
      totalTokens: undefined,
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    }))))?.totalTokens).toBe(17)

    expect(deriveTurnTokenUsage(completeAttempt(message(3, usage({
      totalTokens: undefined,
      cacheWriteTokens: undefined,
    }))))).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('lets final message usage replace the latest streaming sample', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = deriveTurnTokenUsage(completeAttempt(
      message(
        4,
        usage({ inputTokens: 30, outputTokens: 5, totalTokens: 45, cacheReadTokens: 10 }),
        'deepseek',
        'deepseek-chat',
        1,
        usage(),
      ),
    ))
    expect(result).toMatchObject({ uncachedInputTokens: 30, outputTokens: 5, totalTokens: 45 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('keeps the latest streaming sample when the final message omits usage', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = deriveTurnTokenUsage(completeAttempt(
      message(4, undefined, 'deepseek', 'deepseek-chat', 1, usage()),
    ))
    expect(result).toMatchObject({ uncachedInputTokens: 100, outputTokens: 20, totalTokens: 170 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('counts an error-finished attempt once across its retry boundary', () => {
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = completeAttempt(
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'failed' } } },
      ]),
      event(5, 'llm/retry', { turn: 1, step: 1 }),
      event(6, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }),
      message(7, usage({ inputTokens: 40, outputTokens: 10, totalTokens: 70, cacheReadTokens: 20 })),
    )
    expect(deriveTurnTokenUsage(events)).toEqual({
      uncachedInputTokens: 140,
      outputTokens: 30,
      totalTokens: 240,
      cacheReadTokens: 70,
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('does not invent an attempt for a scheduled retry that never started', () => {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = deriveTurnTokenUsage(completeAttempt(
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'failed' } } },
      ]),
      event(4, 'llm/retry', { turn: 1, step: 1 }),
    ))
    expect(result).toMatchObject({ totalTokens: 170 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails closed for missing lifecycle or missing attempt usage', () => {
    expect(deriveTurnTokenUsage([
      event(1, 'turn/start', { turn: 1 }),
      message(2, usage()),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toBeUndefined()
    expect(deriveTurnTokenUsage(completeAttempt(message(3)))).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_label（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：invalidUsage（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_label, invalidUsage)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['negative', usage({ inputTokens: -1 })],
    ['fractional', usage({ outputTokens: 1.5 })],
    ['unsafe', usage({ totalTokens: Number.MAX_SAFE_INTEGER + 1 })],
    ['invalid cache read', usage({ cacheReadTokens: -1 })],
    ['invalid cache write', usage({ cacheWriteTokens: 1.5 })],
    ['negative exact prompt', usage({ outputTokens: 20, totalTokens: 10, cacheReadTokens: undefined })],
    ['total below known prompt', usage({ totalTokens: 160 })],
    ['contradictory complete buckets', usage({ totalTokens: 171, cacheWriteTokens: 0 })],
    ['reasoning exceeds output', usage({ reasoningTokens: 21 })],
    ['prompt bucket overflow', usage({
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 0,
      totalTokens: Number.MAX_SAFE_INTEGER,
      cacheReadTokens: 1,
    })],
    ['derived total overflow', usage({
      inputTokens: Number.MAX_SAFE_INTEGER,
      outputTokens: 1,
      totalTokens: undefined,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })],
  ])('fails closed for %s usage', (_label, invalidUsage) => {
    expect(deriveTurnTokenUsage(completeAttempt(message(3, invalidUsage)))).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('omits optional aggregates and routes unless every attempt reports them', () => {
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, usage({ totalTokens: 175, cacheWriteTokens: 5, reasoningTokens: 2 })),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'step/start', { turn: 1, step: 2 }),
      event(6, 'assistant/message', {
        turn: 1,
        step: 2,
        message: {
          id: 'message-6', role: 'assistant', content: [],
          source: { kind: 'model', provider: '', model: '' },
        },
        usage: usage({ cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined }),
      }),
      event(7, 'step/end', { turn: 1, step: 2 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveTurnTokenUsage(events)).toEqual({ uncachedInputTokens: 200, outputTokens: 40, totalTokens: 345 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('sums multiple steps and preserves distinct attributed routes', () => {
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, usage()),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'step/start', { turn: 1, step: 2 }),
      message(6, usage(), 'openai', 'gpt-5', 2),
      event(7, 'step/end', { turn: 1, step: 2 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveTurnTokenUsage(events)).toEqual({
      uncachedInputTokens: 200,
      outputTokens: 40,
      totalTokens: 340,
      cacheReadTokens: 100,
      routes: [
        { provider: 'deepseek', model: 'deepseek-chat' },
        { provider: 'openai', model: 'gpt-5' },
      ],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails closed when aggregation overflows a safe integer', () => {
    /**
     * 常量说明：half 用于处理 half 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = usage({ inputTokens: 0, outputTokens: 0, cacheReadTokens: undefined, totalTokens: half })
    /**
     * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const events = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, attempt),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'step/start', { turn: 1, step: 2 }),
      event(6, 'assistant/message', {
        turn: 1,
        step: 2,
        message: {
          id: 'message-6', role: 'assistant', content: [],
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
        },
        usage: attempt,
      }),
      event(7, 'step/end', { turn: 1, step: 2 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_label（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：attempt（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_label, attempt)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['uncached input', usage({
      inputTokens: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
      outputTokens: 0,
      cacheReadTokens: undefined,
      totalTokens: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
    })],
    ['output', usage({
      inputTokens: 0,
      outputTokens: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
      cacheReadTokens: undefined,
      totalTokens: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
    })],
  ])('fails closed when aggregate %s overflows', (_label, attempt) => {
    expect(deriveTurnTokenUsage([
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, attempt),
      event(4, 'step/end', { turn: 1, step: 1 }),
      event(5, 'step/start', { turn: 1, step: 1 }),
      message(6, attempt),
      event(7, 'step/end', { turn: 1, step: 1 }),
      event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('closes a sampled attempt at step/end', () => {
    expect(deriveTurnTokenUsage(completeAttempt(
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
      event(5, 'tool/call', { turn: 1, step: 1 }),
    ))).toMatchObject({ totalTokens: 170 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('accepts an aborted finish after observing usage', () => {
    expect(deriveTurnTokenUsage(completeAttempt(
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } },
      ]),
    ))).toMatchObject({ totalTokens: 170 })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_label（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：events（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_label, events)，
   * 并按返回类型处理结果。
   */
  it.each([
    ['empty turn', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]],
    ['duplicate turn start', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'turn/start', { turn: 1 }),
    ]],
    ['wrong turn end', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]],
    ['turn end during an open attempt', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]],
    ['duplicate turn end', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]],
    ['event after turn end', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(3, 'step/start', { turn: 1, step: 1 }),
    ]],
    ['wrong-turn step start', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 2, step: 1 }),
    ]],
    ['nested step start', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'step/start', { turn: 1, step: 2 }),
    ]],
    ['retry start without a scheduled retry', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }),
    ]],
    ['retry start after a final message', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, usage()),
      event(4, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }),
    ]],
    ['retry start for the wrong step', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'failed' } } },
      ]),
      event(4, 'llm/retry', { turn: 1, step: 1 }),
      event(5, 'llm/retry-started', { turn: 1, step: 2, retry: 1 }),
    ]],
    ['attempt outside a step', [
      event(1, 'turn/start', { turn: 1 }),
      attempt(2, [{ type: 'usage', usage: usage() }]),
    ]],
    ['attempt for the wrong step', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      attempt(3, [{ type: 'usage', usage: usage() }], 2),
    ]],
    ['error finish without usage', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      attempt(3, [{
        type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'failed' } },
      }]),
    ]],
    ['retry outside an attempt', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'llm/retry', { turn: 1, step: 1 }),
    ]],
    ['retry for the wrong step', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      attempt(3, [
        { type: 'usage', usage: usage() },
        { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'failed' } } },
      ]),
      event(4, 'llm/retry', { turn: 1, step: 2 }),
    ]],
    ['retry after a final message', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      message(3, usage()),
      event(4, 'llm/retry', { turn: 1, step: 1 }),
    ]],
    ['retry before any usage', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'llm/retry', { turn: 1, step: 1 }),
    ]],
    ['step end outside an attempt', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/end', { turn: 1, step: 1 }),
    ]],
    ['step end for the wrong step', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'step/end', { turn: 1, step: 2 }),
    ]],
    ['step end before any usage', [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'step/end', { turn: 1, step: 1 }),
    ]],
  ])('fails closed for invalid lifecycle: %s', (_label, events) => {
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('requires the complete turn window', () => {
    expect(deriveTurnTokenUsage(completeAttempt(message(3, usage())).slice(1))).toBeUndefined()
    expect(deriveTurnTokenUsage(completeAttempt(message(3, usage())).slice(0, -1))).toBeUndefined()
  })
})
