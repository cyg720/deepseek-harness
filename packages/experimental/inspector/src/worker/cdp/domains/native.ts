/** Explicit adapter for Host-only native CDP methods during realm migration.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 native 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { respondToCdpRequest, type CdpRequest, type CdpTransport } from '../protocol.ts'
import type { NativeDomainBackend } from '../../../shared/cdp/realm.ts'

/** Forwards one explicit Host-native domain through a transport-neutral Node session.
 * @remarks 中文说明：类说明：HostNativeDomainSession 用于集中封装 处理
 * HostNativeDomainSession 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class HostNativeDomainSession {
  /**
   * 常量说明：unsubscribe 用于处理 unsubscribe 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly unsubscribe: () => void

  /**
   * 功能说明：处理 HostNativeDomainSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param transport （CdpTransport）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param target （NativeDomainBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new HostNativeDomainSession(transport, target) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly transport: CdpTransport,
    private readonly target: NativeDomainBackend,
  ) {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：message（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(message)，并按返回类型处理结果。
     */
    this.unsubscribe = target.subscribe((message) => {
      if (!this.owns(message.method)
        || message.method === 'Runtime.consoleAPICalled'
        || message.method === 'Runtime.exceptionThrown') return
      this.transport.send(message)
    })
  }

  /**
   * Execute one Host-native CDP request and send its correlated result.
   * @param request - Parsed request owned by a native Host domain.
   * @returns Whether this adapter owns the request's domain.
   * @remarks 中文说明：功能说明：处理 handle 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（CdpRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 handle(request)，
   * 并按返回类型处理结果。
   */
  handle(request: CdpRequest): boolean {
    if (!this.owns(request.method)) return false
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    respondToCdpRequest(this.transport, request, async () => this.target.request(request.method, request.params))
    return true
  }

  /**
   * Test whether this adapter owns a CDP method.
   * @param method - CDP method name.
   * @returns Whether the method belongs to an explicit Host-native domain.
   * @remarks 中文说明：功能说明：处理 owns 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：method（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 owns(method)，并按返回类型处理结果。
   */
  owns(method: string): boolean {
    return NATIVE_DOMAINS.has(method.slice(0, method.indexOf('.')))
  }

  /** Stop forwarding native notifications to this DevTools connection.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    this.unsubscribe()
  }

}

/**
 * 常量说明：NATIVE_DOMAINS 用于处理 NATIVE_DOMAINS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const NATIVE_DOMAINS = new Set(['Runtime', 'Profiler', 'HeapProfiler', 'Schema'])
