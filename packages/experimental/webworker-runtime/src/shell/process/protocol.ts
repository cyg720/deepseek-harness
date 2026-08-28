/**
 * The frames a shell process and its host exchange.
 *
 * A command runs in its own Web Worker, which owns no filesystem: the VFS
 * stays in the host worker and every read or write is a request on this
 * channel. Blocking the child on a reply is impossible here (that would need
 * `SharedArrayBuffer`, which requires a cross-origin isolation this deployment
 * cannot have), so the filesystem face is asynchronous end to end.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/protocol
 */

/** The first frame a process worker receives; it also selects its role.
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 protocol 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */
export interface ShellStartFrame {
  t: 'shell-start'
  /** Command source for `bash -c`, or undefined when `argv` names a program directly. */
  script?: string | undefined
  /** The program and arguments, used when `script` is absent. */
  argv: readonly string[]
  /** Working directory the command starts in. */
  cwd: string
  /** Environment the command starts with. */
  env: Record<string, string>
  /** Everything on standard input. */
  stdin: string
}

/** Output produced by the command, forwarded as it is written. */
export interface ShellOutputFrame {
  t: 'shell-out'
  stream: 'stdout' | 'stderr'
  text: string
}

/** The command settled; the process worker closes itself right after. */
export interface ShellExitFrame {
  t: 'shell-exit'
  code: number
}

/** A signal the command is asked to honor (the terminate ladder's first rung). */
export interface ShellSignalFrame {
  t: 'shell-signal'
}

/** Filesystem operations a process worker can ask its host to perform. */
export type FilesystemOperation = 'stat' | 'list' | 'readText' | 'writeText' | 'mkdir' | 'remove' | 'rename'

/** One filesystem call, awaiting its reply by `id`. */
export interface FilesystemCallFrame {
  t: 'fs-call'
  id: number
  op: FilesystemOperation
  args: readonly unknown[]
}

/**
 * One filesystem reply. A failure carries the Node error `code` because the
 * utilities branch on it (`ENOENT` prints "No such file or directory"), and an
 * Error instance does not survive structured cloning with its class.
 */
export interface FilesystemReplyFrame {
  t: 'fs-reply'
  id: number
  value?: unknown
  failure?: { code?: string | undefined; message: string }
}

/** Everything the host sends to a process worker. */
export type ToProcessFrame = ShellStartFrame | ShellSignalFrame | FilesystemReplyFrame

/** Everything a process worker sends to its host. */
export type FromProcessFrame = ShellOutputFrame | ShellExitFrame | FilesystemCallFrame

/**
 * Whether a message is the frame that turns a fresh worker into a shell
 * process. The host worker's entry reads this to pick its role.
 * @param data - the raw message payload.
 * @returns true when the payload starts a shell process.
 * @remarks 中文说明：功能说明：判断是否为 Shell Start Frame 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：data（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：data is
 * ShellStartFrame；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * isShellStartFrame(data)，并按返回类型处理结果。
 */
export function isShellStartFrame(data: unknown): data is ShellStartFrame {
  return typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'shell-start'
}
