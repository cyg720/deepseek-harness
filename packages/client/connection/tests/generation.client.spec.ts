/**
 * 文件职责：验证 client/connection 中 generation client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  type ConnectionGenerationSource,
  type ConnectionHandle,
} from '../src/client/index.ts'

type BrowserGlobal = {
  location?: { hostname: string; search: string }
}

/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts = new Set<Context>()

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  vi.restoreAllMocks()
  delete (globalThis as BrowserGlobal).location
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.all([...contexts].map(async ctx => ctx.fiber.dispose()))
  contexts.clear()
})

/**
 * 功能说明：处理 mount 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Promise<ConnectionHandle>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 mount()，并按返回类型处理结果。
 */
async function mount(): Promise<ConnectionHandle> {
  ;(globalThis as BrowserGlobal).location = { hostname: 'localhost', search: '?fixture' }
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin({ apply, inject: [] })
  /**
   * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('fixture did not provide Connection')
  return connection
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('Connection generation facts', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('publishes ready-frame Host facts and retracts them when the loop stops', async () => {
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const connection = await mount()
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 source 相关流程；使用场景由所在模块及调用位置决定。
     * @param signal （由 TypeScript 根据调用位置推断的类型）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
     * @param ready （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 source(signal, ready)，并按返回类型处理结果。
     */
    const source: ConnectionGenerationSource = (signal, ready) => {
      ready({ home: '/home/from-ready' })
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
       */
      return new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
          signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }
    connection.registerGenerationSource(source)
    /**
     * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const seen: Array<string | undefined> = []
    /**
     * 常量说明：stopListening 用于停止 Listening 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const stopListening = connection.generation.subscribe(() => {
      seen.push(connection.generation.getSnapshot()?.host.home)
    })
    /**
     * 常量说明：loop 用于处理 loop 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const loop = connection.start({}, {
      backoffBaseMs: 1,
      backoffFactor: 1,
      backoffMaxMs: 1,
      generationReadyTimeoutMs: 100,
    })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    await vi.waitFor(() => {
      expect(connection.generation.getSnapshot()).toEqual({
        id: 1,
        host: { home: '/home/from-ready' },
      })
    })
    loop.stop()
    expect(connection.generation.getSnapshot()).toBeUndefined()
    expect(seen).toEqual(['/home/from-ready', undefined])
    stopListening()
  })
})
