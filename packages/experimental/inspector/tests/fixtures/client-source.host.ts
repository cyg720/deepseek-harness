/** Host-side controller for the isolated Client test fixture.
 * @remarks 文件说明：文件职责：验证 experimental/inspector 中 client source host
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { Worker } from 'node:worker_threads'
import type { InspectorClientBootstrap } from '../../src/shared/bridge/messages/control.ts'
import type { CordisRuntimeTree } from '../../src/shared/cordis/model.ts'
import type { InspectorJsonValue } from '../../src/shared/json.ts'

/** Optional source artifact exposed by the Client fixture. */
interface ClientFixtureSourceCatalog {
  readonly sourceText: string
  readonly sourceMap: string
  readonly sourceUrl: string
  readonly sourceMapUrl: string
}

/** Options for one isolated Client fixture. */
export interface ClientFixtureOptions {
  readonly label?: string
  readonly sourceCatalog?: ClientFixtureSourceCatalog
}

interface FixtureResponse {
  readonly type: 'response'
  readonly id: number
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: string
}

/** A Client producer running outside the Host test realm.
 * @remarks 中文说明：类说明：InspectorClientFixture 用于集中封装 处理
 * InspectorClientFixture 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class InspectorClientFixture {
  /**
   * 常量说明：worker 用于处理 worker 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly worker: Worker
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly pending = new Map<number, PromiseWithResolvers<unknown>>()
  /**
   * 变量说明：nextId 用于处理 nextId 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private nextId = 0
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false
  /**
   * 常量说明：fiberUid 用于处理 fiberUid 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  readonly fiberUid: number

  /**
   * 功能说明：处理 InspectorClientFixture 相关流程；使用场景由所在模块及调用位置决定。
   * @param worker （Worker）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param fiberUid （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorClientFixture(worker, fiberUid) 创建实例，
   * 并在所属生命周期内使用。
   */
  private constructor(worker: Worker, fiberUid: number) {
    this.worker = worker
    this.fiberUid = fiberUid
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（unknown）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
     * 典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    worker.on('message', (message: unknown) => { this.receive(message) })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    worker.on('error', (error) => { this.fail(error) })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
     */
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) this.fail(new Error(`Inspector Client fixture exited with code ${String(code)}`))
    })
  }

  /** Start one Client fixture and wait for its Cordis tree to be published.
   * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：bootstrap（InspectorClientBootstrap）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（ClientFixtureOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<InspectorClientFixture>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 start(bootstrap, options)，并按返回类型处理结果。 */
  static async start(
    bootstrap: InspectorClientBootstrap,
    options: ClientFixtureOptions = {},
  ): Promise<InspectorClientFixture> {
    /**
     * 常量说明：ready 用于处理 ready 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ready = Promise.withResolvers<number>()
    /**
     * 常量说明：entry 用于处理 entry 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entry = new URL('./client-source.client.ts', import.meta.url)
    /**
     * 常量说明：tsxApi 用于处理 tsxApi 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tsxApi = import.meta.resolve('tsx/esm/api')
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = `import { register } from ${JSON.stringify(tsxApi)}\nregister()\nawait import(${JSON.stringify(entry.href)})`
    /**
     * 常量说明：worker 用于处理 worker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
      execArgv: [],
      workerData: {
        bootstrap,
        label: options.label ?? 'Test Client',
        ...(options.sourceCatalog === undefined ? {} : { sourceCatalog: options.sourceCatalog }),
      },
    })
    /**
     * 常量说明：onMessage 用于响应 Message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Message 相关流程；使用场景由所在模块及调用位置决定。
     * @param message （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onMessage(message)，并按返回类型处理结果。
     */
    const onMessage = (message: unknown): void => {
      if (!isRecord(message) || message.type !== 'ready' || typeof message.fiberUid !== 'number') return
      ready.resolve(message.fiberUid)
    }
    worker.on('message', onMessage)
    worker.once('error', ready.reject)
    /**
     * 常量说明：fiberUid 用于处理 fiberUid 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const fiberUid = await ready.promise
    worker.off('message', onMessage)
    return new InspectorClientFixture(worker, fiberUid)
  }

  /** Publish one observation from the Client realm.
   * @remarks 中文说明：功能说明：处理 publish 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：topic（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * publish(topic, value)，并按返回类型处理结果。 */
  async publish(topic: string, value: InspectorJsonValue): Promise<void> {
    await this.request({ op: 'publish', topic, value })
  }

  /** Set one JSON-compatible global used by Client Runtime evaluation.
   * @remarks 中文说明：功能说明：设置 Global 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * setGlobal(name, value)，并按返回类型处理结果。 */
  async setGlobal(name: string, value: InspectorJsonValue): Promise<void> {
    await this.request({ op: 'set-global', name, value })
  }

  /** Emit one Console event carrying a caller-provided value.
   * @remarks 中文说明：功能说明：处理 log 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：value（InspectorJsonValue）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：marker（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 log(value, marker)，
   * 并按返回类型处理结果。 */
  async log(value: InspectorJsonValue, marker: string): Promise<void> {
    await this.request({ op: 'log-value', value, marker })
  }

  /** Emit one Console event carrying the fixture's Context and Fiber.
   * @remarks 中文说明：功能说明：处理 logCordis 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：marker（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 logCordis(marker)，
   * 并按返回类型处理结果。 */
  async logCordis(marker: string): Promise<void> {
    await this.request({ op: 'log-cordis', marker })
  }

  /** Read the consumer-neutral Cordis tree through the Client service.
   * @remarks 中文说明：功能说明：获取 Cordis Tree 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<CordisRuntimeTree>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 getCordisTree()，并按返回类型处理结果。 */
  async getCordisTree(): Promise<CordisRuntimeTree> {
    return await this.request({ op: 'get-tree' }) as CordisRuntimeTree
  }

  /** Break the active ingest socket while preserving the Client source.
   * @remarks 中文说明：功能说明：处理 disconnect 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * disconnect()，并按返回类型处理结果。 */
  async disconnect(): Promise<void> {
    await this.request({ op: 'disconnect' })
  }

  /** Trigger a Cordis observation without changing the runtime tree.
   * @remarks 中文说明：功能说明：处理 refreshTree 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * refreshTree()，并按返回类型处理结果。 */
  async refreshTree(): Promise<void> {
    await this.request({ op: 'refresh-tree' })
  }

  /** Add one Fiber to the inspected Client runtime.
   * @remarks 中文说明：功能说明：处理 addFiber 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<number>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * addFiber()，并按返回类型处理结果。 */
  async addFiber(): Promise<number> {
    return await this.request({ op: 'add-fiber' }) as number
  }

  /** Remove the Fiber most recently added by {@link addFiber}.
   * @remarks 中文说明：功能说明：移除 Fiber 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 removeFiber()，并按返回类型处理结果。 */
  async removeFiber(): Promise<void> {
    await this.request({ op: 'remove-fiber' })
  }

  /** Dispose the Client source and its Cordis context.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  async close(): Promise<void> {
    if (this.closed) return
    await this.request({ op: 'close' })
    this.closed = true
    await this.worker.terminate()
  }

  /**
   * 功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。
   * @param fields （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 request(fields)，并按返回类型处理结果。
   */
  private async request(fields: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error('Inspector Client fixture is closed')
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = ++this.nextId
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = Promise.withResolvers<unknown>()
    this.pending.set(id, result)
    this.worker.postMessage({ id, ...fields })
    return await result.promise
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(message)，并按返回类型处理结果。
   */
  private receive(message: unknown): void {
    if (!isRecord(message) || message.type !== 'response' || typeof message.id !== 'number') return
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = message as unknown as FixtureResponse
    /**
     * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pending = this.pending.get(response.id)
    if (pending === undefined) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.value)
    else pending.reject(new Error(response.error ?? 'Inspector Client fixture request failed'))
  }

  /**
   * 功能说明：处理 fail 相关流程；使用场景由所在模块及调用位置决定。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 fail(error)，并按返回类型处理结果。
   */
  private fail(error: Error): void {
    /**
     * 变量说明：pending 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

/**
 * 功能说明：判断是否为 Record 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is Record<string, unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isRecord(value)，并按返回类型处理结果。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
