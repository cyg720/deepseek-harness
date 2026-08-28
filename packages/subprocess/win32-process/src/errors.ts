/** Win32 call failure with the exact API name and error code.
 * @remarks 文件说明：文件职责：实现 subprocess/win32-process 中 errors 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subprocess/win32-process 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 * @remarks 中文说明：类说明：Win32Error 用于集中封装 处理 Win32Error 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 subprocess/win32-process
 * 在对应插件或业务生命周期内创建和调用。 */
export class Win32Error extends Error {
  /** Win32 function whose checked result failed.
   * @remarks 中文说明：常量说明：api 用于处理 api 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
  readonly api: string
  /** Exact GetLastError value or direct Win32 API error code.
   * @remarks 中文说明：常量说明：win32Code 用于处理 win32Code 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly win32Code: number

  /**
   * 功能说明：处理 Win32Error 相关流程；使用场景由所在模块及调用位置决定。
   * @param api （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param win32Code （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param detail （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new Win32Error(api, win32Code, detail) 创建实例，并在所属生命周期内使用。
   */
  constructor(api: string, win32Code: number, detail?: string) {
    super(`${api} failed (Win32 ${win32Code})${detail === undefined ? '' : `: ${detail}`}`)
    this.name = 'Win32Error'
    this.api = api
    this.win32Code = win32Code
  }
}
