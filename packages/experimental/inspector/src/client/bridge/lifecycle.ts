/** Reconnection lifecycle for the browser Client bridge. */

/** Owns one bounded-backoff timer and prevents reconnection after disposal.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 lifecycle 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：类说明：ClientBridgeLifecycle 用于集中封装 处理 ClientBridgeLifecycle
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * experimental/inspector 在对应插件或业务生命周期内创建和调用。 */
export class ClientBridgeLifecycle {
  /**
   * 变量说明：reconnectAttempt 用于处理 reconnectAttempt 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private reconnectAttempt = 0
  /**
   * 变量说明：reconnectTimer 用于处理 reconnectTimer 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * 变量说明：closed 用于处理 closed 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closed = false

  /**
   * 功能说明：处理 ClientBridgeLifecycle 相关流程；使用场景由所在模块及调用位置决定。
   * @param baseDelayMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param maxDelayMs （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ClientBridgeLifecycle(baseDelayMs, maxDelayMs) 创建实例，
   * 并在所属生命周期内使用。
   */
  constructor(
    private readonly baseDelayMs: number,
    private readonly maxDelayMs: number,
  ) {}

  /** Reset backoff after the Worker accepts a source generation.
   * @remarks 中文说明：功能说明：处理 connected 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 connected()，并按返回类型处理结果。 */
  connected(): void {
    this.reconnectAttempt = 0
  }

  /**
   * Schedule the next reconnect attempt unless one is already pending.
   * @param connect - Operation that opens the next transport generation.
   * @remarks 中文说明：功能说明：处理 reconnect 相关流程；使用场景由所在模块及调用位置决定。；参数说明：connect（()
   * => void）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；使用示例：典型用法：在完成前置校验后调用 reconnect(connect)，并按返回类型处理结果。
   */
  reconnect(connect: () => void): void {
    if (this.reconnectTimer !== undefined || this.closed) return
    /**
     * 常量说明：cap 用于处理 cap 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cap = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** this.reconnectAttempt)
    this.reconnectAttempt++
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      connect()
    }, cap / 2 + Math.random() * cap / 2)
  }

  /** Stop pending and future reconnect attempts.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }
}
