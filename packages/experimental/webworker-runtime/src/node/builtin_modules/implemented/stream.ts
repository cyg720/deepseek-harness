/**
 * `node:stream` compatibility backed by readable-stream's browser build.
 *
 * readable-stream is the userland copy of Node's stream implementation. The
 * worker owns only platform adapters such as VFS file streams; stream state,
 * backpressure, async iteration, abort handling, and event ordering stay in
 * that maintained implementation.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 stream 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import Stream from 'readable-stream'

type StreamRuntime = typeof import('node:stream') & {
  /**
   * 功能说明：处理 compose 相关流程；使用场景由所在模块及调用位置决定。
   * @param streams （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 compose(streams)，并按返回类型处理结果。
   */
  compose(...streams: unknown[]): unknown
  /**
   * 功能说明：处理 destroy 相关流程；使用场景由所在模块及调用位置决定。
   * @param stream （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 destroy(stream, error)，并按返回类型处理结果。
   */
  destroy(stream: unknown, error?: Error): void
  /**
   * 功能说明：判断是否为 Disturbed 相关流程；使用场景由所在模块及调用位置决定。
   * @param stream （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isDisturbed(stream)，并按返回类型处理结果。
   */
  isDisturbed(stream: unknown): boolean
}

type StreamStatics = typeof import('node:stream').Stream & {
  /**
   * 功能说明：获取 Default High Water Mark 相关流程；使用场景由所在模块及调用位置决定。
   * @param objectMode （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getDefaultHighWaterMark(objectMode)，并按返回类型处理结果。
   */
  getDefaultHighWaterMark(objectMode: boolean): number
  /**
   * 功能说明：判断是否为 Destroyed 相关流程；使用场景由所在模块及调用位置决定。
   * @param stream （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isDestroyed(stream)，并按返回类型处理结果。
   */
  isDestroyed(stream: unknown): boolean | null
  /**
   * 功能说明：判断是否为 Writable 相关流程；使用场景由所在模块及调用位置决定。
   * @param stream （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean | null；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 isWritable(stream)，并按返回类型处理结果。
   */
  isWritable(stream: unknown): boolean | null
  /**
   * 功能说明：设置 Default High Water Mark 相关流程；使用场景由所在模块及调用位置决定。
   * @param objectMode （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setDefaultHighWaterMark(objectMode, value)，
   * 并按返回类型处理结果。
   */
  setDefaultHighWaterMark(objectMode: boolean, value: number): void
}

/**
 * 常量说明：nodeStream 用于处理 nodeStream 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const nodeStream = Stream as unknown as StreamRuntime

/* oxlint-disable typescript/unbound-method -- readable-stream's namespace statics do not read `this`. */
/**
 * 常量说明：Duplex、PassThrough、Readable、StreamBase、Transform、Writable、addAbortS
 * ignal、compose、destroy、finished、isDisturbed、isErrored、isReadable、pipeline
 * 、promises 用于处理 Duplex、PassThrough、Readable、StreamBase、Transform、Writable
 * 、addAbortSignal、compose、destroy、finished、isDisturbed、isErrored、isReadabl
 * e、pipeline、promises 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const {
  Duplex, PassThrough, Readable, Stream: StreamBase, Transform, Writable,
  addAbortSignal, compose, destroy, finished, isDisturbed, isErrored, isReadable, pipeline, promises,
} = nodeStream
/**
 * 常量说明：streamStatics 用于处理 streamStatics 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const streamStatics = StreamBase as unknown as StreamStatics
/**
 * 常量说明：getDefaultHighWaterMark、isDestroyed、isWritable、setDefaultHighWaterM
 * ark 用于获取 Default High Water Mark、is Destroyed、is Writable、set Default
 * High Water Mark 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const {
  getDefaultHighWaterMark, isDestroyed, isWritable, setDefaultHighWaterMark,
} = streamStatics
/* oxlint-enable typescript/unbound-method */

// readable-stream tracks Node 18's 16 KiB byte default; this repository runs
// Node 22+, whose generic and file streams use 64 KiB.
if (getDefaultHighWaterMark(false) !== 64 * 1024) setDefaultHighWaterMark(false, 64 * 1024)

/**
 * Test whether a value is an ArrayBuffer view.
 * @param value - Candidate value.
 * @returns Whether the value is a typed-array or DataView instance.
 * @remarks 中文说明：常量说明：_isArrayBufferView 用于判断是否为 Array Buffer View 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。；功能说明：判断是否为 Array Buffer View 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：value is ArrayBufferView；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 _isArrayBufferView(value)，并按返回类型处理结果。
 */
const _isArrayBufferView = (value: unknown): value is ArrayBufferView => ArrayBuffer.isView(value)

/** Default-import namespace carrying Node's stream class and static helpers.
 * @remarks 中文说明：常量说明：streamDefault 用于处理 streamDefault 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const streamDefault = Object.assign(StreamBase, {
  _isArrayBufferView,
  getDefaultHighWaterMark,
  isDestroyed,
  isWritable,
  setDefaultHighWaterMark,
})

export {
  Duplex,
  PassThrough,
  Readable,
  StreamBase as Stream,
  Transform,
  Writable,
  addAbortSignal,
  compose,
  destroy,
  finished,
  getDefaultHighWaterMark,
  _isArrayBufferView,
  isDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
  pipeline,
  promises,
  setDefaultHighWaterMark,
}

/** CommonJS interop marker consumed by the worker module loader.
 * @remarks 中文说明：常量说明：__esModule 用于处理 __esModule 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const __esModule = true

/** CommonJS-compatible namespace for default imports. */
export default streamDefault
