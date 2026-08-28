/**
 * `node:perf_hooks`: the worker's own high-resolution clock.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 perf hooks 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'node:perf_hooks'

/** Same clock object the worker global exposes.
 * @remarks 中文说明：常量说明：performance 用于处理 performance 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const performance = globalThis.performance

/** Observation of performance entries has no consumer here.
 * @remarks 中文说明：常量说明：PerformanceObserver 用于处理 PerformanceObserver 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PerformanceObserver: typeof import('node:perf_hooks').PerformanceObserver
  = notImplementedFail(MODULE, 'PerformanceObserver')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/**
 * The `node:perf_hooks` declarations this module stands in for. `performance`
 * keeps the worker's own clock: Node declares its clock with `nodeTiming`,
 * `timerify`, and event-loop utilization, none of which a browser `Performance`
 * object carries.
 */
type NodeFace = Partial<Omit<typeof import('node:perf_hooks'), 'performance'>> & Record<'performance', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { performance, PerformanceObserver } satisfies NodeFace
