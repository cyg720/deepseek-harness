/** Reconnecting lifecycle for one single-consumer Remote stream.
 * @remarks 文件说明：文件职责：实现 api/gateway 中 remote stream 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 api/gateway 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteStreamCarrierError } from './stream-client.ts'

/** One item annotated with the physical Remote-stream generation that delivered it. */
export interface RemoteStreamItem<Item> {
  /** Monotone physical generation number within this logical stream. */
  readonly generation: number
  /** Decoded item yielded by the generated Remote method. */
  readonly value: Item
  /** Cancellation lifetime of the generation that delivered this item. */
  readonly signal: AbortSignal
  /** Mark this generation's opening baseline or cursor as accepted.
   * @remarks 中文说明：功能说明：处理 accept 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 accept()，并按返回类型处理结果。 */
  accept(): void
}

/** Domain-owned operations used by {@link RemoteStream}. */
export interface RemoteStreamOptions<Item> {
  /** Diagnostic owner name used for cancellation failures. */
  readonly name: string
  /** Open one physical generation of the logical stream. */
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>
  /** Classify a normal generation end after or before its opening item was accepted. */
  readonly ended: (accepted: boolean) => Error
  /** Observe a retryable carrier loss before the supervisor waits or reopens. */
  readonly carrierFailed?: (error: RemoteStreamCarrierError) => void
}

/**
 * Reopens one logical Remote stream across carrier generations.
 *
 * The Gateway owns physical retry timing, cancellation, and replacement. The
 * domain consumer owns its opening item and every later item, and calls
 * {@link RemoteStreamItem.accept} only after validating the opening
 * baseline or cursor.
 * @remarks 中文说明：类说明：RemoteStream 用于集中封装 处理 RemoteStream 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/gateway
 * 在对应插件或业务生命周期内创建和调用。
 */
export class RemoteStream<Item> implements AsyncIterable<RemoteStreamItem<Item>> {
  /**
   * 常量说明：lifetime 用于处理 lifetime 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly lifetime = new AbortController()
  /**
   * 变量说明：generationAbort 用于处理 generationAbort 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private generationAbort: AbortController | undefined
  /**
   * 变量说明：iterator 用于处理 iterator 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private iterator: AsyncGenerator<RemoteStreamItem<Item>> | undefined
  /**
   * 变量说明：closing 用于处理 closing 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closing: Promise<void> | undefined
  /**
   * 变量说明：revision 用于处理 revision 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private revision = 0
  /**
   * 变量说明：taken 用于处理 taken 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private taken = false

  /**
   * @param connection - observable Host generation source used to pace retries.
   * @param options - domain stream opener, end classification, and diagnostics.
   * @remarks 中文说明：功能说明：处理 RemoteStream 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：connection（Pick<ConnectionHandle, 'generation'>）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数说明：options（RemoteStreamOptions<Item>）：提供本次操作使用的配置选项；
   * 必须满足声明的类型及调用时序要求。；返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * RemoteStream(connection, options) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly connection: Pick<ConnectionHandle, 'generation'>,
    private readonly options: RemoteStreamOptions<Item>,
  ) {}

  /** Cancellation lifetime shared by the stream and sibling page requests.
   * @remarks 中文说明：功能说明：处理 signal 相关流程；使用场景由所在模块及调用位置决定。；返回值：AbortSignal；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 signal()，并按返回类型处理结果。 */
  get signal(): AbortSignal {
    return this.lifetime.signal
  }

  /** Interrupt the current generation and immediately request a replacement.
   * @remarks 中文说明：功能说明：处理 restart 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 restart()，并按返回类型处理结果。 */
  restart(): void {
    if (this.lifetime.signal.aborted) return
    this.revision++
    this.generationAbort?.abort(new Error(`${this.options.name} generation restarted`))
  }

  /**
   * Permanently stop this stream and wait for its iterator to close.
   * @returns when the active generation and consumer iterator are quiescent.
   * @remarks 中文说明：功能说明：处理 dispose 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 dispose()，并按返回类型处理结果。
   */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    if (!this.lifetime.signal.aborted) {
      /**
       * 常量说明：reason 用于处理 reason 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const reason = new Error(`${this.options.name} disposed`)
      this.lifetime.abort(reason)
      this.generationAbort?.abort(reason)
    }
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = this.iterator
    if (iterator === undefined) return Promise.resolve()
    /**
     * 常量说明：closing 用于处理 closing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const closing = closeRemoteStreamIterator(iterator)
    this.closing = closing
    return closing
  }

  /** @inheritdoc
   * @remarks 中文说明：功能说明：处理 [Symbol.asyncIterator] 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：AsyncIterator<RemoteStreamItem<Item>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 [Symbol.asyncIterator]()，并按返回类型处理结果。 */
  [Symbol.asyncIterator](): AsyncIterator<RemoteStreamItem<Item>> {
    if (this.taken) throw new Error(`${this.options.name} already has a consumer`)
    this.taken = true
    /**
     * 常量说明：iterator 用于处理 iterator 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const iterator = this.read()
    this.iterator = iterator
    return iterator
  }

  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AsyncGenerator<RemoteStreamItem<Item>>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read()，并按返回类型处理结果。
   */
  private async * read(): AsyncGenerator<RemoteStreamItem<Item>> {
    /**
     * 变量说明：attempt 用于处理 attempt 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let attempt = 0
    /**
     * 变量说明：generation 用于处理 generation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let generation = 0
    /**
     * 变量说明：observedRevision 用于处理 observedRevision 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let observedRevision = this.revision
    try {
      while (!isAborted(this.lifetime.signal)) {
        if (observedRevision !== this.revision) {
          observedRevision = this.revision
          attempt = 0
        }
        /**
         * 常量说明：revision 用于处理 revision 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const revision = this.revision
        /**
         * 常量说明：generationAbort 用于处理 generationAbort 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const generationAbort = new AbortController()
        this.generationAbort = generationAbort
        /**
         * 常量说明：signal 用于处理 signal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const signal = AbortSignal.any([this.lifetime.signal, generationAbort.signal])
        /**
         * 常量说明：generationId 用于处理 generationId 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const generationId = ++generation
        /**
         * 变量说明：accepted 用于处理 accepted 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
         */
        let accepted = false
        try {
          for await (const /*
           * 变量说明：value 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
           */ value of this.options.open(signal)) {
            if (isAborted(this.lifetime.signal)) return
            if (revision !== this.revision) break
            yield {
              generation: generationId,
              value,
              signal,
              accept: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => {
                if (this.generationAbort !== generationAbort || revision !== this.revision) return
                accepted = true
                attempt = 0
              },
            }
          }
          if (isAborted(this.lifetime.signal)) return
          if (revision !== this.revision) continue
          throw this.options.ended(accepted)
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
          if (isAborted(this.lifetime.signal)) return
          if (revision !== this.revision) continue
          if (!(error instanceof RemoteStreamCarrierError)) throw error
          this.options.carrierFailed?.(error)
          if (revision !== this.revision) continue
          attempt++
          try {
            await waitForRemoteStreamRetry(this.connection, error, attempt, signal)
          } catch (/*
 * 变量说明：retryError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ retryError) {
            if (isAborted(this.lifetime.signal)) return
            if (revision !== this.revision) continue
            throw retryError
          }
        } finally {
          this.generationAbort = undefined
          if (!generationAbort.signal.aborted) {
            generationAbort.abort(new Error(`${this.options.name} generation ended`))
          }
        }
      }
    } finally {
      if (!this.lifetime.signal.aborted) {
        this.lifetime.abort(new Error(`${this.options.name} consumer closed`))
      }
      this.generationAbort?.abort(this.lifetime.signal.reason)
      this.generationAbort = undefined
    }
  }
}

/**
 * 功能说明：处理 waitForRemoteStreamRetry 相关流程；使用场景由所在模块及调用位置决定。
 * @param connection （Pick<ConnectionHandle, 'generation'>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @param error （RemoteStreamCarrierError）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param attempt （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 waitForRemoteStreamRetry(connection, error, attempt,
 * signal)，并按返回类型处理结果。
 */
async function waitForRemoteStreamRetry(
  connection: Pick<ConnectionHandle, 'generation'>,
  error: RemoteStreamCarrierError,
  attempt: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (connection.generation.getSnapshot() !== undefined) {
    if (attempt === 1) return
    throw error
  }
  await new Promise<void>(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
 * 并按返回类型处理结果。
 */ (resolve, reject) => {
    /**
     * 常量说明：subscription 用于处理 subscription 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
      const subscription: {
        dispose?: () => void
        finished: boolean
      } = { finished: false }
      /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。
     * @param failure （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 finish(failure)，并按返回类型处理结果。
     */
      const finish = (failure?: Error): void => {
        if (subscription.finished) return
        subscription.finished = true
        subscription.dispose?.()
        signal.removeEventListener('abort', aborted)
        if (failure === undefined) resolve()
        else reject(failure)
      }
      /**
     * 常量说明：inspect 用于处理 inspect 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 inspect 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 inspect()，并按返回类型处理结果。
     */
      const inspect = (): void => {
        if (connection.generation.getSnapshot() !== undefined) finish()
      }
      /**
     * 常量说明：aborted 用于处理 aborted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 aborted 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 aborted()，并按返回类型处理结果。
     */
      const aborted = (): void => {
        finish(new Error('Remote stream retry aborted', { cause: signal.reason }))
      }
      /**
     * 常量说明：dispose 用于处理 dispose 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
      const dispose = connection.generation.subscribe(inspect)
      subscription.dispose = dispose
      if (subscription.finished) dispose()
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
      else inspect()
    })
}

/**
 * 功能说明：判断是否为 Aborted 相关流程；使用场景由所在模块及调用位置决定。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isAborted(signal)，并按返回类型处理结果。
 */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * 功能说明：关闭 Remote Stream Iterator 相关流程；使用场景由所在模块及调用位置决定。
 * @param iterator （AsyncIterator<RemoteStreamItem<Item>>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeRemoteStreamIterator(iterator)，并按返回类型处理结果。
 */
async function closeRemoteStreamIterator<Item>(
  iterator: AsyncIterator<RemoteStreamItem<Item>>,
): Promise<void> {
  try {
    await iterator.return?.()
  } catch {
    // The disposed logical stream has no remaining consumer for cancellation failures.
  }
}
