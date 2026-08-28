/**
 * The `process` global the worker needs before any VFS module runs. Cordis
 * reads `process.env` and `process.versions.node` while the Loader is
 * constructed, and `cordis.yml` keeps its `!!js process.*` expressions, so the
 * configuration bytes stay identical to the Node deployment. Third-party Node
 * packages use the presence of `process.title` to avoid browser-only globals.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/node/globals/process
 * @remarks 文件说明：文件职责：实现 experimental/webworker-runtime 中 process 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/webworker-runtime 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */
import { requireActiveModuleLoader } from '../../module-system/module-loader.ts'
import { processAlive, signalProcess } from '../process-table.ts'

/** Construction inputs for {@link installProcessGlobal}. */
export interface ProcessShimOptions {
  /** Virtual root reported by `cwd()`. */
  readonly cwd: string
  /** Environment the tree reads; `DSH_HOME` belongs here. */
  readonly env: Readonly<Record<string, string>>
  /** Argument vector reported to the tree. */
  readonly argv?: readonly string[]
}

/** The members this shim publishes. */
/**
 * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
 * @param chunk （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 write(chunk)，并按返回类型处理结果。
 */
/**
 * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
 * @param chunk （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 write(chunk)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 bigint 相关流程；使用场景由所在模块及调用位置决定。
 * @returns bigint；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bigint()，并按返回类型处理结果。
 */
export interface ProcessShim {
  readonly env: Record<string, string>
  readonly argv: string[]
  readonly execArgv: string[]
  /** Node process identity used by dependencies for environment detection. */
  readonly title: string
  /**
   * Node 22 `process.getBuiltinModule`: the worker's module proxy for a
   * builtin id (`fs`, `node:fs`), or undefined for anything else — it never
   * resolves image modules.
   * @param id - Builtin module id, with or without the `node:` prefix.
   * @returns the proxied builtin, or undefined.
   * @remarks 中文说明：功能说明：获取 Builtin Module 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：id（string）：标识本次操作关联的唯一对象；必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getBuiltinModule(id)，并按返回类型处理结果。
   */
  getBuiltinModule(id: string): unknown
  readonly platform: string
  readonly arch: string
  readonly pid: number
  readonly version: string
  readonly versions: Record<string, string>
  /**
   * 功能说明：处理 cwd 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cwd()，并按返回类型处理结果。
   */
  cwd(): string
  /**
   * Signal one command started through the `node:child_process` shim. Signal
   * `0` is the liveness probe the subprocess service polls a process tree
   * with; a negative pid addresses the group, which here holds exactly the one
   * command that leads it.
   * @param pid - the target pid, negative for its group.
   * @param signal - signal name, or `0` to probe without delivering one.
   * @returns true once the signal is recorded.
   * @throws Error with `code: 'ESRCH'` when no such command is running.
   * @remarks 中文说明：功能说明：处理 kill 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：pid（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（NodeJS.Signals | 0）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 kill(pid, signal)，
   * 并按返回类型处理结果。
   */
  kill(pid: number, signal?: NodeJS.Signals | 0): boolean
  /**
   * 功能说明：处理 nextTick 相关流程；使用场景由所在模块及调用位置决定。
   * @param callback （(...args: unknown[]) => void）：接收后续状态或事件并执行调用方逻辑；
   * 必须满足声明的类型及调用时序要求。
   * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 nextTick(callback, args)，并按返回类型处理结果。
   */
  nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]): void
  readonly stdout: { write(chunk: string): boolean }
  readonly stderr: { write(chunk: string): boolean }
  /**
   * 功能说明：响应 on 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 on()，并按返回类型处理结果。
   */
  on(): ProcessShim
  /**
   * 功能说明：处理 off 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 off()，并按返回类型处理结果。
   */
  off(): ProcessShim
  /**
   * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 once()，并按返回类型处理结果。
   */
  once(): ProcessShim
  /**
   * 功能说明：处理 prependListener 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prependListener()，并按返回类型处理结果。
   */
  prependListener(): ProcessShim
  /**
   * 功能说明：处理 prependOnceListener 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 prependOnceListener()，并按返回类型处理结果。
   */
  prependOnceListener(): ProcessShim
  /**
   * 功能说明：移除 Listener 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 removeListener()，并按返回类型处理结果。
   */
  removeListener(): ProcessShim
  /**
   * 功能说明：移除 All Listeners 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 removeAllListeners()，并按返回类型处理结果。
   */
  removeAllListeners(): ProcessShim
  /**
   * 功能说明：处理 listeners 相关流程；使用场景由所在模块及调用位置决定。
   * @returns unknown[]；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listeners()，并按返回类型处理结果。
   */
  listeners(): unknown[]
  /**
   * 功能说明：处理 listenerCount 相关流程；使用场景由所在模块及调用位置决定。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listenerCount()，并按返回类型处理结果。
   */
  listenerCount(): number
  /**
   * 功能说明：设置 Max Listeners 相关流程；使用场景由所在模块及调用位置决定。
   * @returns ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setMaxListeners()，并按返回类型处理结果。
   */
  setMaxListeners(): ProcessShim
  /**
   * 功能说明：发送 emit 相关流程；使用场景由所在模块及调用位置决定。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 emit()，并按返回类型处理结果。
   */
  emit(): boolean
  readonly hrtime: { bigint(): bigint }
  /**
   * 功能说明：处理 uptime 相关流程；使用场景由所在模块及调用位置决定。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 uptime()，并按返回类型处理结果。
   */
  uptime(): number
  /**
   * 功能说明：处理 exit 相关流程；使用场景由所在模块及调用位置决定。
   * @param code （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 exit(code)，并按返回类型处理结果。
   */
  exit(code?: number): void
}

/**
 * Publish `globalThis.process`.
 *
 * `versions.node` is `0.0.0` on purpose: it makes Cordis's
 * `ModuleLoader.fromInternal()` return undefined instead of reaching for Node
 * internals, which is what lets the worker install its own module seam.
 * @param options - Root, environment, and argument vector.
 * @returns The published object, for the module proxy table.
 * @remarks 中文说明：功能说明：处理 installProcessGlobal 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：options（ProcessShimOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：ProcessShim；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installProcessGlobal(options)，并按返回类型处理结果。
 */
export function installProcessGlobal(options: ProcessShimOptions): ProcessShim {
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const start = performance.now()
  /**
   * 常量说明：write 用于写入 write 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：写入 write 相关流程；使用场景由所在模块及调用位置决定。
   * @param target （'log' | 'error'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 write(target)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：chunk（string）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(chunk)，并按返回类型处理结果。
   */
  const write = (target: 'log' | 'error') => (chunk: string): boolean => {
    console[target](chunk.replace(/\n$/, ''))
    return true
  }
  /**
   * 常量说明：shim 用于处理 shim 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：id（string）：标识本次操作关联的唯一对象；
   * 必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(id)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：pid（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；参数：signal（NodeJS.Signals | 0）：传递取消或终止信号；
   * 必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
   * 匿名回调(pid, signal)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：callback（由 TypeScript
   * 根据调用位置推断的类型）：接收后续状态或事件并执行调用方逻辑；必须满足声明的类型及调用时序要求。；参数：args（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(callback, args)，
   * 并按返回类型处理结果。
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
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（number）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(code)，并按返回类型处理结果。
   */
  /**
  * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
  * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
  */
  const shim: ProcessShim = {
    env: { ...options.env },
    argv: [...(options.argv ?? ['node', 'dsh-webworker'])],
    execArgv: [],
    title: 'dsh-webworker',
    platform: 'linux',
    arch: 'x64',
    pid: 1,
    version: 'v0.0.0',
    versions: { node: '0.0.0' },
    cwd: () => options.cwd,
    getBuiltinModule: (id: string): unknown => {
      /**
       * 变量说明：resolution 用于处理 resolution 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let resolution
      try {
        resolution = requireActiveModuleLoader().resolve(id, '/')
      } catch {
        // No loader mounted yet, or an id that resolves nowhere: Node answers
        // undefined for non-builtins instead of throwing.
        return undefined
      }
      return resolution.kind === 'static' ? resolution.factory() : undefined
    },
    kill: (pid: number, signal: NodeJS.Signals | 0 = 'SIGTERM'): boolean => {
      if (signal === 0) {
        if (processAlive(pid)) return true
        /**
         * 常量说明：error 用于处理 error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const error = new Error('kill ESRCH') as NodeJS.ErrnoException
        error.code = 'ESRCH'
        error.syscall = 'kill'
        throw error
      }
      return signalProcess(pid, signal)
    },
    nextTick: (callback, ...args) => { queueMicrotask(() => { callback(...args) }) },
    stdout: { write: write('log') },
    stderr: { write: write('error') },
    on: () => shim,
    off: () => shim,
    once: () => shim,
    prependListener: () => shim,
    prependOnceListener: () => shim,
    removeListener: () => shim,
    removeAllListeners: () => shim,
    listeners: () => [],
    listenerCount: () => 0,
    setMaxListeners: () => shim,
    emit: () => false,
    hrtime: { bigint: () => BigInt(Math.round((performance.now() - start) * 1e6)) },
    uptime: () => (performance.now() - start) / 1000,
    exit: (code?: number) => { console.warn(`webworker process: exit(${String(code ?? 0)}) requested; the worker keeps running`) },
  }
  ;(globalThis as { process?: unknown }).process = shim
  return shim
}
