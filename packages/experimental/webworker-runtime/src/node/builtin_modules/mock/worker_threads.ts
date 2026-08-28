/**
 * `node:worker_threads` stub. Nested workers are unsupported, so the workflow
 * and code-runtime plugin bodies mount and fail on use. The
 * thread-identity values are real: they say "this is the main thread", which is
 * what the worker host is from the tree's point of view.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 worker threads
 * 模块的职责，并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与
 * Cordis 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

/**
 * 常量说明：MODULE 用于处理 MODULE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const MODULE = 'node:worker_threads'

/** Worker-thread construction (unavailable).
 * @remarks 中文说明：常量说明：Worker 用于处理 Worker 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const Worker: typeof import('node:worker_threads').Worker = notImplementedFail(MODULE, 'Worker')

/** The host tree runs on the worker's main thread.
 * @remarks 中文说明：常量说明：isMainThread 用于判断是否为 Main Thread 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const isMainThread = true

/** Thread id of the worker's main thread.
 * @remarks 中文说明：常量说明：threadId 用于处理 threadId 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const threadId = 0

/** No parent port exists, which Node reports as `null` outside a worker thread.
 * @remarks 中文说明：常量说明：parentPort 用于处理 parentPort 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const parentPort = null

/** No thread data was handed in.
 * @remarks 中文说明：常量说明：workerData 用于处理 workerData 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const workerData = undefined

/** Channel construction (unavailable).
 * @remarks 中文说明：常量说明：MessageChannel 用于处理 MessageChannel 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const MessageChannel: typeof import('node:worker_threads').MessageChannel = notImplementedFail(MODULE, 'MessageChannel')

/** Port construction (unavailable).
 * @remarks 中文说明：常量说明：MessagePort 用于处理 MessagePort 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const MessagePort: typeof import('node:worker_threads').MessagePort = notImplementedFail(MODULE, 'MessagePort')

/** Object transfer marking (unavailable).
 * @remarks 中文说明：常量说明：markAsUntransferable 用于处理 markAsUntransferable 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const markAsUntransferable: typeof import('node:worker_threads').markAsUntransferable
  = notImplementedFail(MODULE, 'markAsUntransferable')

/** Port receiving on a message channel (unavailable).
 * @remarks 中文说明：常量说明：receiveMessageOnPort 用于处理 receiveMessageOnPort 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const receiveMessageOnPort: typeof import('node:worker_threads').receiveMessageOnPort
  = notImplementedFail(MODULE, 'receiveMessageOnPort')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts).
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** The `node:worker_threads` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:worker_threads')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  Worker, isMainThread, threadId, parentPort, workerData, MessageChannel, MessagePort,
  markAsUntransferable, receiveMessageOnPort,
} satisfies NodeFace
