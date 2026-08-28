/**
 * 文件职责：验证 api/gateway 中 control retry client spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import {
  RemoteStreamCarrierError,
  RemoteStream,
} from '../src/client/index.ts'

/**
 * 常量说明：GENERATION 用于处理 GENERATION 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const GENERATION = { id: 1, host: { home: '/home/fixture' } }

/**
 * 功能说明：处理 hostSource 相关流程；使用场景由所在模块及调用位置决定。
 * @param initiallyAvailable （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { connection: Pick<ConnectionHandle, 'generation'>
 * publish(available:…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 hostSource(initiallyAvailable)，并按返回类型处理结果。
 */
function hostSource(initiallyAvailable: boolean): {
  connection: Pick<ConnectionHandle, 'generation'>
  /**
   * 功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。
   * @param available （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 publish(available)，并按返回类型处理结果。
   */
  publish(available: boolean): void
} {
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = initiallyAvailable ? GENERATION : undefined
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const listeners = new Set<() => void>()
  return {
    connection: {
      generation: {
        getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => current,
        subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（由 TypeScript
 * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，
 * 并按返回类型处理结果。
 */ (listener) => {
          listeners.add(listener)
          /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
          return () => { listeners.delete(listener) }
        },
      },
    },
    publish: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：available（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(available)，并按返回类型处理结果。
 */ (available) => {
      current = available ? GENERATION : undefined
      for (const /*
       * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ listener of listeners) listener()
    },
  }
}

interface Generation<Item> {
  readonly values?: readonly (Item | Promise<Item>)[]
  readonly terminal?: Error
  readonly hold?: boolean
  readonly afterAbortError?: Error
  readonly close?: () => Promise<void>
}

/**
 * 功能说明：处理 scripted 相关流程；使用场景由所在模块及调用位置决定。
 * @param generations （Generation<Item>[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param opened （() => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 scripted(generations, opened)，并按返回类型处理结果。
 */
function scripted<Item>(generations: Generation<Item>[], opened?: () => void) {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：signal（AbortSignal）：传递取消或终止信号；
   * 必须满足声明的类型及调用时序要求。；返回值：AsyncIterable<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(signal)，并按返回类型处理结果。
   */
  return (signal: AbortSignal): AsyncIterable<Item> => ({
    /**
     * 功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。
     * @returns AsyncIterator<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。
     */
    async * [Symbol.asyncIterator](): AsyncIterator<Item> {
      /**
       * 常量说明：generation 用于处理 generation 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const generation = generations.shift()
      if (generation === undefined) throw new Error('fixture has no stream generation')
      opened?.()
      try {
        for (const /*
         * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */ value of generation.values ?? []) yield await value
        if (generation.terminal !== undefined) throw generation.terminal
        if (generation.hold === true && !signal.aborted) {
          await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
 */ (resolve) => {
              signal.addEventListener('abort', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { resolve() }, { once: true })
            })
        }
        if (generation.afterAbortError !== undefined) throw generation.afterAbortError
      } finally {
        await generation.close?.()
      }
    },
  })
}

/**
 * 功能说明：处理 supervisor 相关流程；使用场景由所在模块及调用位置决定。
 * @param connection （Pick<ConnectionHandle, 'generation'>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param generations （Generation<Item>[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param carrierFailed （(error: RemoteStreamCarrierError) =>
 * void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns RemoteStream<Item>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 supervisor(connection, generations, carrierFailed)，
 * 并按返回类型处理结果。
 */
function supervisor<Item>(
  connection: Pick<ConnectionHandle, 'generation'>,
  generations: Generation<Item>[],
  carrierFailed?: (error: RemoteStreamCarrierError) => void,
): RemoteStream<Item> {
  return new RemoteStream(connection, {
    name: 'fixture stream',
    open: scripted(generations),
    ended: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：accepted（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(accepted)，并按返回类型处理结果。
 */ accepted => accepted
      ? new RemoteStreamCarrierError('accepted generation ended')
      : new Error('generation ended before acceptance'),
    ...(carrierFailed === undefined ? {} : { carrierFailed }),
  })
}

describe('RemoteStream', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
    it('annotates replacement generations and resets retry state after acceptance', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [
          { values: ['first'], terminal: new RemoteStreamCarrierError('first lost') },
          { values: ['second'], hold: true },
        ])
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()

        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await iterator.next()
        expect(first).toMatchObject({ done: false, value: { generation: 1, value: 'first' } })
        if (first.done) throw new Error('fixture generation ended early')
        first.value.accept()
        /**
     * 常量说明：second 用于处理 second 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const second = await iterator.next()
        expect(second).toMatchObject({ done: false, value: { generation: 2, value: 'second' } })
        if (second.done) throw new Error('fixture replacement ended early')
        second.value.accept()

        await stream.dispose()
      })

    it('permits one isolated retry while the Host remains available', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = new RemoteStreamCarrierError('first carrier failure')
        /**
     * 常量说明：repeated 用于处理 repeated 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const repeated = new RemoteStreamCarrierError('isolated retry failed')
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn<(error: RemoteStreamCarrierError) => void>()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [
          { terminal: first },
          { terminal: repeated },
        ], carrierFailed)

        await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(repeated)
        expect(carrierFailed).toHaveBeenNthCalledWith(1, first)
        expect(carrierFailed).toHaveBeenNthCalledWith(2, repeated)
      })

    it('waits for a replacement Host generation after observing unavailability', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：available 用于处理 available 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
        let available = false
        /**
     * 变量说明：listener 用于处理 listener 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let listener: (() => void) | undefined
        /**
     * 常量说明：subscribed 用于处理 subscribed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const subscribed = Promise.withResolvers<undefined>()
        /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const connection = {
          generation: {
            getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => available ? GENERATION : undefined,
            subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（() => void）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
 */ (value: () => void) => {
              listener = value
              subscribed.resolve(undefined)
              /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
              return () => { listener = undefined }
            },
          },
        }
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened = 0
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new RemoteStream(connection, {
          name: 'fixture stream',
          open: scripted([
            { terminal: new RemoteStreamCarrierError('offline') },
            { values: ['ready'], hold: true },
          ], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { opened++ }),
          ended: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => new Error('ended'),
        })
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = stream[Symbol.asyncIterator]().next()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(opened).toBe(1) })
        await subscribed.promise

        listener?.()
        expect(opened).toBe(1)
        available = true
        listener?.()
        await expect(pending).resolves.toMatchObject({
          done: false,
          value: { generation: 2, value: 'ready' },
        })
        await stream.dispose()
      })

    it('stops a pending retry when the logical stream is disposed', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(false)
        /**
     * 变量说明：opened 用于处理 opened 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let opened = 0
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = new RemoteStream(source.connection, {
          name: 'fixture stream',
          open: scripted([
            { terminal: new RemoteStreamCarrierError('offline') },
          ], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { opened++ }),
          ended: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => new Error('ended'),
        })
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = stream[Symbol.asyncIterator]().next()
        await vi.waitFor(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { expect(opened).toBe(1) })
        source.publish(false)

        await stream.dispose()
        await expect(pending).resolves.toEqual({ done: true, value: undefined })
      })

    it('contains a Host publication during subscription setup', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 变量说明：reads 用于处理 reads 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let reads = 0
        /**
     * 变量说明：disposed 用于处理 disposed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let disposed = 0
        /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const connection = {
          generation: {
            getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => reads++ === 0 ? undefined : GENERATION,
            subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：listener（() =>
 * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(listener)，并按返回类型处理结果。
 */ (listener: () => void) => {
              listener()
              /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
              return () => { disposed++ }
            },
          },
        }
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(connection, [
          { terminal: new RemoteStreamCarrierError('offline') },
          { values: ['ready'], hold: true },
        ])

        await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
          value: { generation: 2, value: 'ready' },
        })
        expect(disposed).toBe(1)
        await stream.dispose()
      })

    it('restarts with a fresh physical generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [
          { values: ['first'], hold: true },
          { values: ['second'], hold: true },
        ])
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()
        await expect(iterator.next()).resolves.toMatchObject({ value: { generation: 1, value: 'first' } })

        stream.restart()

        await expect(iterator.next()).resolves.toMatchObject({ value: { generation: 2, value: 'second' } })
        await stream.dispose()
      })

    it('drops values and cancellation failures from a replaced generation', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [
          { values: ['first', 'stale'] },
          {
            values: ['second'],
            hold: true,
            afterAbortError: new Error('replaced generation cancelled'),
          },
          { values: ['third'], hold: true },
        ])
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()
        /**
     * 常量说明：first 用于处理 first 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const first = await iterator.next()
        if (first.done) throw new Error('fixture generation ended early')

        stream.restart()
        first.value.accept()
        await expect(iterator.next()).resolves.toMatchObject({
          value: { generation: 2, value: 'second' },
        })

        stream.restart()
        await expect(iterator.next()).resolves.toMatchObject({
          value: { generation: 3, value: 'third' },
        })
        await stream.dispose()
      })

    it('honors replacement requested by carrier diagnostics', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：holder 用于处理 holder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const holder: { stream?: RemoteStream<string> } = {}
        /**
     * 常量说明：carrierFailed 用于处理 carrierFailed 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const carrierFailed = vi.fn(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { holder.stream?.restart() })
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [
          { terminal: new RemoteStreamCarrierError('replace this generation') },
          { values: ['ready'], hold: true },
        ], carrierFailed)
        holder.stream = stream

        await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
          value: { generation: 2, value: 'ready' },
        })
        expect(carrierFailed).toHaveBeenCalledOnce()
        await stream.dispose()
      })

    it('contains replacement during Host-readiness subscription setup', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：holder 用于处理 holder 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const holder: { stream?: RemoteStream<string> } = {}
        /**
     * 变量说明：subscriptions 用于处理 subscriptions 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
        let subscriptions = 0
        /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
        const connection = {
          generation: {
            getSnapshot: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined,
            subscribe: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
              subscriptions++
              holder.stream?.restart()
              /**
           * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
           * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
           */
              return () => {}
            },
          },
        }
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(connection, [
          { terminal: new RemoteStreamCarrierError('offline') },
          { values: ['ready'], hold: true },
        ])
        holder.stream = stream

        await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
          value: { generation: 2, value: 'ready' },
        })
        expect(subscriptions).toBe(1)
        await stream.dispose()
      })

    it('waits for generation cleanup during disposal', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：release 用于处理 release 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const release = Promise.withResolvers<undefined>()
        /**
     * 变量说明：closed 用于处理 closed 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
        let closed = false
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [{
          values: ['ready'],
          hold: true,
          close: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
            await release.promise
            closed = true
          },
        }])
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()
        await iterator.next()
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = iterator.next()

        /**
     * 常量说明：disposing 用于处理 disposing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const disposing = stream.dispose()
        expect(stream.dispose()).toBe(disposing)
        await Promise.resolve()
        expect(closed).toBe(false)
        release.resolve(undefined)

        await expect(disposing).resolves.toBeUndefined()
        await expect(pending).resolves.toEqual({ done: true, value: undefined })
        expect(closed).toBe(true)
      })

    it('uses the domain normal-end classification and permits one consumer', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor<string>(source.connection, [{}])
        /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const iterator = stream[Symbol.asyncIterator]()

        expect(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => stream[Symbol.asyncIterator]()).toThrow('already has a consumer')
        await expect(iterator.next()).rejects.toThrow('generation ended before acceptance')
        await stream.dispose()
      })

    it('can be disposed before consumption and ignores later restart', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor<string>(source.connection, [])

        await stream.dispose()
        expect(stream.signal.aborted).toBe(true)
        stream.restart()
        await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({
          done: true,
          value: undefined,
        })
      })

    it('drops a value that arrives after disposal begins', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const source = hostSource(true)
        /**
     * 常量说明：late 用于处理 late 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const late = Promise.withResolvers<string>()
        /**
     * 常量说明：stream 用于处理 stream 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const stream = supervisor(source.connection, [{ values: [late.promise] }])
        /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const pending = stream[Symbol.asyncIterator]().next()
        /**
     * 常量说明：disposing 用于处理 disposing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
        const disposing = stream.dispose()
        late.resolve('late')

        await expect(pending).resolves.toEqual({ done: true, value: undefined })
        await disposing
      })
  })
