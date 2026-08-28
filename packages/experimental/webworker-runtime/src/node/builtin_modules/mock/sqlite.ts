/**
 * `node:sqlite` stub. The web profile configures session-query-sqlite with
 * `:memory:` and `openAt: never`, so no database is opened during the acceptance
 * chain; reaching the constructor means that configuration changed.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 sqlite 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notAvailableError, notImplementedFail } from '../../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'node:sqlite'

/** Synchronous database handle (unavailable).
 * @remarks 中文说明：常量说明：DatabaseSync 用于处理 DatabaseSync 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DatabaseSync: typeof import('node:sqlite').DatabaseSync = notImplementedFail(MODULE, 'DatabaseSync')

/** Prepared statement handle (unavailable).
 * @remarks 中文说明：常量说明：StatementSync 用于处理 StatementSync 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const StatementSync: typeof import('node:sqlite').StatementSync = notImplementedFail(MODULE, 'StatementSync')

/**
 * Backup helper (unavailable).
 * @returns Never — it throws naming the unavailable member.
 * @remarks 中文说明：功能说明：处理 backup 相关流程；使用场景由所在模块及调用位置决定。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 backup()，并按返回类型处理结果。
 */
export function backup(): never {
  throw notAvailableError(MODULE, 'backup')
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** The `node:sqlite` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:sqlite')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { DatabaseSync, StatementSync, backup } satisfies NodeFace
