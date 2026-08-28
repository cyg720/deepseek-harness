/**
 * `node:net` for the worker. Nothing accepts or dials a socket here: the fake
 * HTTP server never emits `upgrade`, so only the address predicates and a
 * constructible-but-loud Socket are reachable.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 net 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：常量说明：IPV4 用于处理 IPV4 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/
/**
 * 常量说明：IPV6 用于处理 IPV6 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const IPV6 = /^[0-9a-f:]+$/i

/** Constructible placeholder: the WebSocket upgrade path never runs in the worker.
 * @remarks 中文说明：类说明：Socket 用于集中封装 处理 Socket 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export class Socket {
  /**
   * Sockets are never written to; reaching this means an upgrade path activated.
   * @returns Never — it throws naming the unavailable member.
   * @remarks 中文说明：功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 write()，并按返回类型处理结果。
   */
  write(): never {
    throw new Error('web-preview: node:net Socket.write is not available in the worker host')
  }

  /**
   * Counterpart of {@link write}.
   * @returns Never — it throws naming the unavailable member.
   * @remarks 中文说明：功能说明：处理 end 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 end()，并按返回类型处理结果。
   */
  end(): never {
    throw new Error('web-preview: node:net Socket.end is not available in the worker host')
  }

  /** Teardown is accepted so disposal paths stay quiet.
   * @remarks 中文说明：功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 destroy()，并按返回类型处理结果。 */
  destroy(): void {
    // No resource was ever held.
  }
}

/**
 * Whether a string is an IPv4 literal.
 * @param value - candidate.
 * @returns true for dotted-quad literals.
 * @remarks 中文说明：功能说明：判断是否为 IPv4 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isIPv4(value)，并按返回类型处理结果。
 */
export function isIPv4(value: string): boolean {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：part（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(part)，并按返回类型处理结果。
   */
  return IPV4.test(value) && value.split('.').every(part => Number(part) <= 255)
}

/**
 * Whether a string is an IPv6 literal.
 * @param value - candidate.
 * @returns true for colon-hex literals.
 * @remarks 中文说明：功能说明：判断是否为 IPv6 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isIPv6(value)，并按返回类型处理结果。
 */
export function isIPv6(value: string): boolean {
  return value.includes(':') && IPV6.test(value)
}

/**
 * IP family of a literal.
 * @param value - candidate.
 * @returns 4, 6, or 0 when it is not an IP literal.
 * @remarks 中文说明：功能说明：判断是否为 IP 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isIP(value)，并按返回类型处理结果。
 */
export function isIP(value: string): number {
  if (isIPv4(value)) return 4
  if (isIPv6(value)) return 6
  return 0
}

/**
 * TCP listening is the fake HTTP server's business; a bare net server is unreachable.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：创建 Server 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createServer()，并按返回类型处理结果。
 */
export function createServer(): never {
  throw new Error('web-preview: node:net.createServer is not available in the worker host')
}

/**
 * Outbound connections have no carrier in a worker.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：处理 connect 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 connect()，并按返回类型处理结果。
 */
export function connect(): never {
  throw new Error('web-preview: node:net.connect is not available in the worker host')
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:net` declarations this module stands in for. `Socket` keeps this
 * module's own class: Node declares it as a duplex stream, and a placeholder
 * that holds no connection has no stream state to expose.
 */
type NodeFace = Partial<Omit<typeof import('node:net'), 'Socket'>> & Record<'Socket', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { Socket, isIP, isIPv4, isIPv6, createServer, connect } satisfies NodeFace
