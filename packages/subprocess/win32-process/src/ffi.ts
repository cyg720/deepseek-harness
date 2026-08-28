/** Lazy Koffi bindings for generic Win32 process, stdio, and Job operations.
 * @remarks 文件说明：文件职责：实现 subprocess/win32-process 中 ffi 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * subprocess/win32-process 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import koffi from 'koffi'
import * as abi from './abi.ts'
import { Win32Error } from './errors.ts'

/**
 * 常量说明：nativePtr 用于处理 nativePtr 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
declare const nativePtr: unique symbol
/** Koffi native pointer branded against accidental numeric use. */
export type NativePtr = bigint & { readonly [nativePtr]: true }

type Ptr = ReturnType<typeof koffi.pointer>
/**
 * 常量说明：PVOID 用于处理 PVOID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PVOID: Ptr = koffi.pointer('void')
/**
 * 常量说明：PPVOID 用于处理 PPVOID 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const PPVOID: Ptr = koffi.pointer(PVOID)

/** Loaded Win32 libraries and the shared stdcall binder used by process extensions. */
export interface Win32BindingContext {
  /** Kernel process, handle, pipe, and Job APIs. */
  readonly kernel32: ReturnType<typeof koffi.load>
  /** Token and security APIs. */
  readonly advapi32: ReturnType<typeof koffi.load>
  /** Bind one stdcall function from a loaded Win32 library. */
  readonly bind: (
    library: ReturnType<typeof koffi.load>,
    name: string,
    result: Ptr | string,
    args: Array<Ptr | string>,
  ) => unknown
}

/**
 * Return whether a Koffi pointer represents NULL.
 * @param value - pointer value returned by Koffi or a Win32 call.
 * @returns true for null, undefined, or address zero.
 * @remarks 中文说明：功能说明：判断是否为 Null Ptr 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（NativePtr | null | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：value is null | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 isNullPtr(value)，并按返回类型处理结果。
 */
export function isNullPtr(value: NativePtr | null | undefined): value is null | undefined {
  return value === null || value === undefined || (value as bigint) === 0n
}

/** STARTUPINFOW fields used by inherited or piped stdio launches. */
export interface StartupInfoInput {
  cb: number
  dwFlags: number
  hStdInput: NativePtr
  hStdOutput: NativePtr
  hStdError: NativePtr
}

/** Decoded PROCESS_INFORMATION result. */
export interface ProcessInfoOutput {
  hProcess: NativePtr | null
  hThread: NativePtr | null
  dwProcessId: number
  dwThreadId: number
}

/** Generic Win32 calls consumed by restricted-token sandbox process operations. */
export interface Win32ProcessBindings {
  /**
   * 功能说明：关闭 Handle 相关流程；使用场景由所在模块及调用位置决定。
   * @param handle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 closeHandle(handle)，并按返回类型处理结果。
   */
  closeHandle(handle: NativePtr): number
  /**
   * 功能说明：获取 Last Error 相关流程；使用场景由所在模块及调用位置决定。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getLastError()，并按返回类型处理结果。
   */
  getLastError(): number
  /**
   * 功能说明：格式化 Message W 相关流程；使用场景由所在模块及调用位置决定。
   * @param flags （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param source （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param messageId （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param languageId （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param buffer （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param args （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 formatMessageW(flags, source, messageId, languageId,
   * buffer, size, args)，并按返回类型处理结果。
   */
  formatMessageW(
    flags: number,
    source: null,
    messageId: number,
    languageId: number,
    buffer: Buffer,
    size: number,
    args: null,
  ): number
  /**
   * 功能说明：创建 Pipe 相关流程；使用场景由所在模块及调用位置决定。
   * @param readHandle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param writeHandle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param attributes （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createPipe(readHandle, writeHandle, attributes,
   * size)，并按返回类型处理结果。
   */
  createPipe(readHandle: NativePtr, writeHandle: NativePtr, attributes: null, size: number): number
  /**
   * 功能说明：设置 Handle Information 相关流程；使用场景由所在模块及调用位置决定。
   * @param handle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param mask （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param flags （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setHandleInformation(handle, mask, flags)，并按返回类型处理结果。
   */
  setHandleInformation(handle: NativePtr, mask: number, flags: number): number
  /**
   * 功能说明：创建 Process As User W 相关流程；使用场景由所在模块及调用位置决定。
   * @param token （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param applicationName （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param commandLine （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param processAttributes （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param threadAttributes （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param inheritHandles （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param creationFlags （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param environment （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param currentDirectory （string | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param startupInfo （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param processInfo （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createProcessAsUserW(token, applicationName,
   * commandLine, processAttributes, threadAttributes, inheritHandles,
   * creationFlags, environment, currentDirectory, startupInfo, processInfo)，
   * 并按返回类型处理结果。
   */
  createProcessAsUserW(
    token: NativePtr,
    applicationName: null,
    commandLine: string,
    processAttributes: null,
    threadAttributes: null,
    inheritHandles: number,
    creationFlags: number,
    environment: null,
    currentDirectory: string | null,
    startupInfo: NativePtr,
    processInfo: NativePtr,
  ): number
  /**
   * 功能说明：读取 File 相关流程；使用场景由所在模块及调用位置决定。
   * @param file （NativePtr）：指定要读取、写入或匹配的文件位置；必须满足声明的类型及调用时序要求。
   * @param buffer （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param count （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param bytesRead （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param overlapped （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 readFile(file, buffer, count, bytesRead, overlapped)，
   * 并按返回类型处理结果。
   */
  readFile(file: NativePtr, buffer: Buffer, count: number, bytesRead: NativePtr, overlapped: null): number
  /**
   * 功能说明：处理 peekNamedPipe 相关流程；使用场景由所在模块及调用位置决定。
   * @param pipe （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param buffer （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param size （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param bytesRead （NativePtr | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param totalAvail （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param leftThisMessage （NativePtr | null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 peekNamedPipe(pipe, buffer, size, bytesRead,
   * totalAvail, leftThisMessage)，并按返回类型处理结果。
   */
  peekNamedPipe(
    pipe: NativePtr,
    buffer: null,
    size: number,
    bytesRead: NativePtr | null,
    totalAvail: NativePtr,
    leftThisMessage: NativePtr | null,
  ): number
  /**
   * 功能说明：处理 waitForSingleObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param handle （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param milliseconds （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 waitForSingleObject(handle, milliseconds)，并按返回类型处理结果。
   */
  waitForSingleObject(handle: NativePtr, milliseconds: number): number
  /**
   * 功能说明：获取 Exit Code Process 相关流程；使用场景由所在模块及调用位置决定。
   * @param process （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param exitCode （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getExitCodeProcess(process, exitCode)，并按返回类型处理结果。
   */
  getExitCodeProcess(process: NativePtr, exitCode: NativePtr): number
  /**
   * 功能说明：创建 Job Object W 相关流程；使用场景由所在模块及调用位置决定。
   * @param attributes （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param name （null）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createJobObjectW(attributes, name)，并按返回类型处理结果。
   */
  createJobObjectW(attributes: null, name: null): NativePtr
  /**
   * 功能说明：设置 Information Job Object 相关流程；使用场景由所在模块及调用位置决定。
   * @param job （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param cls （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param information （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param length （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 setInformationJobObject(job, cls, information,
   * length)，并按返回类型处理结果。
   */
  setInformationJobObject(job: NativePtr, cls: number, information: Buffer, length: number): number
  /**
   * 功能说明：处理 assignProcessToJobObject 相关流程；使用场景由所在模块及调用位置决定。
   * @param job （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param process （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assignProcessToJobObject(job, process)，并按返回类型处理结果。
   */
  assignProcessToJobObject(job: NativePtr, process: NativePtr): number
  /**
   * 功能说明：处理 resumeThread 相关流程；使用场景由所在模块及调用位置决定。
   * @param thread （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resumeThread(thread)，并按返回类型处理结果。
   */
  resumeThread(thread: NativePtr): number
  /**
   * 功能说明：处理 terminateProcess 相关流程；使用场景由所在模块及调用位置决定。
   * @param process （NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param exitCode （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 terminateProcess(process, exitCode)，并按返回类型处理结果。
   */
  terminateProcess(process: NativePtr, exitCode: number): number
  /**
   * 功能说明：获取 Std Handle 相关流程；使用场景由所在模块及调用位置决定。
   * @param stdHandle （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 getStdHandle(stdHandle)，并按返回类型处理结果。
   */
  getStdHandle(stdHandle: number): NativePtr
}

/** Koffi STARTUPINFOW layout.
 * @remarks 中文说明：常量说明：STARTUPINFOW 用于处理 STARTUPINFOW 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const STARTUPINFOW = koffi.struct('DSH_STARTUPINFOW', {
  cb: 'uint32',
  lpReserved: 'str16',
  lpDesktop: 'str16',
  lpTitle: 'str16',
  dwX: 'uint32',
  dwY: 'uint32',
  dwXSize: 'uint32',
  dwYSize: 'uint32',
  dwXCountChars: 'uint32',
  dwYCountChars: 'uint32',
  dwFillAttribute: 'uint32',
  dwFlags: 'uint32',
  wShowWindow: 'uint16',
  cbReserved2: 'uint16',
  lpReserved2: koffi.pointer('uint8'),
  hStdInput: PVOID,
  hStdOutput: PVOID,
  hStdError: PVOID,
})

/** Koffi PROCESS_INFORMATION layout.
 * @remarks 中文说明：常量说明：PROCESS_INFORMATION 用于处理 PROCESS_INFORMATION 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const PROCESS_INFORMATION = koffi.struct('DSH_PROCESS_INFORMATION', {
  hProcess: PVOID,
  hThread: PVOID,
  dwProcessId: 'uint32',
  dwThreadId: 'uint32',
})

/* v8 ignore start -- ABI guards are pinned by native header probes. */
if (STARTUPINFOW.size !== abi.STARTUPINFOW_SIZE) {
  throw new Error(`STARTUPINFOW layout mismatch: koffi computed ${STARTUPINFOW.size}, expected ${abi.STARTUPINFOW_SIZE}`)
}
if (PROCESS_INFORMATION.size !== abi.PROCESS_INFORMATION_SIZE) {
  throw new Error(`PROCESS_INFORMATION layout mismatch: koffi computed ${PROCESS_INFORMATION.size}, expected ${abi.PROCESS_INFORMATION_SIZE}`)
}
/* v8 ignore stop */

/**
 * Allocate a pointer-sized out-parameter slot.
 * @returns allocated native slot.
 * @remarks 中文说明：功能说明：处理 allocPtrSlot 相关流程；使用场景由所在模块及调用位置决定。；返回值：NativePtr；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 allocPtrSlot()，并按返回类型处理结果。
 */
export function allocPtrSlot(): NativePtr {
  return koffi.alloc(PVOID, 1) as NativePtr
}

/**
 * Allocate a uint32 out-parameter slot.
 * @returns allocated native slot.
 * @remarks 中文说明：功能说明：处理 allocUint32 相关流程；使用场景由所在模块及调用位置决定。；返回值：NativePtr；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 allocUint32()，并按返回类型处理结果。
 */
export function allocUint32(): NativePtr {
  return koffi.alloc('uint32', 1) as NativePtr
}

/**
 * Decode a pointer out-parameter.
 * @param slot - pointer-sized slot filled by Win32.
 * @returns decoded pointer, or null for address zero.
 * @remarks 中文说明：功能说明：解码 Ptr 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：slot（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：NativePtr | null；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 decodePtr(slot)，
 * 并按返回类型处理结果。
 */
export function decodePtr(slot: NativePtr): NativePtr | null {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = koffi.decode(slot, PVOID) as NativePtr | null
  return isNullPtr(value) ? null : value
}

/**
 * Decode a uint32 out-parameter.
 * @param slot - uint32 slot filled by Win32.
 * @returns decoded unsigned value.
 * @remarks 中文说明：功能说明：解码 Uint32 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：slot（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：number；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 decodeUint32(slot)，
 * 并按返回类型处理结果。
 */
export function decodeUint32(slot: NativePtr): number {
  return koffi.decode(slot, 'uint32') as number
}

/**
 * Allocate a zeroed STARTUPINFOW.
 * @returns allocated struct pointer.
 * @remarks 中文说明：功能说明：处理 allocStartupInfo 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * allocStartupInfo()，并按返回类型处理结果。
 */
export function allocStartupInfo(): NativePtr {
  return koffi.alloc(STARTUPINFOW, 1) as NativePtr
}

/**
 * Encode the stdio-bearing STARTUPINFOW fields.
 * @param startupInfo - allocated STARTUPINFOW pointer.
 * @param fields - fields required for inherited stdio.
 * @remarks 中文说明：功能说明：编码 Startup Info 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：startupInfo（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：fields（StartupInfoInput）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * encodeStartupInfo(startupInfo, fields)，并按返回类型处理结果。
 */
export function encodeStartupInfo(startupInfo: NativePtr, fields: StartupInfoInput): void {
  koffi.encode(startupInfo, STARTUPINFOW, fields)
}

/**
 * Allocate a zeroed PROCESS_INFORMATION.
 * @returns allocated struct pointer.
 * @remarks 中文说明：功能说明：处理 allocProcessInfo 相关流程；使用场景由所在模块及调用位置决定。；
 * 返回值：NativePtr；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * allocProcessInfo()，并按返回类型处理结果。
 */
export function allocProcessInfo(): NativePtr {
  return koffi.alloc(PROCESS_INFORMATION, 1) as NativePtr
}

/**
 * Decode PROCESS_INFORMATION.
 * @param processInfo - struct pointer filled by CreateProcess.
 * @returns process/thread handles and ids.
 * @remarks 中文说明：功能说明：解码 Process Info 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：processInfo（NativePtr）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ProcessInfoOutput；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * decodeProcessInfo(processInfo)，并按返回类型处理结果。
 */
export function decodeProcessInfo(processInfo: NativePtr): ProcessInfoOutput {
  return koffi.decode(processInfo, PROCESS_INFORMATION) as ProcessInfoOutput
}

/**
 * 变量说明：cachedContext 用于处理 cachedContext 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let cachedContext: Win32BindingContext | undefined
/**
 * 变量说明：cached 用于处理 cached 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let cached: Win32ProcessBindings | undefined

/* v8 ignore start -- exercised by native Windows ABI and sandbox jobs. */
/**
 * 功能说明：处理 bindingContext 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Win32BindingContext；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bindingContext()，并按返回类型处理结果。
 */
function bindingContext(): Win32BindingContext {
  if (cachedContext !== undefined) return cachedContext
  /**
   * 常量说明：kernel32 用于处理 kernel32 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const kernel32 = koffi.load('kernel32.dll')
  /**
   * 常量说明：advapi32 用于处理 advapi32 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const advapi32 = koffi.load('advapi32.dll')
  /**
   * 常量说明：bind 用于处理 bind 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 bind 相关流程；使用场景由所在模块及调用位置决定。
   * @param lib （ReturnType<typeof koffi.load>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param name （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param result （Ptr | string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param args （Array<Ptr | string>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 bind(lib, name, result, args)，并按返回类型处理结果。
   */
  const bind = (
    lib: ReturnType<typeof koffi.load>,
    name: string,
    result: Ptr | string,
    args: Array<Ptr | string>,
  ): unknown => lib.func('__stdcall', name, result, args)
  cachedContext = { kernel32, advapi32, bind }
  return cachedContext
}

/**
 * 功能说明：处理 bindings 相关流程；使用场景由所在模块及调用位置决定。
 * @returns Win32ProcessBindings；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 bindings()，并按返回类型处理结果。
 */
function bindings(): Win32ProcessBindings {
  if (cached !== undefined) return cached
  /**
   * 常量说明：kernel32、advapi32、bind 用于处理 kernel32、advapi32、bind 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const { kernel32, advapi32, bind } = bindingContext()
  cached = {
    closeHandle: bind(kernel32, 'CloseHandle', 'int', [PVOID]),
    getLastError: bind(kernel32, 'GetLastError', 'uint32', []),
    formatMessageW: bind(kernel32, 'FormatMessageW', 'uint32', [
      'uint32', PVOID, 'uint32', 'uint32', PVOID, 'uint32', PVOID,
    ]),
    createPipe: bind(kernel32, 'CreatePipe', 'int', [PPVOID, PPVOID, PVOID, 'uint32']),
    setHandleInformation: bind(kernel32, 'SetHandleInformation', 'int', [PVOID, 'uint32', 'uint32']),
    createProcessAsUserW: bind(advapi32, 'CreateProcessAsUserW', 'int', [
      PVOID, 'str16', 'str16', PVOID, PVOID, 'int', 'uint32', PVOID, 'str16',
      koffi.pointer(STARTUPINFOW), koffi.pointer(PROCESS_INFORMATION),
    ]),
    readFile: bind(kernel32, 'ReadFile', 'int', [PVOID, PVOID, 'uint32', koffi.pointer('uint32'), PVOID]),
    peekNamedPipe: bind(kernel32, 'PeekNamedPipe', 'int', [
      PVOID, PVOID, 'uint32', koffi.pointer('uint32'), koffi.pointer('uint32'), koffi.pointer('uint32'),
    ]),
    waitForSingleObject: bind(kernel32, 'WaitForSingleObject', 'uint32', [PVOID, 'uint32']),
    getExitCodeProcess: bind(kernel32, 'GetExitCodeProcess', 'int', [PVOID, koffi.pointer('uint32')]),
    createJobObjectW: bind(kernel32, 'CreateJobObjectW', PVOID, [PVOID, 'str16']),
    setInformationJobObject: bind(kernel32, 'SetInformationJobObject', 'int', [PVOID, 'int', PVOID, 'uint32']),
    assignProcessToJobObject: bind(kernel32, 'AssignProcessToJobObject', 'int', [PVOID, PVOID]),
    resumeThread: bind(kernel32, 'ResumeThread', 'uint32', [PVOID]),
    terminateProcess: bind(kernel32, 'TerminateProcess', 'int', [PVOID, 'uint32']),
    getStdHandle: bind(kernel32, 'GetStdHandle', PVOID, ['int']),
  } as unknown as Win32ProcessBindings
  return cached
}

/**
 * Extend the shared process table with caller-owned Win32 API families.
 * @param create - binds only the caller-specific operations from the shared libraries.
 * @returns generic process bindings combined with the caller-specific operations.
 * @remarks 中文说明：功能说明：处理 extendWin32ProcessBindings 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：create（(context: Win32BindingContext) => Extension）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Win32ProcessBindings & Extension；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 extendWin32ProcessBindings(create)，
 * 并按返回类型处理结果。
 */
export function extendWin32ProcessBindings<Extension extends object>(
  create: (context: Win32BindingContext) => Extension,
): Win32ProcessBindings & Extension {
  return { ...bindings(), ...create(bindingContext()) }
}
/* v8 ignore stop */

/**
 * Format a Win32 error code through FormatMessageW.
 * @param api - active binding table.
 * @param win32Code - captured GetLastError value.
 * @returns trimmed system message, or an empty string when unavailable.
 * @remarks 中文说明：功能说明：处理 errorText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：win32Code（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 errorText(api, win32Code)，
 * 并按返回类型处理结果。
 */
export function errorText(api: Win32ProcessBindings, win32Code: number): string {
  /**
   * 常量说明：buffer 用于处理 buffer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const buffer = Buffer.alloc(1024)
  /**
   * 常量说明：length 用于处理 length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const length = api.formatMessageW(
    abi.FORMAT_MESSAGE_FROM_SYSTEM | abi.FORMAT_MESSAGE_IGNORE_INSERTS,
    null,
    win32Code,
    0,
    buffer,
    buffer.length / 2,
    null,
  )
  return length === 0 ? '' : buffer.subarray(0, length * 2).toString('utf16le').trim()
}

/**
 * Throw the current GetLastError value.
 * @param api - active binding table.
 * @param name - failing Win32 operation.
 * @param detail - optional operation context.
 * @returns never; always throws Win32Error.
 * @remarks 中文说明：功能说明：处理 throwLastError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：detail（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：never；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 throwLastError(api, name, detail)，
 * 并按返回类型处理结果。
 */
export function throwLastError(api: Win32ProcessBindings, name: string, detail?: string): never {
  /**
   * 常量说明：win32Code 用于处理 win32Code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const win32Code = api.getLastError()
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code))
}

/**
 * Throw an explicitly captured Win32 error code.
 * @param api - active binding table.
 * @param name - failing Win32 operation.
 * @param win32Code - error captured before cleanup.
 * @param detail - optional operation context.
 * @returns never; always throws Win32Error.
 * @remarks 中文说明：功能说明：处理 throwWin32 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：api（Win32ProcessBindings）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：win32Code（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：detail（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：never；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 throwWin32(api, name, win32Code,
 * detail)，并按返回类型处理结果。
 */
export function throwWin32(
  api: Win32ProcessBindings,
  name: string,
  win32Code: number,
  detail?: string,
): never {
  throw new Win32Error(name, win32Code, detail ?? errorText(api, win32Code))
}
