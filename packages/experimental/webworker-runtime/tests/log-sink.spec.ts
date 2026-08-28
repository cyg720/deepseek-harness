/**
 * The worker host's log sink: the seam that makes a failing plugin visible.
 *
 * Cordis's `LoggerService` accepts every message and, with no exporter mounted,
 * only fills a ring buffer. No profile in this repository mounts one, so a
 * provider that fails and is skipped — the skill registry logs exactly that —
 * is indistinguishable from one that found nothing. The sink is exercised here
 * rather than trusted: a diagnostic that runs nothing is a diagnostic that
 * silently stops working.
 * @remarks 文件说明：文件职责：验证 experimental/webworker-runtime 中 log sink spec
 * 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installLogSink, type LogExporter, type LogMessage } from '../src/worker-host.ts'

/** Capture the exporter the sink registers, and the cordis renderer it asks for.
 * @remarks 中文说明：功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。；返回值：{ register: ()
 * => LogExporter; requested: string[] }；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 harness()，并按返回类型处理结果。 */
function harness(): { register: () => LogExporter; requested: string[] } {
  /**
   * 常量说明：requested 用于处理 requested 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const requested: string[] = []
  /**
   * 变量说明：registered 用于处理 registered 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let registered: LogExporter | undefined
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：exporter（LogExporter）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(exporter)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const ctx = {
    loader: { internal: undefined },
    logger: { exporter: (exporter: LogExporter) => { registered = exporter; return undefined } },
    get: () => undefined,
    provide: () => {},
    fiber: { dispose: async () => {} },
  }
  /**
   * 常量说明：require 用于处理 require 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 require 相关流程；使用场景由所在模块及调用位置决定。
   * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 require(specifier)，并按返回类型处理结果。
   */
  const require = (specifier: string): unknown => {
    requested.push(specifier)
    // Stand in for cordis's printf renderer: the sink's contract is that it
    // formats THROUGH it, not that it reimplements the format.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_exporter（LogExporter）：提供本次调用所需的数
     * 据；必须满足声明的类型及调用时序要求。；参数：message（LogMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
     * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(_exporter, message)，并按返回类型处理结果。
     */
    return { Logger: { format: (_exporter: LogExporter, message: LogMessage) => `rendered(${message.args.join('|')})` } }
  }
  installLogSink(ctx, require)
  if (registered === undefined) throw new Error('the sink registered no exporter')
  /**
   * 常量说明：exporter 用于处理 exporter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const exporter = registered
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return { register: () => exporter, requested }
}

/**
 * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 * 功能说明：处理 message 相关流程；使用场景由所在模块及调用位置决定。
 * @param type （LogMessage['type']）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns LogMessage；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 message(type, name, args)，并按返回类型处理结果。
 */
const message = (type: LogMessage['type'], name: string, ...args: unknown[]): LogMessage => ({ name, type, args })

// Console spies are installed on one shared object, so a surviving spy would
// carry the previous case's calls into the counting case below.
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => { vi.restoreAllMocks() })

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('worker host log sink', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('registers one exporter and renders through cordis', () => {
    /**
     * 常量说明：register、requested 用于处理 register、requested 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { register, requested } = harness()
    expect(requested).toEqual(['@deepseek-ai/cordis'])
    // Colors off: the page console has no terminal escapes to interpret.
    expect(register().colors).toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('declares a verbosity gate that admits warnings', () => {
    // cordis's scale counts UP with verbosity (ERROR 0, INFO 1, WARN 2, DEBUG 3)
    // and it drops a message whose level EXCEEDS the exporter's, so an exporter
    // that declares nothing inherits INFO and never sees a warning. This case is
    // the one that matters: the sink exists for warnings, and getting the
    // comparison backwards makes it silently deliver nothing.
    /**
     * 常量说明：admits 用于处理 admits 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 admits 相关流程；使用场景由所在模块及调用位置决定。
     * @param exporterLevel （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param messageLevel （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 admits(exporterLevel, messageLevel)，并按返回类型处理结果。
     */
    const admits = (exporterLevel: number, messageLevel: number): boolean => exporterLevel >= messageLevel
    /**
     * 常量说明：gate 用于处理 gate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const gate = harness().register().levels.default
    expect(admits(gate, 2), 'warnings must pass the gate').toBe(true)
    expect(admits(gate, 0), 'errors must pass the gate').toBe(true)
    expect(admits(gate, 3), 'debug must not pass the gate').toBe(false)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports a warning with its logger name, the way a skipped provider arrives', () => {
    /**
     * 常量说明：warned 用于处理 warned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    harness().register().export(message('warn', 'skill', 'provider "local" skipped: FS_IO_ERROR'))
    expect(warned).toHaveBeenCalledWith('skill: rendered(provider "local" skipped: FS_IO_ERROR)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports an error on the error channel', () => {
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {})
    harness().register().export(message('error', 'loader', 'boom'))
    expect(failed).toHaveBeenCalledWith('loader: rendered(boom)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('drops info and debug, which 131 plugin rows would bury the console with', () => {
    /**
     * 常量说明：logged 用于处理 logged 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
    /**
     * 常量说明：warned 用于处理 warned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {})
    /**
     * 常量说明：exporter 用于处理 exporter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const exporter = harness().register()
    exporter.export(message('info', 'timer', 'tick'))
    exporter.export(message('debug', 'loader', 'resolved'))
    expect([logged.mock.calls.length, warned.mock.calls.length, failed.mock.calls.length]).toEqual([0, 0, 0])
  })
})
