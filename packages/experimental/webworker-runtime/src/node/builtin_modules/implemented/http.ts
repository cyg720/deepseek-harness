/**
 * `node:http` for the worker: `createServer` returns a Server whose `listen`
 * succeeds immediately without a socket, and retains the captured request
 * listener so the tunnel server can feed synthesized requests into the real
 * route table. The fake Server exposes only the members those routes read.
 * The worker entry hands {@link whenRequestListener} to the host assembly, so the
 * package never reaches back into this app.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 http 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { RequestListener } from '../../../transport/synthetic-http.ts'

type Listener = (...args: unknown[]) => void

export type { RequestListener }

/** Port reported by `address()`; it becomes `webServer.port`.
 * @remarks 中文说明：常量说明：VIRTUAL_PORT 用于处理 VIRTUAL_PORT 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const VIRTUAL_PORT = 3080

/**
 * 变量说明：captured 用于处理 captured 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let captured: RequestListener | undefined
/**
 * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const waiting = new Set<(listener: RequestListener) => void>()

/**
 * The webserver's request listener, once `[Service.init]` has installed it.
 * @returns the listener, or undefined before the webserver row activates.
 * @remarks 中文说明：功能说明：处理 requestListener 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：RequestListener | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 requestListener()，并按返回类型处理结果。
 */
export function requestListener(): RequestListener | undefined {
  return captured
}

/**
 * Await the request listener.
 * @returns a promise resolved with the listener as soon as it is captured.
 * @remarks 中文说明：功能说明：处理 whenRequestListener 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：Promise<RequestListener>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 whenRequestListener()，并按返回类型处理结果。
 */
export async function whenRequestListener(): Promise<RequestListener> {
  if (captured !== undefined) return captured
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  return await new Promise<RequestListener>(resolve => waiting.add(resolve))
}

/** Fake Server: event registrations are stored and never emitted.
 * @remarks 中文说明：类说明：FakeServer 用于集中封装 处理 FakeServer 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
class FakeServer {
  /**
   * 常量说明：listeners 用于处理 listeners 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly listeners = new Map<string, Set<Listener>>()

  /**
   * Register an event listener (`upgrade`, `error`); never emitted.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this server.
   * @remarks 中文说明：功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 on(event, listener)，
   * 并按返回类型处理结果。
   */
  on(event: string, listener: Listener): this {
    /**
     * 常量说明：set 用于设置 set 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
    return this
  }

  /**
   * One-shot registration counterpart of {@link on}.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this server.
   * @remarks 中文说明：功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 once(event, listener)，
   * 并按返回类型处理结果。
   */
  once(event: string, listener: Listener): this {
    return this.on(event, listener)
  }

  /**
   * Remove a listener.
   * @param event - event name.
   * @param listener - the listener.
   * @returns this server.
   * @remarks 中文说明：功能说明：处理 off 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：event（string）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：listener（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 off(event, listener)，
   * 并按返回类型处理结果。
   */
  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  /**
   * Bind: succeeds immediately. The callback must run or the webserver fiber
   * stays in LOADING forever.
   * @param args - Node's listen arguments; only a trailing callback matters.
   * @returns this server.
   * @remarks 中文说明：功能说明：处理 listen 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 listen(args)，并按返回类型处理结果。
   */
  listen(...args: unknown[]): this {
    /**
     * 常量说明：callback 用于处理 callback 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const callback = args.at(-1)
    if (typeof callback === 'function') /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
queueMicrotask(() => { (callback as Listener)() })
    return this
  }

  /**
   * Bound address.
   * @returns the loopback authority the tunnel synthesizes.
   * @remarks 中文说明：功能说明：处理 address 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ address:
   * string; family: string; port: number }；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 address()，并按返回类型处理结果。
   */
  address(): { address: string; family: string; port: number } {
    return { address: '127.0.0.1', family: 'IPv4', port: VIRTUAL_PORT }
  }

  /**
   * Close: no socket to release.
   * @param callback - completion callback, invoked immediately.
   * @returns this server.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：callback（Listener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：this；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(callback)，
   * 并按返回类型处理结果。
   */
  close(callback?: Listener): this {
    if (callback !== undefined) /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
queueMicrotask(() => { callback() })
    return this
  }

  /** No connection was ever accepted.
   * @remarks 中文说明：功能说明：关闭 All Connections 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 closeAllConnections()，
   * 并按返回类型处理结果。 */
  closeAllConnections(): void {
    // Nothing is ever accepted through this Server.
  }

  /** No idle connection exists either.
   * @remarks 中文说明：功能说明：关闭 Idle Connections 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 closeIdleConnections()，
   * 并按返回类型处理结果。 */
  closeIdleConnections(): void {
    // Nothing is ever accepted through this Server.
  }
}

/**
 * Constructor marker read by middleware during feature detection. Tunnel
 * responses are synthesized objects and are never instances of this class.
 * @remarks 中文说明：类说明：ServerResponse 用于集中封装 处理 ServerResponse 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。
 */
export class ServerResponse {}

/**
 * Create the fake server and retain its request listener for the tunnel.
 * @param listener - the request listener the webserver installs.
 * @returns the fake Server.
 * @remarks 中文说明：功能说明：创建 Server 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：listener（RequestListener）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；
 * 返回值：FakeServer；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * createServer(listener)，并按返回类型处理结果。
 */
export function createServer(listener?: RequestListener): FakeServer {
  if (listener !== undefined) {
    captured = listener
    /**
     * 变量说明：resolve 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const resolve of waiting) resolve(listener)
    waiting.clear()
  }
  return new FakeServer()
}

/**
 * Outbound HTTP has one carrier in the worker: `fetch`.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：处理 request 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 request()，并按返回类型处理结果。
 */
export function request(): never {
  throw new Error('web-preview: node:http.request is not available in the worker host — use fetch')
}

/**
 * Same as {@link request}.
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 get()，并按返回类型处理结果。
 */
export function get(): never {
  throw new Error('web-preview: node:http.get is not available in the worker host — use fetch')
}

/** Status text table Node exposes; a few handlers write status lines by hand.
 * @remarks 中文说明：常量说明：STATUS_CODES 用于处理 STATUS_CODES 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STATUS_CODES: typeof import('node:http').STATUS_CODES = {
  200: 'OK',
  204: 'No Content',
  304: 'Not Modified',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  426: 'Upgrade Required',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

export { FakeServer as Server }

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:http` declarations this module stands in for. `Server` and
 * `createServer` keep this module's own types: Node declares the server as a
 * `net.Server` carrying sockets and a Node `RequestListener`, while this one binds
 * nothing and captures the synthesized-request listener the tunnel feeds.
 */
type NodeFace = Partial<Omit<typeof import('node:http'), 'Server' | 'ServerResponse' | 'createServer'>>
  & Record<'Server' | 'ServerResponse' | 'createServer', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { createServer, request, get, STATUS_CODES, Server: FakeServer, ServerResponse } satisfies NodeFace
