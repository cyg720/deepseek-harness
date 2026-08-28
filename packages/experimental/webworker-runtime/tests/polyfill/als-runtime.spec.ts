/**
 * Semantic check of the suspension runtime (`src/polyfill/async-context/als-runtime.ts`): the object the
 * transformed modules call at every suspension point.
 *
 * Scope boundary, and why this file does not need the Node-compatibility layer:
 * `als-runtime.ts` owns no state. It moves snapshots through an injected
 * {@link AlsCausality} face, and the state itself lives in the
 * `node:async_hooks` proxy. So the causality face is stubbed here with a
 * recording double, which makes the *ordering* contract — the part transformed
 * code depends on — directly observable:
 *
 *   - `pause` captures BEFORE suspending (not after), so the snapshot belongs to
 *     the frame that suspended;
 *   - `resume` restores BEFORE returning or rethrowing, so the resumed frame's
 *     first observable act is already in the right context;
 *   - both completion paths do this, which is why the token always fulfills.
 *
 * The shim-backed end of the same contract (does a real AsyncLocalStorage
 * actually fold, do the hooks cover timers) is `als-shim.spec.ts`. This file is
 * the middle layer: the protocol, in isolation.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 als runtime spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { expect, test } from 'vitest'
import { createAlsRuntime, type AlsCausality, type AlsToken } from '../../src/polyfill/async-context/als-runtime.ts'

/**
 * 常量说明：check 用于处理 check 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 check 相关流程；使用场景由所在模块及调用位置决定。
 * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param actual （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param expected （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 check(label, actual, expected)，并按返回类型处理结果。
 */
const check = (label: string, actual: unknown, expected: unknown): void => {
  /**
   * 常量说明：seen、wanted 用于处理 seen、wanted 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [seen, wanted] = [JSON.stringify(actual), JSON.stringify(expected)]
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  test(label, () => { expect(seen).toBe(wanted) })
}

/**
 * A causality double standing in for the `node:async_hooks` proxy: one mutable
 * "current store" plus a log, so every snapshot/restore is observable in order.
 * @remarks 中文说明：功能说明：处理 recordingCausality 相关流程；使用场景由所在模块及调用位置决定。；返回值：{
 * readonly causality: AlsCausality readonly log: string[] current: st…；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 recordingCausality()，
 * 并按返回类型处理结果。
 */
function recordingCausality(): {
  readonly causality: AlsCausality
  readonly log: string[]
  current: string
} {
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(snapshot)，并按返回类型处理结果。
   */
  const state = {
    current: 'root',
    log: [] as string[],
    causality: {
      snapshot: (): unknown => {
        state.log.push(`snapshot:${state.current}`)
        return state.current
      },
      restore: (snapshot: unknown): void => {
        state.current = snapshot as string
        state.log.push(`restore:${state.current}`)
      },
    },
  }
  return state
}

// ---------------------------------------------------------------------------
// 1. pause: capture before suspending, and always fulfill.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)

  state.current = 'session-A'
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = als.pause('value')
  // The capture is synchronous with the call, before any microtask can run: that
  // is what makes the snapshot belong to the suspending frame.
  check('pause captures synchronously, before suspending', state.log, ['snapshot:session-A'])

  // Something else runs on this thread while the frame is suspended.
  state.current = 'session-B'
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await pending
  check('token reports fulfilment', token.ok, true)
  check('token carries the awaited value', token.value, 'value')
  check('token carries the snapshot taken at pause time', token.snapshot, 'session-A')
  check('pause does not restore by itself', state.current, 'session-B')
}

{
  // A rejection must travel INSIDE the token, so the token itself always
  // fulfills; otherwise `await __als.pause(x)` would throw before `resume` had a
  // chance to restore, and the catch clause would run in the wrong context.
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)
  state.current = 'session-R'
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failure = new Error('boom')
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await als.pause(Promise.reject(failure))
  check('a rejection does not reject the token', token.ok, false)
  check('the token carries the error', token.error, failure)
  check('the rejected token still carries the snapshot', token.snapshot, 'session-R')
}

{
  // Non-promise and thenable inputs both work: the rewrite wraps every `await`
  // operand, most of which are not promises.
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  check('pause accepts a plain value', (await als.pause(7)).value, 7)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（(v: unknown) =>
   * void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  check('pause accepts a thenable', (await als.pause({ then: (resolve: (v: unknown) => void) => { resolve('t') } })).value, 't')
  /**
   * 常量说明：nested 用于处理 nested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const nested = await als.pause(Promise.resolve(Promise.resolve('deep')))
  check('pause unwraps a nested promise', nested.value, 'deep')
}

// ---------------------------------------------------------------------------
// 2. resume: restore before handing control back, on both paths.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)

  state.current = 'session-A'
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await als.pause('payload')
  state.current = 'someone-else'
  state.log.length = 0

  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = als.resume(token)
  check('resume returns the value', value, 'payload')
  check('resume restored the captured snapshot', state.current, 'session-A')
  check('resume restores exactly once', state.log, ['restore:session-A'])
}

{
  // The rejection path restores too, and only then rethrows: a catch clause
  // must observe the caller's store.
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)
  state.current = 'session-C'
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failure = new Error('nope')
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await als.pause(Promise.reject(failure))
  state.current = 'someone-else'

  /**
   * 变量说明：caught 用于处理 caught 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let caught: unknown
  /**
   * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    als.resume(token)
  } catch (reason) {
    caught = reason
  }
  check('resume rethrows the original error', caught, failure)
  check('resume restored the context before rethrowing', state.current, 'session-C')
}

{
  // Two frames suspended at once must not cross: this is the single-threaded
  // shape of the concurrency bug the whole protocol exists to prevent.
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)

  state.current = 'lane-1'
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = als.pause('one')
  state.current = 'lane-2'
  /**
   * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const second = als.pause('two')

  /**
   * 常量说明：tokenA、tokenB 用于处理 tokenA、tokenB 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const [tokenA, tokenB] = await Promise.all([first, second])
  state.current = 'root'
  check('interleaved pauses keep their own snapshots', [tokenA.snapshot, tokenB.snapshot], ['lane-1', 'lane-2'])

  als.resume(tokenA)
  check('resuming the first frame restores lane-1', state.current, 'lane-1')
  als.resume(tokenB)
  check('resuming the second frame restores lane-2', state.current, 'lane-2')
}

// ---------------------------------------------------------------------------
// 3. snapshot / afterYield: the generator half.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const state = recordingCausality()
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(state.causality)

  state.current = 'gen-A'
  /**
   * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const captured = als.snapshot()
  check('snapshot returns the current store', captured, 'gen-A')

  // While suspended at a `yield`, the consumer may run anything.
  state.current = 'consumer'
  /**
   * 常量说明：sent 用于处理 sent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sent = als.afterYield(captured, 'sent-value')
  check('afterYield passes the consumer value through unchanged', sent, 'sent-value')
  check('afterYield restores the generator context', state.current, 'gen-A')
}

{
  // afterYield must be transparent to every value shape, including undefined:
  // `yield x` with no `next(v)` sends undefined, and swallowing it would change
  // the generator's observable behaviour.
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  check('afterYield passes undefined through', als.afterYield('s', undefined), undefined)
  check('afterYield passes null through', als.afterYield('s', null), null)
  /**
   * 常量说明：object 用于处理 object 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const object = { a: 1 }
  check('afterYield passes an object through by identity', als.afterYield('s', object) === object, true)
}

// ---------------------------------------------------------------------------
// 4. iterator: async sources pass through, sync sources are adapted.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)

  // An async iterable's own iterator is used directly (no wrapping), so its
  // `return`/`throw` stay whatever the source provided.
  /**
   * 常量说明：inner 用于处理 inner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const inner = { next: () => Promise.resolve({ done: true, value: undefined }) }
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const source = { [Symbol.asyncIterator]: () => inner }
  check('an async iterable yields its own iterator', als.iterator(source) === inner, true)
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // Async-from-sync: a sync iterator whose values are promises must be awaited,
  // because `for await` awaits each value.
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const source = {
    [Symbol.iterator]: () => [Promise.resolve('a'), Promise.resolve('b')][Symbol.iterator](),
  }
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const iterator = als.iterator(source)
  check('sync source step 1 is awaited', await iterator.next(), { done: false, value: 'a' })
  check('sync source step 2 is awaited', await iterator.next(), { done: false, value: 'b' })
  check('sync source reports completion', (await iterator.next()).done, true)
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // `return()` on the adapter must reach the sync iterator's own `return`,
  // because that is where a generator's `finally` runs.
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed = 0
  /**
   * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sent（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(sent)，并按返回类型处理结果。
   */
  const source = {
    [Symbol.iterator]: () => ({
      next: () => ({ done: false, value: 1 }),
      return: (sent?: unknown) => {
        closed += 1
        return { done: true, value: sent }
      },
    }),
  }
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const iterator = als.iterator(source)
  await iterator.next()
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = await iterator.return?.('bye')
  check('adapter forwards return to the sync iterator', closed, 1)
  check('adapter reports the forwarded return result', result, { done: true, value: 'bye' })
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // A sync iterator with no `return` must not crash the adapter: plain array
  // iterators have one, but hand-rolled ones often do not.
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const iterator = als.iterator({ [Symbol.iterator]: () => ({ next: () => ({ done: true, value: undefined }) }) })
  check('adapter tolerates a sync iterator without return', await iterator.return?.(undefined), { done: true, value: undefined })
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // A non-iterable is a programming error in the transformed source, and must be
  // a loud TypeError rather than a silent empty loop.
  /**
   * 常量说明：rejects 用于处理 rejects 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 rejects 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 rejects(label, value)，并按返回类型处理结果。
   */
  const rejects = (label: string, value: unknown): void => {
    /**
     * 变量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let outcome: string
    /**
     * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      als.iterator(value)
      outcome = 'no TypeError'
    } catch (reason) {
      outcome = reason instanceof TypeError ? 'TypeError' : `no TypeError: ${String(reason)}`
    }
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    test(label, () => { expect(outcome).toBe('TypeError') })
  }
  rejects('a plain object is not iterable', {})
  rejects('a number is not iterable', 7)
  rejects('null is not iterable', null)
  rejects('undefined is not iterable', undefined)
}

// ---------------------------------------------------------------------------
// 5. close: teardown that cannot itself become the failure.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let closed = 0
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<IteratorResult<unknown>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const iterator = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => {
      closed += 1
      return Promise.resolve({ done: true, value: 'closed' })
    },
  }
  check('close forwards the iterator result', await als.close(iterator), { done: true, value: 'closed' })
  check('close calls return exactly once', closed, 1)
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // An iterator that throws while closing has nothing left to release, and the
  // loop is already leaving: swallowing keeps the original failure (or the
  // `break`) as the observable outcome instead of masking it with a teardown error.
  /**
   * 常量说明：throwing 用于处理 throwing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<IteratorResult<unknown>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const throwing = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => Promise.reject(new Error('teardown exploded')),
  }
  check('close swallows a failing return', await als.close(throwing), undefined)

  /**
   * 常量说明：synchronouslyThrowing 用于处理 synchronouslyThrowing 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<IteratorResult<unknown>>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const synchronouslyThrowing = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => { throw new Error('teardown exploded synchronously') },
  }
  check('close swallows a synchronously throwing return', await als.close(synchronouslyThrowing), undefined)
}

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  // No `return` at all: nothing to do, and no crash.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  check('close tolerates an iterator without return', await als.close({ next: () => Promise.resolve({ done: true, value: undefined }) }), undefined)
}

// ---------------------------------------------------------------------------
// 6. The inert runtime. Without a causality face, the rewrite still runs and
//    still hops a microtask, but no state moves. A comparison arm built on this
//    mode must be genuinely inert, or the comparison proves nothing.
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：inert 用于处理 inert 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inert = createAlsRuntime()

  check('inert snapshot is undefined', inert.snapshot(), undefined)

  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await inert.pause('value')
  check('inert pause still fulfills with the value', [token.ok, token.value], [true, 'value'])
  check('inert pause carries an undefined snapshot', token.snapshot, undefined)
  check('inert resume still returns the value', inert.resume(token), 'value')

  // Failure semantics must not change with the causality face withheld —
  // otherwise the control arm would differ in error handling as well as in
  // context propagation, and the comparison would prove nothing.
  /**
   * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const failure = new Error('inert boom')
  /**
   * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rejected = await inert.pause(Promise.reject(failure))
  check('inert pause reports rejection in the token', rejected.ok, false)
  /**
   * 变量说明：caught 用于处理 caught 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let caught: unknown
  /**
   * 变量说明：reason 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    inert.resume(rejected)
  } catch (reason) {
    caught = reason
  }
  check('inert resume still rethrows', caught, failure)

  check('inert afterYield is still transparent', inert.afterYield(undefined, 'sent'), 'sent')

  // The iterator and close verbs are pure plumbing and must work identically.
  /**
   * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const iterator = inert.iterator({ [Symbol.iterator]: () => ['x'][Symbol.iterator]() })
  check('inert iterator still adapts a sync source', await iterator.next(), { done: false, value: 'x' })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  check('inert close still resolves', await inert.close({ next: () => Promise.resolve({ done: true, value: undefined }) }), undefined)
}

{
  // The one thing the inert arm must NOT do: keep a store alive across a
  // suspension. This is the assertion that gives the control arm its meaning.
  /**
   * 常量说明：inert 用于处理 inert 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inert = createAlsRuntime()
  /**
   * 常量说明：token 用于处理 token 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const token = await inert.pause('v')
  /**
   * 常量说明：before 用于处理 before 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const before = inert.snapshot()
  inert.resume(token)
  check('inert resume moves no state', [before, inert.snapshot()], [undefined, undefined])
}

// ---------------------------------------------------------------------------
// 7. The two runtimes are independent instances (the loader builds one per
//    boot, and a stray shared closure would couple them).
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = recordingCausality()
  /**
   * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const second = recordingCausality()
  /**
   * 常量说明：alsA 用于处理 alsA 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const alsA = createAlsRuntime(first.causality)
  /**
   * 常量说明：alsB 用于处理 alsB 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const alsB = createAlsRuntime(second.causality)

  first.current = 'A'
  second.current = 'B'
  /**
   * 常量说明：tokenA 用于处理 tokenA 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tokenA = await alsA.pause(1)
  /**
   * 常量说明：tokenB 用于处理 tokenB 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const tokenB = await alsB.pause(2)
  check('each runtime captures through its own causality face', [tokenA.snapshot, tokenB.snapshot], ['A', 'B'])

  first.current = 'moved'
  alsA.resume(tokenA)
  check('restoring through one runtime does not touch the other', [first.current, second.current], ['A', 'B'])
}

// ---------------------------------------------------------------------------
// 8. The token shape the transform emits against, pinned as a type-level and
//    runtime contract (the emitted code reads `.ok`, `.value`, `.error`,
//    `.snapshot` directly).
// ---------------------------------------------------------------------------

{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = createAlsRuntime(recordingCausality().causality)
  /**
   * 常量说明：fulfilled 用于处理 fulfilled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fulfilled: AlsToken = await als.pause('v')
  check('a fulfilled token exposes ok/value/snapshot', Object.keys(fulfilled).sort(), ['ok', 'snapshot', 'value'])
  /**
   * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rejected: AlsToken = await als.pause(Promise.reject(new Error('e')))
  check('a rejected token exposes ok/error/snapshot', Object.keys(rejected).sort(), ['error', 'ok', 'snapshot'])
}
