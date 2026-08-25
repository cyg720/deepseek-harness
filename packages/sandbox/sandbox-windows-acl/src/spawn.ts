/**
 * Restricted-process spawning: anonymous pipes for stdio, STARTUPINFOW with
 * STARTF_USESTDHANDLES, CreateProcessAsUserW under the restricted token, then
 * asynchronous pipe draining and exit waiting. Console isolation
 * (CREATE_NO_WINDOW / CREATE_NEW_CONSOLE) is intentionally absent: under this
 * restriction scheme hidden-console children die with STATUS_DLL_INIT_FAILED
 * (0xC0000142) — verified empirically, see win32-abi.ts. Stdio redirection is
 * pipe-based and unaffected; the child shares the host console.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/spawn
 */
/**
 * 文件职责：实现 spawn.ts 承担的沙箱安全与权限隔离配置、协议与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验、事件日志与异步资源管理。
 * 产品维度：为 Agent 提供可靠的沙箱安全与权限隔离能力。
 * 逻辑维度：解析输入，注册能力，执行核心操作，并在结束时释放所拥有的资源。
 * 关键边界：权限和配置失败必须显式；模型可见状态必须记录；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型和常量，再读主流程，最后关注平台限制、恢复和清理。
 */

import { allocPtrSlot, allocProcessInfo, allocStartupInfo, allocUint32, decodePtr, decodeProcessInfo, decodeUint32, encodeStartupInfo, isNullPtr, throwLastError, throwWin32 } from './ffi.ts'
import type { NativePtr, Win32Bindings } from './ffi.ts'
import * as abi from './win32-abi.ts'

/**
 * Quote one argument per the CommandLineToArgvW parsing rules: backslashes
 * are doubled only before a quote character — including the closing quote
 * this function appends, so a trailing backslash run is doubled as well
 * (otherwise an odd run would escape the closing quote into a literal
 * character and corrupt the rest of the command line). Mirrors the CRT
 * ArgvQuote behavior Microsoft documents for command-line arguments.
 * @param argument - one argv entry to quote.
 * @returns the quoted entry (bare when quoting is unnecessary).
 */
/** 中文说明：函数 quoteArg 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function quoteArg(argument: string): string {
  if (argument === '') return '""'
  if (!/[\s"]/u.test(argument)) return argument
  /** 中文说明：变量 quoted 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let quoted = '"'
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (let index = 0; index < argument.length; index++) {
    /** 中文说明：变量 backslashes 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let backslashes = 0
    while (index < argument.length && argument.charAt(index) === '\\') {
      backslashes++
      index++
    }
    if (index === argument.length) {
      // Trailing backslash run: doubled so it cannot escape the closing quote.
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
 * Build the single command line CreateProcess parses from program + argv.
 * @param program - the executable (argv[0]).
 * @param args - the remaining argv entries.
 * @returns the joined, quoted command line.
 */
/** 中文说明：函数 buildCommandLine 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function buildCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args].map(quoteArg).join(' ')
}

/** 中文说明：interface PipePair 定义本模块所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
interface PipePair {
  read: NativePtr
  write: NativePtr
}

/** 中文说明：函数 createPipe 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function createPipe(api: Win32Bindings): PipePair {
  /** 中文说明：变量 readSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const readSlot = allocPtrSlot()
  /** 中文说明：变量 writeSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const writeSlot = allocPtrSlot()
  if (api.createPipe(readSlot, writeSlot, null, 0) === 0) throwLastError(api, 'CreatePipe')
  /** 中文说明：变量 read 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const read = decodePtr(readSlot)
  /** 中文说明：变量 write 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const write = decodePtr(writeSlot)
  if (read === null || write === null) throwLastError(api, 'CreatePipe', 'null pipe handle')
  return { read, write }
}

/** 中文说明：函数 setInheritable 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function setInheritable(api: Win32Bindings, handle: NativePtr, label: string): void {
  if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
    throwLastError(api, 'SetHandleInformation', label)
  }
}

/** A confined child spawned with piped stdio: process handle plus the pipe read ends to drain. */
/** 中文说明：interface SpawnedNative 定义本模块所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
export interface SpawnedNative {
  pid: number
  process: NativePtr
  stdoutRead: NativePtr
  stderrRead: NativePtr
}

/**
 * Create a process under the restricted token with piped stdio. The child's
 * stdin is closed immediately (EOF), matching the POC; stdout/stderr read ends
 * are returned for draining. The child inherits the caller's environment block
 * (lpEnvironment NULL); the caller rewrites entries through
 * SetEnvironmentVariableW before spawning (the runner's per-session temp
 * contract) — passing an explicit block through koffi trips
 * ERROR_INVALID_PARAMETER in CreateProcessAsUserW (verified empirically).
 * @param api - the binding table.
 * @param token - the restricted token the child runs under.
 * @param options - command, args, and working directory.
 * @returns the spawned child's handles.
 */
/** 中文说明：函数 spawnSandboxed 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function spawnSandboxed(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string },
): SpawnedNative {
  /** 中文说明：变量 stdIn 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdIn = createPipe(api)
  /** 中文说明：变量 stdOut 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdOut = createPipe(api)
  /** 中文说明：变量 stdErr 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdErr = createPipe(api)
  // Child side of each pipe must be inheritable (POC lines 262-268).
  setInheritable(api, stdIn.read, 'stdin read end')
  setInheritable(api, stdOut.write, 'stdout write end')
  setInheritable(api, stdErr.write, 'stderr write end')

  /** 中文说明：变量 startupInfo 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const startupInfo = allocStartupInfo()
  encodeStartupInfo(startupInfo, {
    cb: abi.STARTUPINFOW_SIZE,
    dwFlags: abi.STARTF_USESTDHANDLES,
    hStdInput: stdIn.read,
    hStdOutput: stdOut.write,
    hStdError: stdErr.write,
  })

  /** 中文说明：变量 processInfo 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processInfo = allocProcessInfo()
  /** 中文说明：变量 commandLine 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commandLine = buildCommandLine(options.command, options.args)
  /** 中文说明：变量 created 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const created = api.createProcessAsUserW(
    token, null, commandLine,
    null, null,
    1, // bInheritHandles: required for redirection
    0, // no creation flags: suspended/no-window variants are unusable under the restriction
    null, options.cwd,
    startupInfo, processInfo,
  )
  // Capture the failure before CloseHandle calls clobber GetLastError, then
  // close every pipe handle created so far — the six-close contract this test
  // surface pins (tests/failure-paths.spec.ts).
  if (created === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(stdIn.read)
    api.closeHandle(stdIn.write)
    api.closeHandle(stdOut.read)
    api.closeHandle(stdOut.write)
    api.closeHandle(stdErr.read)
    api.closeHandle(stdErr.write)
    throwWin32(api, 'CreateProcessAsUserW', win32Code, `command: ${options.command}, cwd: ${options.cwd}`)
  }

  /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const info = decodeProcessInfo(processInfo)
  /** 中文说明：变量 processHandle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processHandle = info.hProcess
  /** 中文说明：变量 threadHandle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const threadHandle = info.hThread
  if (processHandle === null || threadHandle === null) {
    throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`)
  }

  // Host-side cleanup: child handles are now duplicated in the child; the
  // host closes its copies so ReadFile sees EOF when the child exits.
  api.closeHandle(stdIn.read)
  api.closeHandle(stdOut.write)
  api.closeHandle(stdErr.write)
  api.closeHandle(stdIn.write)
  api.closeHandle(threadHandle)

  return {
    pid: info.dwProcessId,
    process: processHandle,
    stdoutRead: stdOut.read,
    stderrRead: stdErr.read,
  }
}

/**
 * Drain one pipe read end to a Buffer via non-blocking PeekNamedPipe polling.
 * @param api - the binding table.
 * @param handle - the pipe read end to drain (closed when done).
 * @returns the complete pipe contents.
 */
/** 中文说明：函数 drainPipe 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export async function drainPipe(api: Win32Bindings, handle: NativePtr): Promise<Buffer> {
  /** 中文说明：变量 chunks 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunks: Buffer[] = []
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (;;) {
    /** 中文说明：变量 bytesReadSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bytesReadSlot = allocUint32()
    /** 中文说明：变量 totalAvailSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const totalAvailSlot = allocUint32()
    /** 中文说明：变量 leftThisMessageSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const leftThisMessageSlot = allocUint32()
    /** 中文说明：变量 peeked 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const peeked = api.peekNamedPipe(handle, null, 0, bytesReadSlot, totalAvailSlot, leftThisMessageSlot)
    if (peeked === 0) {
      /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const win32Code = api.getLastError()
      if (win32Code === abi.ERROR_BROKEN_PIPE || win32Code === abi.ERROR_NO_DATA) break // child closed its end: clean EOF
      throwLastError(api, 'PeekNamedPipe', `drain failure after ${chunks.length} chunk(s)`)
    }
    /** 中文说明：变量 available 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const available = decodeUint32(totalAvailSlot)
    if (available > 0) {
      /** 中文说明：变量 chunk 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const chunk = Buffer.alloc(available)
      /** 中文说明：变量 readSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const readSlot = allocUint32()
      if (api.readFile(handle, chunk, chunk.length, readSlot, null) === 0) {
        throwLastError(api, 'ReadFile', `drain failure after ${chunks.length} chunk(s)`)
      }
      chunks.push(chunk.subarray(0, decodeUint32(readSlot)))
    }
    // Small backoff instead of setImmediate: a bare next-tick would busy-poll
    // the pipe at full event-loop speed while the child produces no output.
    await new Promise<void>(resolve => setTimeout(resolve, 1))
  }
  api.closeHandle(handle)
  return Buffer.concat(chunks)
}

/**
 * Wait for process exit and return its exit code. Call only after both drains
 * have resolved — the drains finish when the child closed its pipe ends, i.e.
 * the child has already exited, so this wait returns immediately. Calling it
 * earlier would block the event loop and starve the drains (the pipe-buffer
 * deadlock the POC comments warn about).
 * @param api - the binding table.
 * @param process - the child process handle (closed when done).
 * @returns the child's exit code.
 */
/** 中文说明：函数 waitForExit 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function waitForExit(api: Win32Bindings, process: NativePtr): number {
  /** 中文说明：变量 waitResult 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const waitResult = api.waitForSingleObject(process, abi.INFINITE)
  if (waitResult === 0xFFFFFFFF) throwLastError(api, 'WaitForSingleObject')
  /** 中文说明：变量 exitCodeSlot 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const exitCodeSlot = allocUint32()
  if (api.getExitCodeProcess(process, exitCodeSlot) === 0) throwLastError(api, 'GetExitCodeProcess')
  api.closeHandle(process)
  return decodeUint32(exitCodeSlot)
}

/**
 * Create a kill-on-close job object (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE at
 * LimitFlags offset 16 of JOBOBJECT_EXTENDED_LIMIT_INFORMATION, layout
 * verified by abi-probe.cpp). When the caller dies with the job handle open,
 * Windows terminates every process in the job — the orphan-child backstop.
 * The caller keeps the returned handle open for the child's lifetime.
 */
/** 中文说明：函数 createKillOnCloseJob 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function createKillOnCloseJob(api: Win32Bindings): NativePtr {
  /** 中文说明：变量 job 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const job = api.createJobObjectW(null, null)
  if (isNullPtr(job)) throwLastError(api, 'CreateJobObjectW')
  /** 中文说明：变量 information 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const information = Buffer.alloc(abi.JOBOBJECT_EXTENDED_LIMIT_SIZE)
  information.writeUInt32LE(abi.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, abi.JOBOBJECT_EXTENDED_LIMIT_FLAGS_OFFSET)
  if (api.setInformationJobObject(job, abi.JobObjectExtendedLimitInformation, information, information.length) === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(job)
    throwWin32(api, 'SetInformationJobObject', win32Code)
  }
  return job
}

/** A confined child spawned with inherited stdio: process handle plus its kill-on-close job. */
/** 中文说明：interface SpawnedInherited 定义本模块所需的数据或行为，用于表达沙箱安全与权限隔离场景。 */
export interface SpawnedInherited {
  pid: number
  process: NativePtr
  /** Kill-on-close job the child was placed in; caller closes it after the child exits. */
  job: NativePtr
}

/**
 * Create a process under the restricted token whose stdio passes straight
 * through to the caller's pipes. This is the runner shape: the harness spawns
 * the runner with piped stdio, and the runner's confined child writes to
 * those same pipes.
 *
 * Node clears the inheritability of its stdio handles at startup
 * (uv_disable_stdio_inheritance), so raw spawns must re-enable the inherit
 * bit around the call (libuv instead duplicates the handles; re-enabling is
 * equivalent here and cheaper) and pass them explicitly via
 * STARTF_USESTDHANDLES — otherwise the child receives INVALID std handles
 * ("The handle is invalid", verified the hard way). The child starts
 * suspended so it can be assigned to a kill-on-close job before it runs.
 * @param api - the binding table.
 * @param token - the restricted token the child runs under.
 * @param options - command, args, and working directory.
 * @returns the spawned child's handles and job.
 */
/** 中文说明：函数 spawnSandboxedInherited 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function spawnSandboxedInherited(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string },
): SpawnedInherited {
  /** 中文说明：变量 job 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const job = createKillOnCloseJob(api)
  /** 中文说明：变量 stdIn 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdIn = api.getStdHandle(abi.STD_INPUT_HANDLE)
  /** 中文说明：变量 stdOut 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdOut = api.getStdHandle(abi.STD_OUTPUT_HANDLE)
  /** 中文说明：变量 stdErr 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stdErr = api.getStdHandle(abi.STD_ERROR_HANDLE)
  if (isNullPtr(stdIn) || isNullPtr(stdOut) || isNullPtr(stdErr)) {
    api.closeHandle(job)
    throwLastError(api, 'GetStdHandle', 'null standard handle')
  }

  /** 中文说明：函数值 makeInheritable 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const makeInheritable = (handle: NativePtr, label: string): void => {
    if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
      throwLastError(api, 'SetHandleInformation', `${label} (enable inherit)`)
    }
  }
  /** 中文说明：函数值 restoreInherit 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const restoreInherit = (handle: NativePtr): void => {
    // Best-effort hygiene: the runner spawns nothing else; failures here must
    // not mask the child outcome, so the result is deliberately unchecked.
    api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, 0)
  }
  makeInheritable(stdIn, 'stdin')
  makeInheritable(stdOut, 'stdout')
  makeInheritable(stdErr, 'stderr')

  /** 中文说明：变量 startupInfo 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const startupInfo = allocStartupInfo()
  encodeStartupInfo(startupInfo, {
    cb: abi.STARTUPINFOW_SIZE,
    dwFlags: abi.STARTF_USESTDHANDLES,
    hStdInput: stdIn,
    hStdOutput: stdOut,
    hStdError: stdErr,
  })

  /** 中文说明：变量 processInfo 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processInfo = allocProcessInfo()
  /** 中文说明：变量 commandLine 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const commandLine = buildCommandLine(options.command, options.args)
  /** 中文说明：变量 created 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const created = api.createProcessAsUserW(
    token, null, commandLine,
    null, null,
    1, // bInheritHandles: the re-enabled std handles must be inheritable
    abi.CREATE_SUSPENDED, // suspended so job assignment precedes any execution
    null, options.cwd,
    startupInfo, processInfo,
  )
  restoreInherit(stdIn)
  restoreInherit(stdOut)
  restoreInherit(stdErr)
  if (created === 0) {
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(job)
    throwWin32(api, 'CreateProcessAsUserW', win32Code, `command: ${options.command}, cwd: ${options.cwd}`)
  }

  /** 中文说明：变量 info 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const info = decodeProcessInfo(processInfo)
  /** 中文说明：变量 processHandle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const processHandle = info.hProcess
  /** 中文说明：变量 threadHandle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const threadHandle = info.hThread
  if (processHandle === null || threadHandle === null) {
    api.closeHandle(job)
    throw new Error(`CreateProcessAsUserW succeeded but returned null process/thread handles (pid ${info.dwProcessId})`)
  }

  if (api.assignProcessToJobObject(job, processHandle) === 0) {
    // The child was created suspended and is NOT in the kill-on-close job:
    // closing handles would leave it suspended forever. Terminate it first,
    // then drop the handles and throw.
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.terminateProcess(processHandle, 1)
    api.closeHandle(threadHandle)
    api.closeHandle(processHandle)
    api.closeHandle(job)
    throwWin32(api, 'AssignProcessToJobObject', win32Code, `pid ${info.dwProcessId}`)
  }
  if (api.resumeThread(threadHandle) === 0xFFFFFFFF) {
    // Closing the job triggers kill-on-close, so the suspended child dies
    // instead of hanging until this process exits; the process/thread handles
    // must go too.
    /** 中文说明：变量 win32Code 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const win32Code = api.getLastError()
    api.closeHandle(threadHandle)
    api.closeHandle(processHandle)
    api.closeHandle(job)
    throwWin32(api, 'ResumeThread', win32Code, `pid ${info.dwProcessId}`)
  }
  api.closeHandle(threadHandle)

  return { pid: info.dwProcessId, process: processHandle, job }
}
