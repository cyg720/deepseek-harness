/**
 * SubmitMachine behavior: enter routing, adjudication outcomes, the claimed
 * lifecycle and its integrity watch, settlement (commit-draft and claim
 * re-entry decisions), anti-backwash, and per-session isolation. Text-edit
 * semantics live in the editor (lexical-editor-core spec) — the machine only
 * observes drafts through event payloads.
 * @remarks 文件说明：文件职责：验证 client/ui-conversation 中 submit machine client
 * spec 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it } from 'vitest'
import type { CommandClaim } from '../src/client/contract/input.ts'
import type { InputEffect, SubmitAttempt } from '../src/client/contract/input.ts'
import { SubmitMachine } from '../src/client/input/machine.ts'
import { scanTextRefs } from '../src/client/input/decorations.ts'

/**
 * 功能说明：处理 claimOf 相关流程；使用场景由所在模块及调用位置决定。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param hint （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns CommandClaim；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 claimOf(name, hint)，并按返回类型处理结果。
 */
function claimOf(name: string, hint?: string): CommandClaim {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return {
    token: `/${name} `,
    ...(hint !== undefined ? { hint } : {}),
    submit: async () => ({ kind: 'success' }),
  }
}

/**
 * 功能说明：处理 effectAt 相关流程；使用场景由所在模块及调用位置决定。
 * @param effects （readonly InputEffect[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param index （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param type （T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Extract<InputEffect, { type: T }>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 effectAt(effects, index, type)，并按返回类型处理结果。
 */
function effectAt<T extends InputEffect['type']>(
  effects: readonly InputEffect[], index: number, type: T,
): Extract<InputEffect, { type: T }> {
  /**
   * 常量说明：e 用于处理 e 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const e = effects[index]
  expect(e?.type).toBe(type)
  return e as Extract<InputEffect, { type: T }>
}

/** Drive plain → adjudicating and hand back the minted attempt.
 * @remarks 中文说明：功能说明：处理 enterAdjudicating 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：m（SubmitMachine）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：draft（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：mode（'queue' |
 * 'steer'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SubmitAttempt；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 enterAdjudicating(m, draft, mode)，
 * 并按返回类型处理结果。 */
function enterAdjudicating(m: SubmitMachine, draft: string, mode: 'queue' | 'steer' = 'queue'): SubmitAttempt {
  /**
   * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fx = m.dispatch({ type: 'enter', mode, draft })
  return effectAt(fx, 0, 'adjudicate').attempt
}

/** Drive plain → claimed → submitting and hand back attempt + claim.
 * @remarks 中文说明：功能说明：处理 enterSubmitting 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：m（SubmitMachine）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：args（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：{ attempt:
 * SubmitAttempt; claim: CommandClaim }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 enterSubmitting(m, name, args)，并按返回类型处理结果。 */
function enterSubmitting(m: SubmitMachine, name: string, args: string): { attempt: SubmitAttempt; claim: CommandClaim } {
  /**
   * 常量说明：claim 用于处理 claim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const claim = claimOf(name)
  m.dispatch({ type: 'claim', claim })
  /**
   * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: claim.token + args })
  return { attempt: effectAt(fx, 0, 'begin-submit').attempt, claim }
}

/**
 * 功能说明：处理 staleAttempt 相关流程；使用场景由所在模块及调用位置决定。
 * @returns SubmitAttempt；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 staleAttempt()，并按返回类型处理结果。
 */
function staleAttempt(): SubmitAttempt {
  return { seq: 9999, signal: new AbortController().signal, draftSnapshot: '', mode: 'queue' }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('submit-machine: plain × enter', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('empty and whitespace-only drafts produce nothing', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    expect(m.dispatch({ type: 'enter', mode: 'queue', draft: '' })).toEqual([])
    expect(m.dispatch({ type: 'enter', mode: 'queue', draft: '  \n ' })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('non-command text falls to the default sink with the draft and mode', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: 'hello' })
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sink = effectAt(fx, 0, 'default-sink')
    expect(sink.draft).toBe('hello')
    expect(sink.mode).toBe('queue')
    expect(sink.attempt.draftSnapshot).toBe('hello')
    expect(effectAt(fx, 1, 'commit-draft').retainSuffixOf).toBe('hello')
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('retains an explicit steer mode on the default sink effect', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'steer', draft: 'go' })
    expect(effectAt(fx, 0, 'default-sink').mode).toBe('steer')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leading "/" enters adjudicating with a minted attempt carrying the draft snapshot', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: '/goal write tests' })
    /**
     * 常量说明：adjudicate 用于处理 adjudicate 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const adjudicate = effectAt(fx, 0, 'adjudicate')
    expect(adjudicate.draft).toBe('/goal write tests')
    expect(adjudicate.attempt.draftSnapshot).toBe('/goal write tests')
    expect(adjudicate.attempt.signal.aborted).toBe(false)
    expect(m.state.phase).toBe('adjudicating')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('leading is judged after trim including newlines', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: ' \n /goal x' })
    expect(effectAt(fx, 0, 'adjudicate').draft).toBe(' \n /goal x')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a non-whitespace prefix before "/" is not leading — default sink', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: 'see /goal' })
    expect(effectAt(fx, 0, 'default-sink').draft).toBe('see /goal')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('submit-machine: adjudication outcomes', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('{claim} moves to submitting; args split on the first whitespace, newlines kept', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/goal write x\nand y')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    /**
     * 常量说明：begin 用于处理 begin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const begin = effectAt(fx, 0, 'begin-submit')
    expect(begin.args).toBe('write x\nand y')
    expect(m.state.phase).toBe('submitting')
    expect(m.state.claim?.token).toBe('/goal ')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('bare "/goal" claim yields empty args; leading whitespace snapshot yields trimmed args', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/goal')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    expect(effectAt(fx, 0, 'begin-submit').args).toBe('')

    /**
     * 常量说明：m2 用于处理 m2 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m2 = new SubmitMachine()
    /**
     * 常量说明：attempt2 用于处理 attempt2 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt2 = enterAdjudicating(m2, '  /goal args')
    /**
     * 常量说明：fx2 用于处理 fx2 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx2 = m2.dispatch({ type: 'adjudicated', attempt: attempt2, outcome: { claim: claimOf('goal') } })
    expect(effectAt(fx2, 0, 'begin-submit').args).toBe('args')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('undefined outcome falls back to the default sink with the snapshot', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/unknown thing', 'steer')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'adjudicated', attempt, outcome: undefined })
    /**
     * 常量说明：sink 用于处理 sink 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const sink = effectAt(fx, 0, 'default-sink')
    expect(sink.draft).toBe('/unknown thing')
    expect(sink.mode).toBe('steer')
    expect(effectAt(fx, 1, 'commit-draft').retainSuffixOf).toBe('/unknown thing')
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it("'handled' lands plain with zero effects (popup shell path)", () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/model')
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: 'handled' })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('adjudication failure notices and keeps plain — no silent downgrade', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/goal x')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'adjudication-failed', attempt, message: 'warmup failed' })
    expect(effectAt(fx, 0, 'notice')).toMatchObject({ level: 'error', text: 'warmup failed' })
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enter is a no-op while adjudicating (pending lock)', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'enter', mode: 'queue', draft: '/goal x' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a stale attempt on adjudicated/adjudication-failed is dropped: same state, zero effects', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    enterAdjudicating(m, '/goal x')
    expect(m.dispatch({ type: 'adjudicated', attempt: staleAttempt(), outcome: undefined })).toEqual([])
    expect(m.dispatch({ type: 'adjudication-failed', attempt: staleAttempt(), message: 'x' })).toEqual([])
    expect(m.state.phase).toBe('adjudicating')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('an adjudicated result arriving after release is dropped (anti-backwash)', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '/goal x')
    m.dispatch({ type: 'release' })
    expect(attempt.signal.aborted).toBe(true)
    expect(m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('submit-machine: claimed lifecycle', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('the claim event enters claimed and snapshots hint and images bits', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    m.dispatch({ type: 'claim', claim: { ...claimOf('goal', 'set a goal'), attachments: true } })
    expect(m.state.phase).toBe('claimed')
    expect(m.state.claim).toMatchObject({ token: '/goal ', hint: 'set a goal', attachments: true })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('claimed overwrites in place — no stack', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    m.dispatch({ type: 'claim', claim: claimOf('goal') })
    m.dispatch({ type: 'claim', claim: claimOf('plan') })
    expect(m.state.claim?.token).toBe('/plan ')
    expect(m.state.phase).toBe('claimed')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('submitting rejects the claim event (lock)', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'claim', claim: claimOf('plan') })
    expect(m.state.claim?.token).toBe('/goal ')
    expect(m.state.phase).toBe('submitting')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('breaking startsWith(token) auto-releases back to plain', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    m.dispatch({ type: 'claim', claim: claimOf('goal') })
    m.dispatch({ type: 'draft-changed', draft: '/goal args fine' })
    expect(m.state.phase).toBe('claimed')
    m.dispatch({ type: 'draft-changed', draft: '/goa' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('explicit release returns to plain when nothing is in flight', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    m.dispatch({ type: 'claim', claim: claimOf('goal') })
    m.dispatch({ type: 'release' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enter begins the submit transaction: args = draft minus token, multi-line legal', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    m.dispatch({ type: 'claim', claim: claimOf('goal') })
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: '/goal line one\nline two' })
    expect(effectAt(fx, 0, 'begin-submit').args).toBe('line one\nline two')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('submit-machine: submitting transaction', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enter and claim are locked while submitting; draft-changed is recorded without leaving submitting', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    enterSubmitting(m, 'goal', 'x')
    expect(m.dispatch({ type: 'enter', mode: 'queue', draft: '/goal x' })).toEqual([])
    m.dispatch({ type: 'draft-changed', draft: 'typed during flight' })
    expect(m.state.phase).toBe('submitting')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('commit emits commit-draft with the snapshot, releases the claim, and relays the outcome text', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({
      type: 'submit-settled', attempt, ok: true, draft: '/goal x',
      outcome: { kind: 'success', text: 'goal saved' },
    })
    expect(effectAt(fx, 0, 'commit-draft').retainSuffixOf).toBe('/goal x')
    expect(effectAt(fx, 1, 'notice')).toMatchObject({ level: 'info', text: 'goal saved' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('an error-kind outcome text relays as an error notice on success=false settles', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({
      type: 'submit-settled', attempt, ok: false, draft: 'deviated',
      outcome: { kind: 'error', text: 'rejected' },
    })
    expect(effectAt(fx, 0, 'notice')).toMatchObject({ level: 'error', text: 'rejected' })
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rollback with an undeviated draft keeps the claim and re-enters claimed', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt, ok: false, draft: '/goal x', message: 'transport' })
    expect(m.state.phase).toBe('claimed')
    expect(m.state.claim?.token).toBe('/goal ')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rollback with a deviated draft only notices — the newer input wins', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'submit-settled', attempt, ok: false, draft: 'rewritten', message: 'transport' })
    expect(effectAt(fx, 0, 'notice')).toMatchObject({ level: 'error', text: 'transport' })
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enter-path rollback cannot re-enter claimed when the snapshot never carried the bare token prefix', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attempt = enterAdjudicating(m, '  /goal x')
    m.dispatch({ type: 'adjudicated', attempt, outcome: { claim: claimOf('goal') } })
    m.dispatch({ type: 'submit-settled', attempt, ok: false, draft: '  /goal x', message: 'nope' })
    // The snapshot carries leading whitespace the token never had: plain, claim cleared.
    expect(m.state.phase).toBe('plain')
    expect(m.state.claim).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a stale settle after rollback + resubmit is dropped (anti-backwash)', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt: first } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'submit-settled', attempt: first, ok: false, draft: '/goal x', message: 'try again' })
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'enter', mode: 'queue', draft: '/goal x' })
    /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const second = effectAt(fx, 0, 'begin-submit').attempt
    expect(m.dispatch({ type: 'submit-settled', attempt: first, ok: true, draft: '/goal x' })).toEqual([])
    expect(m.state.phase).toBe('submitting')
    m.dispatch({ type: 'submit-settled', attempt: second, ok: true, draft: '/goal x' })
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('release mid-flight aborts the attempt and later settles are dropped', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(m, 'goal', 'x')
    m.dispatch({ type: 'release' })
    expect(attempt.signal.aborted).toBe(true)
    expect(m.dispatch({ type: 'submit-settled', attempt, ok: true, draft: '' })).toEqual([])
    expect(m.state.phase).toBe('plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('send-committed clears unconditionally (image-only sends have no draft to retain)', () => {
    /**
     * 常量说明：m 用于处理 m 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const m = new SubmitMachine()
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = m.dispatch({ type: 'send-committed' })
    expect(effectAt(fx, 0, 'commit-draft').retainSuffixOf).toBeNull()
    /**
     * 常量说明：busy 用于处理 busy 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const busy = new SubmitMachine()
    enterSubmitting(busy, 'goal', 'x')
    expect(busy.dispatch({ type: 'send-committed' })).toEqual([])
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('submit-machine: per-session isolation', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('one instance per session: A submitting never locks B; settles land on their own instance', () => {
    /**
     * 常量说明：a 用于处理 a 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const a = new SubmitMachine()
    /**
     * 常量说明：b 用于处理 b 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const b = new SubmitMachine()
    /**
     * 常量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { attempt } = enterSubmitting(a, 'goal', 'x')
    /**
     * 常量说明：fx 用于处理 fx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fx = b.dispatch({ type: 'enter', mode: 'queue', draft: 'hello' })
    expect(effectAt(fx, 0, 'default-sink').draft).toBe('hello')
    a.dispatch({ type: 'submit-settled', attempt, ok: true, draft: '/goal x' })
    expect(a.state.phase).toBe('plain')
    expect(b.state.phase).toBe('plain')
  })
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('decorations: scanTextRefs', () => {
  /**
   * 常量说明：lexicon 用于处理 lexicon 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const lexicon: ReadonlyMap<'/' | '@', readonly string[]> = new Map([
    ['/', ['commit-helper', 'goal'] as readonly string[]],
    ['@', ['research'] as readonly string[]],
  ])

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('matches lexicon tokens at line start and after whitespace, in draft order', () => {
    /**
     * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const out = scanTextRefs('/goal then @research and /commit-helper', lexicon)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：r（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(r)，并按返回类型处理结果。
     */
    expect(out.map(r => [r.start, r.end, r.trigger])).toEqual([
      [0, 5, '/'], [11, 20, '@'], [25, 39, '/'],
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('a cold (empty) lexicon scans nothing lexicon-based', () => {
    expect(scanTextRefs('/goal x', new Map())).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('recognizes directory paths independently of the dynamic lexicon', () => {
    /**
     * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const out = scanTextRefs('see @src/x/ now', new Map())
    expect(out).toEqual([{ start: 4, end: 11, trigger: '@' }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('names off the lexicon do not match; triggers are routed per lexicon list', () => {
    expect(scanTextRefs('/research @goal', lexicon)).toEqual([])
  })

  it('a "/" token continued by a path never matches, even when the name is on the lexicon', () => {
    expect(scanTextRefs('/goal/x /goal/ /goal.md', lexicon)).toEqual([])
  })

  it('a "/" token glued to punctuation is not a reference: the host gesture is whitespace-bounded', () => {
    expect(scanTextRefs('/goal。 then /goal, now', lexicon)).toEqual([])
  })

  it('word boundary: a trigger glued to text never matches', () => {
    expect(scanTextRefs('x/goal y@research', lexicon)).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('tokens never cross a newline; a token straight after one matches', () => {
    /**
     * 常量说明：out 用于处理 out 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const out = scanTextRefs('a\n/goal', lexicon)
    expect(out).toEqual([{ start: 2, end: 7, trigger: '/' }])
  })
})
