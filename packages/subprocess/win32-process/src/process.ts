/** Typed Win32 process operations over the shared binding table.
 * @remarks 文件说明：文件职责：实现 subprocess/win32-process 中 process 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subprocess/win32-process 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import koffi from 'koffi'
import * as abi from './abi.ts'
import {
  allocProcessInfo,
  allocPtrSlot,
  allocStartupInfo,
  allocUint32,
  decodeProcessInfo,
  decodePtr,
  decodeUint32,
  encodeStartupInfo,
  isNullPtr,
  throwLastError,
  throwWin32,
} from './ffi.ts'
import type { NativePtr, Win32ProcessBindings } from './ffi.ts'

/**
 * Quote one argument according to CommandLineToArgvW parsing.
 * @param argument - one argv entry.
 * @returns bare or quoted command-line segment.
 * @remarks 中文说明：功能说明：处理 quoteArg 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：argument（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 quoteArg(argument)，
 * 并按返回类型处理结果。
 */
export function quoteArg(argument: string): string {
  if (argument === '') return '""'
  if (!/[\s"]/u.test(argument)) return argument
  /**
   * 变量说明：quoted 用于处理 quoted 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let quoted = '"'
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < argument.length; index++) {
    /**
     * 变量说明：backslashes 用于处理 backslashes 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let backslashes = 0
    while (index < argument.length && argument.charAt(index) === '\\') {
      backslashes += 1
      index += 1
    }
    if (index === argument.length) {
      quoted += '\\'.repeat(backslashes * 2)
    } else if (argument.charAt(index) === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      quoted += '\\'.repeat(backslashes) + argument.charAt(index)
    }
  }
  return quoted + '"'
}

/**
 * Build the mutable command line accepted by CreateProcessAsUserW.
 * @param program - executable argv entry.
 * @param args - remaining argv entries.
 * @returns joined Win32 command line.
 * @remarks 中文说明：功能说明：构建 Command Line 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：program（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：args（readonly
 * string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 buildCommandLine(program, args)，
 * 并按返回类型处理结果。
 */
export function buildCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args].map(quoteArg).join(' ')
}

/** Restricted-token process creation inputs owned by the Windows ACL sandbox. */
export interface RestrictedProcessSpawnOptions {
  /** Executable argv entry passed through CreateProcessAsUserW. */
  command: string
  /** Arguments excluding the executable. */
  args: readonly string[]
  /** Existing child working directory. */
  cwd: string
  /** Restricted primary token supplied by sandbox policy. */
  token: NativePtr
}

/** Piped child resources whose process and read handles remain caller-owned. */
export interface SpawnedPipedProcess {
  /** Direct child process id. */
  pid: number
  /** Process handle closed by waitForProcessExit. */
  process: NativePtr
  /** Stdout pipe read end closed by drainPipe. */
  stdoutRead: NativePtr
  /** Stderr pipe read end closed by drainPipe. */
  stderrRead: NativePtr
}

/** Suspended child assigned to one caller-owned kill-on-close Job before resume. */
export interface SpawnedJobProcess {
  /** Direct child process id. */
  pid: number
  /** Process handle closed by waitForProcessExit. */
  process: NativePtr
  /** Job handle closed by the lifecycle owner. */
  job: NativePtr
}

interface PipePair {
  read: NativePtr
  write: NativePtr
}

/**
 * 功能说明：处理 freeNative 相关流程；使用场景由所在模块及调用位置决定。
 * @param pointer （NativePtr | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 freeNative(pointer)，并按返回类型处理结果。
 */
function freeNative(pointer: NativePtr | undefined): void {
  if (pointer !== undefined) koffi.free(pointer)
}

/**
 * 功能说明：关闭 Best Effort 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param handle （NativePtr | null | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeBestEffort(api, handle)，并按返回类型处理结果。
 */
function closeBestEffort(api: Win32ProcessBindings, handle: NativePtr | null | undefined): void {
  if (!isNullPtr(handle)) api.closeHandle(handle)
}

/**
 * 功能说明：创建 Pipe 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param owned （Set<NativePtr>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns PipePair；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createPipe(api, owned)，并按返回类型处理结果。
 */
function createPipe(api: Win32ProcessBindings, owned: Set<NativePtr>): PipePair {
  /**
   * 常量说明：readSlot 用于读取 Slot 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const readSlot = allocPtrSlot()
  /**
   * 变量说明：writeSlot 用于写入 Slot 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let writeSlot: NativePtr | undefined
  try {
    writeSlot = allocPtrSlot()
    if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, 'CreatePipe')
    /**
     * 常量说明：read 用于读取 read 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const read = decodePtr(readSlot)
    /**
     * 常量说明：write 用于写入 write 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const write = decodePtr(writeSlot)
    if (read === null || write === null) {
      closeBestEffort(api, read)
      closeBestEffort(api, write)
      throwLastError(api, 'CreatePipe', 'null pipe handle')
    }
    owned.add(read)
    owned.add(write)
    return { read, write }
  } finally {
    freeNative(writeSlot)
    koffi.free(readSlot)
  }
}

/**
 * 功能说明：关闭 Owned 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param owned （Set<NativePtr>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param handle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeOwned(api, owned, handle)，并按返回类型处理结果。
 */
function closeOwned(api: Win32ProcessBindings, owned: Set<NativePtr>, handle: NativePtr): void {
  /* v8 ignore next -- each successfully decoded pipe end is uniquely owned. */
  if (!owned.delete(handle)) return
  api.closeHandle(handle)
}

/**
 * 功能说明：关闭 All Owned 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param owned （Set<NativePtr>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeAllOwned(api, owned)，并按返回类型处理结果。
 */
function closeAllOwned(api: Win32ProcessBindings, owned: Set<NativePtr>): void {
  /**
   * 变量说明：handle 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const handle of owned) api.closeHandle(handle)
  owned.clear()
}

/**
 * 功能说明：创建 Restricted Process 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param options （RestrictedProcessSpawnOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。
 * @param commandLine （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param creationFlags （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param startupInfo （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param processInfo （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createRestrictedProcess(api, options, commandLine,
 * creationFlags, startupInfo, processInfo)，并按返回类型处理结果。
 */
function createRestrictedProcess(
  api: Win32ProcessBindings,
  options: RestrictedProcessSpawnOptions,
  commandLine: string,
  creationFlags: number,
  startupInfo: NativePtr,
  processInfo: NativePtr,
): number {
  // The sandbox mutates its process environment before this call. Passing an
  // explicit block through Koffi makes CreateProcessAsUserW reject the request
  // with ERROR_INVALID_PARAMETER, so lpEnvironment remains NULL.
  return api.createProcessAsUserW(
    options.token,
    null,
    commandLine,
    null,
    null,
    1,
    creationFlags,
    null,
    options.cwd,
    startupInfo,
    processInfo,
  )
}

/**
 * Spawn a process with anonymous-pipe stdout/stderr and immediate stdin EOF.
 * @param api - active binding table.
 * @param options - command, cwd, args, and restricted primary token.
 * @returns caller-owned process and pipe read handles.
 * @remarks 中文说明：功能说明：处理 spawnPipedProcess 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（RestrictedProcessSpawnOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：SpawnedPipedProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 spawnPipedProcess(api, options)，并按返回类型处理结果。
 */
export function spawnPipedProcess(
  api: Win32ProcessBindings,
  options: RestrictedProcessSpawnOptions,
): SpawnedPipedProcess {
  /**
   * 常量说明：owned 用于处理 owned 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const owned = new Set<NativePtr>()
  /**
   * 变量说明：startupInfo 用于处理 startupInfo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let startupInfo: NativePtr | undefined
  /**
   * 变量说明：processInfo 用于处理 processInfo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let processInfo: NativePtr | undefined
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 常量说明：stdIn 用于处理 stdIn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stdIn = createPipe(api, owned)
    /**
     * 常量说明：stdOut 用于处理 stdOut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stdOut = createPipe(api, owned)
    /**
     * 常量说明：stdErr 用于处理 stdErr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const stdErr = createPipe(api, owned)
    /**
     * 变量说明：handle、label 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [handle, label] of [
      [stdIn.read, 'stdin read end'],
      [stdOut.write, 'stdout write end'],
      [stdErr.write, 'stderr write end'],
    ] as const) {
      if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, 'SetHandleInformation', label)
      }
    }
    startupInfo = allocStartupInfo()
    encodeStartupInfo(startupInfo, {
      cb: abi.STARTUPINFOW_SIZE,
      dwFlags: abi.STARTF_USESTDHANDLES,
      hStdInput: stdIn.read,
      hStdOutput: stdOut.write,
      hStdError: stdErr.write,
    })
    processInfo = allocProcessInfo()
    /**
     * 常量说明：created 用于处理 created 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const created = createRestrictedProcess(
      api,
      options,
      buildCommandLine(options.command, options.args),
      0,
      startupInfo,
      processInfo,
    )
    if (created === 0) {
      /**
       * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const win32Code = api.getLastError()
      throwWin32(api, 'CreateProcessAsUserW', win32Code, `command: ${options.command}, cwd: ${options.cwd}`)
    }
    /**
     * 常量说明：info 用于处理 info 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const info = decodeProcessInfo(processInfo)
    if (info.hProcess === null || info.hThread === null) {
      if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1)
      closeBestEffort(api, info.hThread)
      closeBestEffort(api, info.hProcess)
      throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`)
    }
    closeOwned(api, owned, stdIn.read)
    closeOwned(api, owned, stdIn.write)
    closeOwned(api, owned, stdOut.write)
    closeOwned(api, owned, stdErr.write)
    closeBestEffort(api, info.hThread)
    owned.delete(stdOut.read)
    owned.delete(stdErr.read)
    return {
      pid: info.dwProcessId,
      process: info.hProcess,
      stdoutRead: stdOut.read,
      stderrRead: stdErr.read,
    }
  } catch (error) {
    closeAllOwned(api, owned)
    throw error
  } finally {
    freeNative(processInfo)
    freeNative(startupInfo)
  }
}

/**
 * Drain one anonymous pipe until the writer closes it.
 * @param api - active binding table.
 * @param handle - caller-owned pipe read end.
 * @returns complete bytes read before EOF; the handle is always closed.
 * @throws when a Win32 pipe operation fails.
 * @remarks 中文说明：功能说明：处理 drainPipe 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：handle（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<Buffer>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 drainPipe(api, handle)，
 * 并按返回类型处理结果。
 */
export async function drainPipe(
  api: Win32ProcessBindings,
  handle: NativePtr,
): Promise<Buffer> {
  /**
   * 常量说明：chunks 用于处理 chunks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const chunks: Buffer[] = []
  /**
   * 变量说明：countSlot 用于处理 countSlot 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let countSlot: NativePtr | undefined
  try {
    countSlot = allocUint32()
    for (;;) {
      /**
       * 常量说明：peeked 用于处理 peeked 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const peeked = api.peekNamedPipe(handle, null, 0, null, countSlot, null)
      if (peeked === 0) {
        /**
         * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const win32Code = api.getLastError()
        if (win32Code === abi.ERROR_BROKEN_PIPE || win32Code === abi.ERROR_NO_DATA) break
        throwLastError(api, 'PeekNamedPipe', `drain failure after ${chunks.length} chunk(s)`)
      }
      /**
       * 常量说明：available 用于处理 available 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const available = decodeUint32(countSlot)
      if (available > 0) {
        /**
         * 常量说明：chunk 用于处理 chunk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const chunk = Buffer.alloc(available)
        if (api.readFile(handle, chunk, chunk.length, countSlot, null) === 0) {
          throwLastError(api, 'ReadFile', `drain failure after ${chunks.length} chunk(s)`)
        }
        chunks.push(chunk.subarray(0, decodeUint32(countSlot)))
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
       */
      await new Promise<void>(resolve => setTimeout(resolve, 1))
    }
    return Buffer.concat(chunks)
  } finally {
    freeNative(countSlot)
    api.closeHandle(handle)
  }
}

/**
 * Wait for a process and always close its handle.
 * @param api - active binding table.
 * @param process - caller-owned process handle.
 * @returns direct process exit code.
 * @remarks 中文说明：功能说明：处理 waitForProcessExit 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：process（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 waitForProcessExit(api,
 * process)，并按返回类型处理结果。
 */
export function waitForProcessExit(api: Win32ProcessBindings, process: NativePtr): number {
  /**
   * 变量说明：exitCodeSlot 用于处理 exitCodeSlot 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let exitCodeSlot: NativePtr | undefined
  try {
    if (api.waitForSingleObject(process, abi.INFINITE) === 0xFFFFFFFF) {
      throwLastError(api, 'WaitForSingleObject')
    }
    exitCodeSlot = allocUint32()
    if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, 'GetExitCodeProcess')
    return decodeUint32(exitCodeSlot)
  } finally {
    freeNative(exitCodeSlot)
    api.closeHandle(process)
  }
}

/**
 * 功能说明：创建 Kill On Close Job 相关流程；使用场景由所在模块及调用位置决定。
 * @param api （Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 createKillOnCloseJob(api)，并按返回类型处理结果。
 */
function createKillOnCloseJob(api: Win32ProcessBindings): NativePtr {
  /**
   * 常量说明：job 用于处理 job 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const job = api.createJobObjectW(null, null)
  if (isNullPtr(job)) throwLastError(api, 'CreateJobObjectW')
  /**
   * 常量说明：information 用于处理 information 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const information = Buffer.alloc(abi.JOBOBJECT_EXTENDED_LIMIT_SIZE)
  information.writeUInt32LE(
    abi.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    abi.JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET,
  )
  if (api.setInformationJobObject(
    job,
    abi.JobObjectExtendedLimitInformation,
    information,
    information.length,
  ) === 0) {
    /**
     * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const win32Code = api.getLastError()
    api.closeHandle(job)
    throwWin32(api, 'SetInformationJobObject', win32Code)
  }
  return job
}

/**
 * Spawn suspended, assign the child to a kill-on-close Job, then resume it.
 * @param api - active binding table.
 * @param options - command, cwd, args, and restricted primary token.
 * @returns caller-owned process and Job handles after successful resume.
 * @remarks Node clears stdio handle inheritability at startup through
 * uv_disable_stdio_inheritance. This operation temporarily restores the bits
 * required by STARTF_USESTDHANDLES. Restoring them afterward is best-effort:
 * failure must not replace the already-created child's outcome.
 * @remarks 中文说明：功能说明：处理 spawnInheritedJobProcess 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：options（RestrictedProcessSpawnOptions）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。；返回值：SpawnedJobProcess；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 spawnInheritedJobProcess(api, options)，并按返回类型处理结果。
 */
export function spawnInheritedJobProcess(
  api: Win32ProcessBindings,
  options: RestrictedProcessSpawnOptions,
): SpawnedJobProcess {
  /**
   * 常量说明：job 用于处理 job 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const job = createKillOnCloseJob(api)
  /**
   * 常量说明：getStdHandle 用于获取 Std Handle 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：获取 Std Handle 相关流程；使用场景由所在模块及调用位置决定。
   * @param selector （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param label （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getStdHandle(selector, label)，并按返回类型处理结果。
   */
  const getStdHandle = (selector: number, label: string): NativePtr => {
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = api.getStdHandle(selector)
    if (!isNullPtr(handle)) return handle
    /**
     * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const win32Code = api.getLastError()
    api.closeHandle(job)
    throwWin32(api, 'GetStdHandle', win32Code, `null ${label} handle`)
  }
  /**
   * 常量说明：stdIn 用于处理 stdIn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdIn = getStdHandle(abi.STD_INPUT_HANDLE, 'stdin')
  /**
   * 常量说明：stdOut 用于处理 stdOut 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdOut = getStdHandle(abi.STD_OUTPUT_HANDLE, 'stdout')
  /**
   * 常量说明：stdErr 用于处理 stdErr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const stdErr = getStdHandle(abi.STD_ERROR_HANDLE, 'stderr')
  /**
   * 常量说明：enabled 用于处理 enabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const enabled: NativePtr[] = []
  /**
   * 变量说明：startupInfo 用于处理 startupInfo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let startupInfo: NativePtr | undefined
  /**
   * 变量说明：processInfo 用于处理 processInfo 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let processInfo: NativePtr | undefined
  /**
   * 变量说明：created 用于处理 created 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let created = 0
  /**
   * 变量说明：createFailureCode 用于创建 Failure Code 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let createFailureCode = 0
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    /**
     * 变量说明：handle、label 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [handle, label] of [
      [stdIn, 'stdin'],
      [stdOut, 'stdout'],
      [stdErr, 'stderr'],
    ] as const) {
      if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
        throwLastError(api, 'SetHandleInformation', `${label} (enable inherit)`)
      }
      enabled.push(handle)
    }
    startupInfo = allocStartupInfo()
    encodeStartupInfo(startupInfo, {
      cb: abi.STARTUPINFOW_SIZE,
      dwFlags: abi.STARTF_USESTDHANDLES,
      hStdInput: stdIn,
      hStdOutput: stdOut,
      hStdError: stdErr,
    })
    processInfo = allocProcessInfo()
    created = createRestrictedProcess(
      api,
      options,
      buildCommandLine(options.command, options.args),
      abi.CREATE_SUSPENDED,
      startupInfo,
      processInfo,
    )
    if (created === 0) createFailureCode = api.getLastError()
  } catch (error) {
    freeNative(processInfo)
    api.closeHandle(job)
    throw error
  } finally {
    freeNative(startupInfo)
    /**
     * 变量说明：handle 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const handle of enabled) {
      // The runner spawns nothing else; cleanup failure must not mask the child.
      api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, 0)
    }
  }
  if (created === 0) {
    freeNative(processInfo)
    api.closeHandle(job)
    throwWin32(
      api,
      'CreateProcessAsUserW',
      createFailureCode,
      `command: ${options.command}, cwd: ${options.cwd}`,
    )
  }
  /**
   * 变量说明：info 用于处理 info 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let info: ReturnType<typeof decodeProcessInfo>
  try {
    info = decodeProcessInfo(processInfo)
  } finally {
    freeNative(processInfo)
  }
  if (info.hProcess === null || info.hThread === null) {
    if (info.hProcess !== null) api.terminateProcess(info.hProcess, 1)
    api.closeHandle(job)
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`)
  }
  if (api.assignProcessToJobObject(job, info.hProcess) === 0) {
    /**
     * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const win32Code = api.getLastError()
    api.terminateProcess(info.hProcess, 1)
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    api.closeHandle(job)
    throwWin32(api, 'AssignProcessToJobObject', win32Code, `pid ${info.dwProcessId}`)
  }
  if (api.resumeThread(info.hThread) === 0xFFFFFFFF) {
    /**
     * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const win32Code = api.getLastError()
    closeBestEffort(api, info.hThread)
    closeBestEffort(api, info.hProcess)
    api.closeHandle(job)
    throwWin32(api, 'ResumeThread', win32Code, `pid ${info.dwProcessId}`)
  }
  closeBestEffort(api, info.hThread)
  return { pid: info.dwProcessId, process: info.hProcess, job }
}
