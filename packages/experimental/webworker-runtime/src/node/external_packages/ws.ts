/**
 * `ws` stub. `WebSocketDownlinks` constructs a `WebSocketServer` in a field
 * initializer as soon as Connection is present, so the class must be constructible;
 * no method is ever reached because the fake HTTP server never emits `upgrade`
 * (the tunnel carries downstream events over the SSE branch instead).
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 ws 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'ws'

/** Client socket (unavailable; the page side uses the tunnel, not WebSocket). */
/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** Client socket (unavailable; the page side uses the tunnel, not WebSocket).
 * @remarks 中文说明：类说明：WebSocket 用于集中封装 处理 WebSocket 相关状态与行为。；核心功能：通过成员字段保存状态，
 * 并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/webworker-runtime
 * 在对应插件或业务生命周期内创建和调用。 */
export default class WebSocket {
  /** Node's `CONNECTING` ready state, read by consumers that never connect.
   * @remarks 中文说明：常量说明：CONNECTING 用于处理 CONNECTING 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  static readonly CONNECTING = 0
  /** Node's `OPEN` ready state.
   * @remarks 中文说明：常量说明：OPEN 用于打开 OPEN 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  static readonly OPEN = 1
  /** Node's `CLOSING` ready state.
   * @remarks 中文说明：常量说明：CLOSING 用于处理 CLOSING 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  static readonly CLOSING = 2
  /** Node's `CLOSED` ready state.
   * @remarks 中文说明：常量说明：CLOSED 用于处理 CLOSED 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  static readonly CLOSED = 3

  /**
   * 功能说明：处理 WebSocket 相关流程；使用场景由所在模块及调用位置决定。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new WebSocket() 创建实例，并在所属生命周期内使用。
   */
  constructor() {
    throw new Error(`web-preview: ${MODULE} client sockets are not available in the worker host`)
  }
}

/** Server whose construction must succeed and whose methods are unreachable.
 * @remarks 中文说明：类说明：WebSocketServer 用于集中封装 处理 WebSocketServer 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/webworker-runtime 在对应插件或业务生命周期内创建和调用。 */
export class WebSocketServer {
  /** Connected clients: always empty, since no upgrade ever completes.
   * @remarks 中文说明：常量说明：clients 用于处理 clients 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly clients = new Set<never>()

  /** Upgrade handling (unreachable: no upgrade event is ever emitted).
   * @remarks 中文说明：常量说明：handleUpgrade 用于处理 Upgrade 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly handleUpgrade = notImplementedFail(MODULE, 'WebSocketServer.handleUpgrade')

  /** Broadcast helper (unreachable).
   * @remarks 中文说明：常量说明：emit 用于发送 emit 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly emit = notImplementedFail(MODULE, 'WebSocketServer.emit')

  /**
   * Register a listener; nothing is ever emitted.
   * @returns this server.
   * @remarks 中文说明：功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。；返回值：this；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 on()，并按返回类型处理结果。
   */
  on(): this {
    return this
  }

  /**
   * Close the server.
   * @param callback - completion callback, invoked immediately.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；参数说明：callback（() =>
   * void）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(callback)，并按返回类型处理结果。
   */
  close(callback?: () => void): void {
    callback?.()
  }
}

/** Alias Node consumers sometimes import.
 * @remarks 中文说明：常量说明：Server 用于处理 Server 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Server = WebSocketServer

export { WebSocket }
