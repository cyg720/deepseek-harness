/**
 * Process-wide slot holding the mounted filesystem. Kept apart from any
 * backend implementation: the `node:fs` proxy depends on the slot, not on
 * which backend the worker entry mounted.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 active 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import type { Vfs } from './types.ts'

/**
 * 变量说明：active 用于处理 active 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let active: Vfs | undefined

/**
 * Publish the filesystem the `node:fs` proxy reads.
 * @param vfs - Filesystem mounted by the worker entry.
 * @remarks 中文说明：功能说明：设置 Active Vfs 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：vfs（Vfs）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 setActiveVfs(vfs)，并按返回类型处理结果。
 */
export function setActiveVfs(vfs: Vfs): void {
  active = vfs
}

/**
 * Read the mounted filesystem.
 * @returns The active filesystem.
 * @remarks 中文说明：功能说明：处理 requireActiveVfs 相关流程；使用场景由所在模块及调用位置决定。；返回值：Vfs；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requireActiveVfs()，
 * 并按返回类型处理结果。
 */
export function requireActiveVfs(): Vfs {
  if (active === undefined) {
    throw new Error('webworker vfs: no filesystem is mounted; the worker entry must call setActiveVfs before any node:fs access')
  }
  return active
}
