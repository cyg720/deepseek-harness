/**
 * `node:vm` stub. Script compilation in a separate realm has no browser
 * counterpart; the self-modification and workflow rows mount and report the gap
 * when they try to compile.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 vm 模块的职责，
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
const MODULE = 'node:vm'

/** Compiled script (unavailable).
 * @remarks 中文说明：常量说明：Script 用于处理 Script 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Script: typeof import('node:vm').Script = notImplementedFail(MODULE, 'Script')

/** Context creation (unavailable).
 * @remarks 中文说明：常量说明：createContext 用于创建 Context 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const createContext: typeof import('node:vm').createContext = notImplementedFail(MODULE, 'createContext')

/** In-context evaluation (unavailable).
 * @remarks 中文说明：常量说明：runInContext 用于执行 In Context 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const runInContext: typeof import('node:vm').runInContext = notImplementedFail(MODULE, 'runInContext')

/** New-context evaluation (unavailable).
 * @remarks 中文说明：常量说明：runInNewContext 用于执行 In New Context 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const runInNewContext: typeof import('node:vm').runInNewContext = notImplementedFail(MODULE, 'runInNewContext')

/** This-context evaluation (unavailable).
 * @remarks 中文说明：常量说明：runInThisContext 用于执行 In This Context 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const runInThisContext: typeof import('node:vm').runInThisContext = notImplementedFail(MODULE, 'runInThisContext')

/** Context predicate (unavailable).
 * @remarks 中文说明：常量说明：isContext 用于判断是否为 Context 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const isContext: typeof import('node:vm').isContext = notImplementedFail(MODULE, 'isContext')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** The `node:vm` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:vm')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  Script, createContext, runInContext, runInNewContext, runInThisContext, isContext,
} satisfies NodeFace
