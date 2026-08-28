/**
 * The process worker's own half: a fresh worker that received a
 * {@link ShellStartFrame} runs one command here and then closes.
 *
 * It mounts no VFS image, boots no Cordis tree, and loads no plugins — the
 * only thing it shares with the host worker is the bundle it was started from.
 * Its filesystem is the host's, reached by message.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/shell/process/child
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 child 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import { runShellCommand, runShellProgram } from '../interpret.ts'
import { filesystemError } from '../fs-access.ts'
import type { ShellDirent, ShellFileSystem, ShellStats } from '../types.ts'
import type { FilesystemOperation, FromProcessFrame, ShellStartFrame, ToProcessFrame } from './protocol.ts'

/** The messaging face this module needs from a worker scope. */
export interface ProcessScope {
  /**
   * 功能说明：处理 postMessage 相关流程；使用场景由所在模块及调用位置决定。
   * @param frame （FromProcessFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 postMessage(frame)，并按返回类型处理结果。
   */
  postMessage(frame: FromProcessFrame): void
  /**
   * 功能说明：处理 addEventListener 相关流程；使用场景由所在模块及调用位置决定。
   * @param type （'message'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param listener （(event: MessageEvent) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 addEventListener(type, listener)，并按返回类型处理结果。
   */
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  /**
   * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 close()，并按返回类型处理结果。
   */
  close(): void
}

/**
 * Run one command as this worker's whole purpose, then close.
 *
 * Output is forwarded as it is written, so a caller reading a background job
 * sees progress before the command settles.
 * @param start - the frame that named the command, its directory, and its input.
 * @param scope - the worker scope to message through (`self`).
 * @remarks 中文说明：功能说明：执行 Shell Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：start（ShellStartFrame）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：scope（ProcessScope）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 runShellProcess(start,
 * scope)，并按返回类型处理结果。
 */
export function runShellProcess(start: ShellStartFrame, scope: ProcessScope): void {
  /**
   * 常量说明：pending 用于处理 pending 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const pending = new Map<number, { settle: (value: unknown) => void; fail: (error: unknown) => void }>()
  /**
   * 常量说明：stopping 用于处理 stopping 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stopping = new AbortController()
  /**
   * 变量说明：nextCall 用于处理 nextCall 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let nextCall = 0

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（MessageEvent）：提供需要处理或投影的事件数
   * 据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  scope.addEventListener('message', (event: MessageEvent) => {
    /**
     * 常量说明：frame 用于处理 frame 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const frame = event.data as ToProcessFrame
    if (frame.t === 'shell-signal') {
      // The host's first termination rung: the command stops at its next
      // command boundary. A command that ignores it gets terminated instead.
      stopping.abort(new Error('killed by signal'))
      return
    }
    if (frame.t !== 'fs-reply') return
    /**
     * 常量说明：waiting 用于处理 waiting 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const waiting = pending.get(frame.id)
    if (waiting === undefined) return
    pending.delete(frame.id)
    if (frame.failure === undefined) waiting.settle(frame.value)
    else waiting.fail(filesystemError(frame.failure.code ?? 'EIO', 'fs', frame.failure.message))
  })

  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 call 相关流程；使用场景由所在模块及调用位置决定。
   * @param op （FilesystemOperation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param args （readonly unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 call(op, args)，并按返回类型处理结果。
   */
  const call = async (op: FilesystemOperation, args: readonly unknown[]): Promise<unknown> => {
    nextCall += 1
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = nextCall
    /**
     * 常量说明：reply 用于处理 reply 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：settle（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：fail（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(settle, fail)，并按返回类型处理结果。
     */
    const reply = new Promise<unknown>((settle, fail) => { pending.set(id, { settle, fail }) })
    scope.postMessage({ t: 'fs-call', id, op, args })
    return await reply
  }

  /**
   * 常量说明：fs 用于处理 fs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(path)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：text（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数：append（由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
   * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(path, text, append)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：recursive（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(path, recursive)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：path（string）：指定要读取、写入或匹配的文件位置；
   * 必须满足声明的类型及调用时序要求。；参数：options（{ recursive: boolean; force: boolean
   * }）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(path, options)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：from（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：to（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
   * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(from, to)，并按返回类型处理结果。
   */
  const fs: ShellFileSystem = {
    stat: async (path: string) => await call('stat', [path]) as ShellStats | undefined,
    list: async (path: string) => await call('list', [path]) as ShellDirent[],
    readText: async (path: string) => await call('readText', [path]) as string,
    writeText: async (path: string, text: string, append = false) => { await call('writeText', [path, text, append]) },
    mkdir: async (path: string, recursive: boolean) => { await call('mkdir', [path, recursive]) },
    remove: async (path: string, options: { recursive: boolean; force: boolean }) => { await call('remove', [path, options]) },
    rename: async (from: string, to: string) => { await call('rename', [from, to]) },
  }

  /**
   * 常量说明：options 用于处理 options 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：stream（'stdout' |
   * 'stderr'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：text（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(stream, text)，并按返回类型处理结果。
   */
  const options = {
    cwd: start.cwd,
    env: start.env,
    stdin: start.stdin,
    signal: stopping.signal,
    fs,
    onOutput: (stream: 'stdout' | 'stderr', text: string) => { scope.postMessage({ t: 'shell-out', stream, text }) },
  }
  /**
   * 常量说明：run 用于执行 run 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const run = start.script === undefined
    ? runShellProgram(start.argv, options)
    : runShellCommand(start.script, options)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：outcome（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(outcome)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
   */
  void run.then(
    (outcome) => {
      scope.postMessage({ t: 'shell-exit', code: outcome.exitCode })
      scope.close()
    },
    (error: unknown) => {
      // The interpreter contains its own failures; reaching here means the
      // shell machinery itself broke, which the host reports as a failed spawn.
      scope.postMessage({ t: 'shell-out', stream: 'stderr', text: `bash: ${String(error)}\n` })
      scope.postMessage({ t: 'shell-exit', code: 1 })
      scope.close()
    },
  )
}
