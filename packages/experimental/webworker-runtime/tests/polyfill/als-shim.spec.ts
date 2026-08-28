/**
 * Behavioural check of the folding AsyncLocalStorage shim: the two shapes the
 * agent service actually uses (nested instances; a boundary whose operation
 * returns a promise), the hook layer that carries a registration context into a
 * callback, and the explicit-switch slots the module transform's `await`
 * rewriting drives.
 *
 * Layering, because three mechanisms answer `getStore()` and the cases below
 * pick them apart deliberately:
 *  1. the **folding stack** — `run()` boundaries, unwound by identity;
 *  2. the **hook layer** — patched `then`/timers, so a callback reads the store
 *     from where it was REGISTERED rather than where it runs;
 *  3. the **explicit switch** — `__snapshotAll`/`__restoreAll` and the
 *     `alsCausality` face, which the transformed modules reach at every
 *     suspension point. This is the layer that survives true interleaving, and
 *     case 17 is the one that shows the folding stack alone cannot.
 *
 * Scope boundary: this file owns the shim (the state). `als-runtime.spec.ts`
 * owns the protocol that moves snapshots around, with the causality face stubbed.
 *
 * Every import goes through the **package name**, not a relative path: a check
 * that reaches built `lib/` while the shim resolves by package name to `src/`
 * gets two module instances and a shim mounted in the wrong world (the failure
 * mode asserted in `../node/fs.spec.ts`). One resolution path per module.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 als shim spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { expect, test } from 'vitest'
import {
  AsyncLocalStorage, __restoreAll, __snapshotAll, alsCausality, runAtAsyncContextRoot,
} from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/builtin_modules/implemented/async_hooks.ts'
import { installAsyncContextHooks } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/polyfill/async-context/async-context-hooks.ts'
import { installTimerGlobals } from '@deepseek-ai/dsh-experimental-webworker-runtime/src/node/globals/timers.ts'

// Same order the worker entry uses: patch the platform, then wrap the timers over
// the patched platform. The folding cases below must hold with both in place.
installAsyncContextHooks()
installTimerGlobals()

// Both sides are serialized at call time, not inside the case: several blocks
// below reuse a mutable array as the observed value, so a captured reference
// would read a later block's state by the time the case executes.
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
 * 常量说明：delay 用于处理 delay 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 delay 相关流程；使用场景由所在模块及调用位置决定。
 * @param ms （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 delay(ms)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */
const delay = (ms = 0): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

// 0. The migration's own precondition: the hook layer really is installed over
//    this module instance. If the check and the shim ever resolve to two
//    instances again, the patched `then` below belongs to the other copy and
//    every hook-layer case would silently test an unpatched platform.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 变量说明：seen 用于处理 seen 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let seen: string | undefined = 'unset'
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
  */
  als.run('installed', () => { void Promise.resolve().then(() => { seen = als.getStore() }) })
  await delay()
  check('hook layer is installed over this module instance', seen, 'installed')
}

// 1. Synchronous operation: visible inside, gone after.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const seen = als.run('sync', () => als.getStore())
  check('sync body sees store', seen, 'sync')
  check('sync boundary closes', als.getStore(), undefined)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  check('sync return value preserved', als.run('x', () => 42), 42)
}

// 2. The reason for the upgrade: the store survives awaits inside the operation.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observed: (string | undefined)[] = []
  /**
   * 常量说明：operation 用于处理 operation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 operation 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 operation()，并按返回类型处理结果。
   */
  const operation = async (): Promise<void> => {
    observed.push(als.getStore())
    await delay()
    observed.push(als.getStore())
    await delay(5)
    observed.push(als.getStore())
  }
  /**
   * 常量说明：running 用于处理 running 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const running = als.run('agent-1', operation)
  observed.push(als.getStore())
  await running
  await delay()
  check('store visible across awaits', observed, ['agent-1', 'agent-1', 'agent-1', 'agent-1'])
  check('boundary closes after settle', als.getStore(), undefined)
}

// 3. Rejection still closes the boundary, and the caller still sees the rejection.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：failing 用于处理 failing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const failing = als.run('doomed', async () => {
    await delay()
    throw new Error('operation failed')
  })
  /**
   * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  const message = await failing.then(() => 'resolved', (error: unknown) => (error as Error).message)
  check('rejection propagates', message, 'operation failed')
  await delay()
  check('boundary closes after rejection', als.getStore(), undefined)
}

// 4. A synchronous throw closes the boundary too.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  try {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    als.run('thrower', () => { throw new Error('sync failure') })
  } catch { /* expected */ }
  check('boundary closes after sync throw', als.getStore(), undefined)
}

// 5. Nested boundaries on ONE instance unwind by identity, innermost first.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observed: (string | undefined)[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await als.run('outer', async () => {
    observed.push(als.getStore())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await als.run('inner', async () => {
      await delay()
      observed.push(als.getStore())
    })
    await delay()
    observed.push(als.getStore())
  })
  await delay()
  check('nested unwind', observed, ['outer', 'inner', 'outer'])
  check('nested boundaries all closed', als.getStore(), undefined)
}

// 6. The agent service's real shape: two instances, the outer run returning the
//    inner run's promise (agent/src/index.ts:649).
{
  /**
   * 常量说明：runs 用于处理 runs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const runs = new AsyncLocalStorage<{ id: number }>()
  /**
   * 常量说明：initiators 用于处理 initiators 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const initiators = new AsyncLocalStorage<string>()
  /**
   * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observed: unknown[] = []
  /**
   * 常量说明：operation 用于处理 operation 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 operation 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 operation()，并按返回类型处理结果。
   */
  const operation = async (): Promise<void> => {
    await delay()
    // What requireInitiator() does, several awaits below the boundary.
    observed.push([initiators.getStore(), runs.getStore()?.id])
  }
  /**
   * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parent = runs.getStore()
  check('parent chain empty at first boundary', parent, undefined)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await runs.run({ id: 1 }, () => initiators.run('agent-1', operation))
  await delay()
  check('both instances answered inside', observed, [['agent-1', 1]])
  check('runs closed', runs.getStore(), undefined)
  check('initiators closed', initiators.getStore(), undefined)
}

// 7. exit()/withoutInitiator hides the inherited store and restores it.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：observed 用于处理 observed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const observed: (string | undefined)[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  await als.run('agent-1', async () => {
    observed.push(als.getStore())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await als.exit(async () => {
      await delay()
      observed.push(als.getStore())
    })
    observed.push(als.getStore())
  })
  await delay()
  check('exit hides then restores', observed, ['agent-1', undefined, 'agent-1'])
}

// 8. Interleaved boundaries: attribution follows the newest entry (the documented
//    single-concurrency limit) but nothing throws and the stack fully unwinds.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 body 相关流程；使用场景由所在模块及调用位置决定。
   * @param _label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param ms （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 body(_label, ms)，并按返回类型处理结果。
   */
  const body = async (_label: string, ms: number): Promise<void> => {
    await delay(ms)
    seen.push(als.getStore())
  }
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const first = als.run('A', () => body('A', 20))
  /**
   * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const second = als.run('B', () => body('B', 5))
  await Promise.all([first, second])
  await delay()
  check('interleaved reads never crash', seen.length, 2)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  check('interleaved reads resolve to an open boundary', seen.every(entry => entry === 'A' || entry === 'B'), true)
  check('stack unwinds after interleaving', als.getStore(), undefined)
}

// 9. disable() drops everything, as teardown expects.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const pending = als.run('leaked', async () => { await delay(50) })
  als.disable()
  check('disable clears the stack', als.getStore(), undefined)
  await pending
}

// 10. HOOK LAYER: a `.then` callback reads the store from where it was REGISTERED,
//     even though the registering boundary is long closed by the time it runs.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 变量说明：seen 用于处理 seen 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let seen: string | undefined = 'unset'
  /**
   * 常量说明：promise 用于处理 promise 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  const promise = new Promise<void>((resolve) => { setTimeout(resolve, 10) })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
  */
  als.run('registrar', () => { void promise.then(() => { seen = als.getStore() }) })
  check('boundary closed before the callback runs', als.getStore(), undefined)
  await delay(30)
  check('then callback reads the registration store', seen, 'registrar')
}

// 11. HOOK LAYER under interleaving: each callback reads ITS OWN registration
//     store, which the folding stack alone could not distinguish.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 常量说明：register 用于注册 register 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param ms （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 register(label, ms)，并按返回类型处理结果。
   */
  const register = (label: string, ms: number): void => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    als.run(label, () => {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      setTimeout(() => { seen.push(`${label}:${String(als.getStore())}`) }, ms)
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      void Promise.resolve().then(() => { seen.push(`${label}-then:${String(als.getStore())}`) })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      queueMicrotask(() => { seen.push(`${label}-micro:${String(als.getStore())}`) })
    })
  }
  register('A', 20)
  register('B', 5)
  await delay(40)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：entry is string；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  check('interleaved timers read their own store', seen.filter((entry): entry is string => entry !== undefined && entry.includes(':')).sort(), [
    'A-micro:A', 'A-then:A', 'A:A', 'B-micro:B', 'B-then:B', 'B:B',
  ])
}

// 12. `catch`/`finally` inherit the patched `then` (they invoke it on the receiver).
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 常量说明：rejected 用于处理 rejected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rejected = Promise.reject(new Error('boom'))
  /**
   * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
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
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const settled = als.run('handler', () => rejected
    .catch(() => { seen.push(als.getStore()) })
    .finally(() => { seen.push(als.getStore()) }))
  await settled
  await delay()
  check('catch and finally carry the registration store', seen, ['handler', 'handler'])
}

// 13. An empty handler slot stays empty: a rejection must not be swallowed by a
//     wrapper standing in for an absent fulfilled handler.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：outcome 用于处理 outcome 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  const outcome = await als.run('slots', () => Promise
    .reject(new Error('preserved'))
    .then(undefined, (error: unknown) => `caught:${(error as Error).message}`))
  check('empty fulfilled slot preserved', outcome, 'caught:preserved')
  /**
   * 常量说明：passthrough 用于处理 passthrough 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const passthrough = await als.run('slots', () => Promise.resolve('value').then(undefined, () => 'wrong'))
  check('value passes an empty fulfilled slot', passthrough, 'value')
}

// 14. A boundary opened inside a restored callback owns its reads, and the overlay
//     comes back afterwards.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('outer', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    queueMicrotask(() => {
      seen.push(als.getStore())
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
       */
      als.run('inner', () => { seen.push(als.getStore()) })
      seen.push(als.getStore())
    })
  })
  await delay(10)
  check('nested run inside a restored callback', seen, ['outer', 'inner', 'outer'])
}

// 15. The tunnel entry's root context masks whatever was open before it.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 变量说明：seen 用于处理 seen 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let seen: string | undefined = 'unset'
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('stale', () => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    runAtAsyncContextRoot(() => { seen = als.getStore() })
  })
  check('root context masks an open boundary', seen, undefined)
  check('root context restores afterwards', als.getStore(), undefined)
}

// 16. Promises stay native: the patch wraps handlers, not the chain.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：chained 用于处理 chained 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
   */
  const chained = als.run('native', () => Promise.resolve(1).then(value => value + 1))
  check('then returns a native promise', chained instanceof Promise, true)
  check('chained value', await chained, 2)
}

// 17. EXPLICIT SWITCH: a resumed frame reads what its pause point read, even
//     while another boundary is open — this is what the loader's await rewriting
//     buys over the folding stack.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  // Frame A pauses inside its boundary…
  /**
   * 变量说明：paused 用于处理 paused 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let paused: ReturnType<typeof __snapshotAll> | undefined
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('A', () => { paused = __snapshotAll() })
  // …an unrelated boundary opens and stays open…
  /**
   * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const other = als.run('B', async () => { await delay(20) })
  seen.push(als.getStore())
  // …and frame A resumes: the ambient slot answers A, not the open B.
  /**
   * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const release = __restoreAll(paused!)
  seen.push(als.getStore())
  release()
  seen.push(als.getStore())
  await other
  await delay()
  check('resume answers the paused context', seen, ['B', 'A', 'B'])
  check('all slots empty afterwards', als.getStore(), undefined)
}

// 18. Two frames pausing and resuming alternately keep their own contexts. A
//     disposer only ever undoes ITS OWN publish: released while shadowed it is a
//     no-op (never clobbers the newer frame), and released on top it restores the
//     context it shadowed — the frame that owned that context re-publishes at its
//     next await anyway, and any new boundary shadows it.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: string[] = []
  /**
   * 常量说明：pauseIn 用于处理 pauseIn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 pauseIn 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<typeof __snapshotAll>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pauseIn(label)，并按返回类型处理结果。
   */
  const pauseIn = (label: string): ReturnType<typeof __snapshotAll> => {
    /**
     * 变量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let snapshot: ReturnType<typeof __snapshotAll> | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    als.run(label, () => { snapshot = __snapshotAll() })
    return snapshot!
  }
  /**
   * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const first = pauseIn('one')
  /**
   * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const second = pauseIn('two')
  /**
   * 常量说明：releaseFirst 用于处理 releaseFirst 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const releaseFirst = __restoreAll(first)
  seen.push(`first:${String(als.getStore())}`)
  /**
   * 常量说明：releaseSecond 用于处理 releaseSecond 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const releaseSecond = __restoreAll(second)
  seen.push(`second:${String(als.getStore())}`)
  releaseFirst()   // out of order on purpose
  seen.push(`afterFirstRelease:${String(als.getStore())}`)
  releaseSecond()
  seen.push(`afterSecondRelease:${String(als.getStore())}`)
  check('interleaved resumes keep their own context', seen, [
    'first:one', 'second:two', 'afterFirstRelease:two', 'afterSecondRelease:one',
  ])
}

// 19. The ambient slot outranks the folding stack but not a hook overlay: the
//     documented slot order.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 变量说明：paused 用于处理 paused 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let paused: ReturnType<typeof __snapshotAll> | undefined
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('ambient', () => { paused = __snapshotAll() })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('stack', () => {
    /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const release = __restoreAll(paused!)
    seen.push(als.getStore())
    release()
    seen.push(als.getStore())
  })
  check('ambient outranks the stack, stack returns after release', seen, ['ambient', 'stack'])
}

// 20. The rewriter's face (`AlsCausality`: snapshot + void restore) replaces the
//     resumed slot instead of stacking, so repeated resumes cannot leak context.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：pauseIn 用于处理 pauseIn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 pauseIn 相关流程；使用场景由所在模块及调用位置决定。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ReturnType<typeof alsCausality.snapshot>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 pauseIn(label)，并按返回类型处理结果。
   */
  const pauseIn = (label: string): ReturnType<typeof alsCausality.snapshot> => {
    /**
     * 变量说明：snapshot 用于处理 snapshot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let snapshot: ReturnType<typeof alsCausality.snapshot> | undefined
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    als.run(label, () => { snapshot = alsCausality.snapshot() })
    return snapshot!
  }
  /**
   * 常量说明：one 用于处理 one 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const one = pauseIn('one')
  /**
   * 常量说明：two 用于处理 two 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const two = pauseIn('two')
  alsCausality.restore(one)
  check('void restore publishes the paused context', als.getStore(), 'one')
  alsCausality.restore(two)
  check('a later resume replaces it', als.getStore(), 'two')
  alsCausality.restore(one)
  check('resuming the first frame again republishes its own', als.getStore(), 'one')
  // A new boundary shadows the resumed slot, and the slot comes back after it.
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  als.run('boundary', () => { check('boundary shadows the resumed slot', als.getStore(), 'boundary') })
  check('resumed slot returns after the boundary', als.getStore(), 'one')
  als.disable()
  check('disable clears the resumed slot', als.getStore(), undefined)
}

// 21. A rewritten frame's await round trip (pause → other work interleaves → resume)
//     is exactly what `AlsRuntime.pause/resume` does with this face.
{
  /**
   * 常量说明：als 用于处理 als 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const als = new AsyncLocalStorage<string>()
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: (string | undefined)[] = []
  /**
   * 常量说明：paused 用于处理 paused 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const paused = await als.run('frame', async () => {
    /**
     * 常量说明：captured 用于处理 captured 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const captured = alsCausality.snapshot()
    await delay(10)
    return captured
  })
  /**
   * 常量说明：other 用于处理 other 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const other = als.run('interleaved', async () => { await delay(30) })
  seen.push(als.getStore())
  alsCausality.restore(paused)
  seen.push(als.getStore())
  await other
  await delay()
  check('resume wins over an interleaved boundary', seen, ['interleaved', 'frame'])
}
