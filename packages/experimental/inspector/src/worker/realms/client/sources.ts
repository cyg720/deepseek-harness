/** Client SourceBackend over the bounded browser source-catalog transport.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 sources 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { ClientScriptDescriptor, ClientSourceResult } from '../../../shared/bridge/messages/sources/index.ts'
import type { ClientSourceSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'
import type { RuntimeScript } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'
import type { SourceBackend } from '../../../shared/cdp/realm.ts'
import type { ClientScriptIdentity } from './scripts.ts'

interface ClientScriptRoute {
  readonly localKey: RuntimeScriptKey
}

/** Presents one Client bundle catalog through the common read-only source model.
 * @remarks 中文说明：类说明：ClientSourceBackend 用于集中封装 处理 ClientSourceBackend
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientSourceBackend implements SourceBackend {
  /**
   * 常量说明：scripts 用于处理 scripts 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly scripts = new Map<RuntimeScriptKey, ClientScriptRoute>()
  /**
   * 变量说明：catalog 用于处理 catalog 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private catalog: Promise<readonly RuntimeScript[]> | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientSourceBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （ClientRuntimeTarget）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param sessionId （ClientSourceSessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param router （ClientSourceRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param scriptIds （ClientScriptIdentity）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientSourceBackend(target, sessionId, router,
   * scriptIds) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientSourceSessionId,
    private readonly router: ClientSourceRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  /**
   * 功能说明：列出 Scripts 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<readonly RuntimeScript[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listScripts()，并按返回类型处理结果。
   */
  async listScripts(): Promise<readonly RuntimeScript[]> {
    if (this.closed) throw new Error('Client source session is closed')
    this.catalog ??= this.loadCatalog()
    return this.catalog
  }

  /**
   * 功能说明：获取 Script Source 相关流程；使用场景由所在模块及调用位置决定。
   * @param scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getScriptSource(scriptKey)，并按返回类型处理结果。
   */
  async getScriptSource(scriptKey: RuntimeScriptKey): Promise<string> {
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = await this.route(scriptKey)
    /**
     * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const source = await this.read(route.localKey, 'source')
    if (source === undefined) throw new Error('Client script source is unavailable')
    return source
  }

  /**
   * 功能说明：获取 Source Map 相关流程；使用场景由所在模块及调用位置决定。
   * @param scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getSourceMap(scriptKey)，并按返回类型处理结果。
   */
  async getSourceMap(scriptKey: RuntimeScriptKey): Promise<string | undefined> {
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = await this.route(scriptKey)
    return this.read(route.localKey, 'source-map')
  }

  /**
   * 功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。
   * @param _listener （(script: RuntimeScript) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns () => void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 subscribe(_listener)，并按返回类型处理结果。
   */
  subscribe(_listener: (script: RuntimeScript) => void): () => void {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => {}
  }

  /** Reject pending reads owned by this DevTools connection.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.router.closeSession(this.target.source, this.sessionId)
    this.scripts.clear()
  }

  /**
   * 功能说明：加载 Catalog 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<readonly RuntimeScript[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 loadCatalog()，并按返回类型处理结果。
   */
  private async loadCatalog(): Promise<readonly RuntimeScript[]> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = expectResult(await this.router.request(
      this.target.source,
      this.sessionId,
      { op: 'list-scripts' },
    ), 'list-scripts')
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：script（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(script)，并按返回类型处理结果。
     */
    return result.scripts.map(script => this.register(script))
  }

  /**
   * 功能说明：注册 register 相关流程；使用场景由所在模块及调用位置决定。
   * @param script （ClientScriptDescriptor）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns RuntimeScript；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 register(script)，并按返回类型处理结果。
   */
  private register(script: ClientScriptDescriptor): RuntimeScript {
    /**
     * 常量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptKey = this.scriptIds.toRuntime(script.scriptKey)
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor: RuntimeScript = {
      ...script,
      scriptKey,
      executionContextId: this.target.contextId,
    }
    this.scripts.set(scriptKey, { localKey: script.scriptKey })
    return descriptor
  }

  /**
   * 功能说明：处理 route 相关流程；使用场景由所在模块及调用位置决定。
   * @param scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<ClientScriptRoute>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 route(scriptKey)，并按返回类型处理结果。
   */
  private async route(scriptKey: RuntimeScriptKey): Promise<ClientScriptRoute> {
    await this.listScripts()
    /**
     * 常量说明：route 用于处理 route 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const route = this.scripts.get(scriptKey)
    if (route === undefined) throw new Error('Client script is no longer available')
    return route
  }

  /**
   * 功能说明：读取 read 相关流程；使用场景由所在模块及调用位置决定。
   * @param scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param content （'source' | 'source-map'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 read(scriptKey, content)，并按返回类型处理结果。
   */
  private async read(
    scriptKey: RuntimeScriptKey,
    content: 'source' | 'source-map',
  ): Promise<string | undefined> {
    /**
     * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const chunks: Uint8Array[] = []
    /**
     * 变量说明：offset 用于处理 offset 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let offset = 0
    while (true) {
      /**
       * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const result = expectResult(await this.router.request(this.target.source, this.sessionId, {
        op: 'get-content-chunk',
        scriptKey,
        content,
        offset,
        maxBytes: this.router.chunkBytes,
      }), 'get-content-chunk')
      if (!result.available) return undefined
      /**
       * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const bytes = Buffer.from(result.data, 'base64')
      if (bytes.byteLength > this.router.chunkBytes
        || result.nextOffset !== offset + bytes.byteLength
        || (!result.eof && result.nextOffset === offset)
        || result.nextOffset > this.router.maxContentBytes) {
        throw new Error('Client source returned an invalid content chunk')
      }
      chunks.push(bytes)
      offset = result.nextOffset
      if (result.eof) break
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
  }
}

/**
 * 功能说明：处理 expectResult 相关流程；使用场景由所在模块及调用位置决定。
 * @param result （ClientSourceResult）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param operation （Operation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Extract<ClientSourceResult, { op: Operation }>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 expectResult(result, operation)，并按返回类型处理结果。
 */
function expectResult<Operation extends ClientSourceResult['op']>(
  result: ClientSourceResult,
  operation: Operation,
): Extract<ClientSourceResult, { op: Operation }> {
  if (result.op !== operation) throw new Error(`Client source returned ${result.op} for ${operation}`)
  return result as Extract<ClientSourceResult, { op: Operation }>
}
