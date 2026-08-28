/** SourceBackend implementation over native Node Debugger notifications.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 sources 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'
import type { RuntimeScript } from '../../../shared/cdp/index.ts'
import type { HostInspectorNotification, HostInspectorSession } from './bridge.ts'
import type { SourceBackend } from '../../../shared/cdp/realm.ts'
import { hostScriptKey } from './scripts.ts'

interface HostScript {
  readonly descriptor: RuntimeScript
  readonly nativeId: string
}

/** Maintains one connection-local catalog of scripts reported by Node's inspector.
 * @remarks 中文说明：类说明：HostSourceBackend 用于集中封装 处理 HostSourceBackend 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class HostSourceBackend implements SourceBackend {
  /**
   * 常量说明：scripts 用于处理 scripts 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly scripts = new Map<RuntimeScriptKey, HostScript>()
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Set<(script: RuntimeScript) => void>()
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void

  /**
   * 功能说明：处理 HostSourceBackend 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （HostInspectorSession）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostSourceBackend(target) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly target: HostInspectorSession,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.unsubscribe = target.subscribe((message) => { this.receive(message) })
  }

  /**
   * 功能说明：列出 Scripts 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<readonly RuntimeScript[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listScripts()，并按返回类型处理结果。
   */
  listScripts(): Promise<readonly RuntimeScript[]> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：script（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(script)，并按返回类型处理结果。
     */
    return Promise.resolve([...this.scripts.values()].map(script => script.descriptor))
  }

  /**
   * 功能说明：获取 Script Source 相关流程；使用场景由所在模块及调用位置决定。
   * @param scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getScriptSource(scriptKey)，并按返回类型处理结果。
   */
  async getScriptSource(scriptKey: RuntimeScriptKey): Promise<string> {
    /**
     * 常量说明：script 用于处理 script 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const script = this.scripts.get(scriptKey)
    if (script === undefined) throw new Error('Host script is no longer available')
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await this.target.request('Debugger.getScriptSource', { scriptId: script.nativeId })
    if (typeof result.scriptSource !== 'string') throw new Error('Host Debugger returned no script source')
    return result.scriptSource
  }

  /**
   * 功能说明：获取 Source Map 相关流程；使用场景由所在模块及调用位置决定。
   * @param _scriptKey （RuntimeScriptKey）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<string | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getSourceMap(_scriptKey)，并按返回类型处理结果。
   */
  getSourceMap(_scriptKey: RuntimeScriptKey): Promise<string | undefined> {
    return Promise.resolve(undefined)
  }

  /**
   * Subscribe to scripts discovered after the initial catalog read.
   * @param listener - Consumer of newly discovered scripts.
   * @returns A disposer removing the consumer.
   * @remarks 中文说明：功能说明：处理 subscribe 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：listener（(script: RuntimeScript) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。；返回值：() => void；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 subscribe(listener)，并按返回类型处理结果。
   */
  subscribe(listener: (script: RuntimeScript) => void): () => void {
    this.listeners.add(listener)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return () => { this.listeners.delete(listener) }
  }

  /** Release the native notification subscription and cached catalog.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
    this.scripts.clear()
    this.listeners.clear()
  }

  /**
   * 功能说明：处理 receive 相关流程；使用场景由所在模块及调用位置决定。
   * @param message （HostInspectorNotification）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 receive(message)，并按返回类型处理结果。
   */
  private receive(message: HostInspectorNotification): void {
    if (message.method !== 'Debugger.scriptParsed') return
    /**
     * 常量说明：params 用于处理 params 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const params = message.params
    if (params === undefined
      || typeof params.scriptId !== 'string'
      || typeof params.url !== 'string'
      || !isInteger(params.startLine)
      || !isInteger(params.startColumn)
      || !isInteger(params.endLine)
      || !isInteger(params.endColumn)) return
    /**
     * 常量说明：scriptKey 用于处理 scriptKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scriptKey = hostScriptKey(params.scriptId)
    /**
     * 常量说明：descriptor 用于处理 descriptor 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const descriptor: RuntimeScript = {
      scriptKey,
      url: params.url,
      hash: typeof params.hash === 'string' ? params.hash : '',
      ...(typeof params.buildId === 'string' ? { buildId: params.buildId } : {}),
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      ...(typeof params.sourceMapURL === 'string' && params.sourceMapURL.length > 0
        ? { sourceMapUrl: params.sourceMapURL }
        : {}),
      ...(isInteger(params.executionContextId) ? { executionContextId: params.executionContextId } : {}),
      ...(typeof params.isModule === 'boolean' ? { isModule: params.isModule } : {}),
      ...(isInteger(params.length) ? { length: params.length } : {}),
    }
    this.scripts.set(scriptKey, { descriptor, nativeId: params.scriptId })
    /**
     * 变量说明：listener 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const listener of [...this.listeners]) {
      try {
        listener(descriptor)
      } catch {
        // One source consumer cannot prevent delivery to sibling consumers.
      }
    }
  }
}

/**
 * 功能说明：判断是否为 Integer 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns value is number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isInteger(value)，并按返回类型处理结果。
 */
function isInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
