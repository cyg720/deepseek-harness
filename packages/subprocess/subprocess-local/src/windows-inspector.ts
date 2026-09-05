

/**
 * Windows process-table operations for terminal readiness, signalling, and
 * teardown: Toolhelp32 snapshot enumeration with GetProcessTimes creation-time
 * identity and process-handle wait-state liveness, the shell pid as a pseudo
 * process group (Windows has no POSIX groups), and taskkill tree signalling.
 * The koffi bindings load lazily so
 * non-Windows processes never touch Win32 libraries; all decision logic takes
 * an injectable internals boundary so suites can pin it on any host.
 * @module dsh-subprocess-local/windows-inspector
 */

/*
 * 【文件职责】通过 Toolhelp32、创建时间和进程句柄状态识别 Windows 进程树，延迟加载 Win32 绑定并隐藏清理辅助进程窗口。
 */

import { spawnSync } from 'node:child_process'
import koffi from 'koffi'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import type { ProcessIdentity, ProcessInspector, ProcessSnapshot } from './process-inspector.ts'

/** One Toolhelp32 process-table row. */
/* 一行 Toolhelp32 进程表记录。 */
export interface ProcessEntry {
  pid: number
  parentPid: number
}

/** Creation identity plus the process object's current wait state. */
/* 创建时间身份加进程对象的当前等待态。 */
export interface WindowsProcessState {
  /** GetProcessTimes creation identity used to fence PID reuse. */
  /* 用于围栏 PID 复用的 GetProcessTimes 创建时间身份。 */
  started: string
  /** Whether a zero-time process-handle wait reports the process still running. */
  /* 零时长进程句柄等待是否报告进程仍在运行。 */
  active: boolean
}

/** Injectable Windows process operations used by one local PTY session. */
/* 一个本地 PTY 会话使用的可注入 Windows 进程操作。 */
export interface WindowsProcessInspectorInternals {
  /** Enumerate the current process table (pid/parent pairs). */
  /* 枚举当前进程表（pid/父 pid 对）。 */
  snapshot(): ProcessEntry[]
  /** Return one process's creation identity and wait state, or undefined when unreadable. */
  /* 返回一个进程的创建身份与等待态；不可读时为 undefined。 */
  processState(pid: number): WindowsProcessState | undefined
  /** Terminate one process tree; `force` maps to taskkill `/F`. */
  /* 终止一个进程树；force 映射为 taskkill /F。 */
  taskkill(pid: number, force: boolean): void
}

/**
 * Walk a process table from one root in children-first order, retaining only
 * members whose start identity is readable (unreadable members are detector
 * misses, exactly like an unreadable `/proc` entry on Linux).
 * @param entries - the process table snapshot.
 * @param rootPid - the tree root to descend from.
 * @param started - creation-time identity resolver for one member.
 * @returns the root and its current transitive descendants, children first.
 */
/*
 * 从根开始按子先序走进程表，只保留启动身份可读的成员（不可读成员是探测漏检，
 * 与 Linux 上不可读的 /proc 条目一致）。
 * @param entries 进程表快照
 * @param rootPid 要下钻的树根
 * @param started 单个成员的创建时间身份解析器
 * @returns 根与其当前传递后代（子在前）
 */
/* jscpd:ignore-start -- the Windows inspector deliberately mirrors process-inspector.ts:
   the decision logic (tree walk, identity fencing, group signalling) is the same contract over
   Win32 primitives, per the persistent-pty note 2026-08-11-pwsh-persistent-pty. */
export function windowsProcessTree(
  entries: ProcessEntry[],
  rootPid: number,
  started: (pid: number) => string | undefined,
): ProcessIdentity[] {
  const byPid = new Map(entries.map(entry => [entry.pid, entry]))
  const root = byPid.get(rootPid)
  if (root === undefined) return []
  const byParent = new Map<number, ProcessEntry[]>()
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? []
    children.push(entry)
    byParent.set(entry.parentPid, children)
  }
  const visited = new Set<number>()
  const result: ProcessIdentity[] = []
  const visit = (entry: ProcessEntry): void => {
    if (visited.has(entry.pid)) return
    visited.add(entry.pid)
    for (const child of byParent.get(entry.pid) ?? []) visit(child)
    const identity = started(entry.pid)
    if (identity !== undefined) result.push({ pid: entry.pid, started: identity })
  }
  visit(root)
  return result
}

/**
 * Windows {@link ProcessInspector}. The shell pid stands in for a foreground
 * process group: it is a stable pseudo-group that lets the prompt-marker
 * readiness path compare foreground identities, while every actual signal
 * targets the console-wide tree through taskkill (SIGINT is delivered by the
 * terminal handle as a `\x03` input write and never reaches this layer).
 */
/*
 * Windows 版 ProcessInspector。shell pid 充当前台进程组：它是稳定的伪组，让
 * 提示符标记就绪路径可以比较前台身份；而实际信号全部经 taskkill 瞄准整个控制台树
 * （SIGINT 由终端句柄以 \x03 输入投递，永不抵达本层）。
 */
export class WindowsProcessInspector implements ProcessInspector {
  constructor(
    private readonly internals: WindowsProcessInspectorInternals = defaultWindowsProcessInternals(),
  ) {}

  foregroundPgid(shellPid: number): number {
    return shellPid
  }

  isStdinWaiting(_pgid: number, _shellPid: number): boolean {
    return false
  }

  isAlive(identity: ProcessIdentity): boolean {
    const state = this.internals.processState(identity.pid)
    return state?.active === true && state.started === identity.started
  }

  snapshot(): ProcessSnapshot {
    // Enumerated on the first question that reads the table. Liveness never
    // does — wait state is a per-handle question here — so the Windows
    // teardown poll, which asks only for liveness, pays no Toolhelp32 walk.
    let entries: ProcessEntry[] | undefined
    return {
      tree: rootPid => windowsProcessTree(
        entries ??= this.internals.snapshot(),
        rootPid,
        pid => this.internals.processState(pid)?.started,
      ),
      // Windows has no POSIX sessions; the shell pid stands in as a pseudo group.
      session: () => [],
      alive: identity => this.isAlive(identity),
    }
  }

  signalGroup(pgid: number, signal: SubprocessTerminalSignal): void {
    this.internals.taskkill(pgid, signal === 'SIGKILL')
  }

  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (this.isAlive(identity)) this.internals.taskkill(identity.pid, signal === 'SIGKILL')
  }
}
/* jscpd:ignore-end */

/**
 * Create the Windows process inspector.
 * @param internals - injectable process operations; defaults to the koffi-backed table.
 * @returns the Windows inspector.
 */
/*
 * 创建 Windows 进程检查器。
 * @param internals 可注入的进程操作；缺省用 koffi 支撑的表
 * @returns Windows 检查器
 */
export function createWindowsProcessInspector(
  internals: WindowsProcessInspectorInternals = defaultWindowsProcessInternals(),
): WindowsProcessInspector {
  return new WindowsProcessInspector(internals)
}

/** Terminate one Windows process tree with taskkill, contained like POSIX group signalling. */
/* 用 taskkill 终止一个 Windows 进程树，与 POSIX 组信号一样做错误收敛。 */
function taskkillTree(pid: number, force: boolean): void {
  if (pid <= 0) return
  // Outcome deliberately unchecked: an already-absent tree, exit races, and a
  // missing taskkill binary are as tolerable here as ESRCH is for POSIX.
  spawnSync('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
    stdio: 'ignore',
    windowsHide: true,
  })
}

declare const nativePtr: unique symbol
/** Koffi 3 native pointer (a BigInt address), branded so it cannot silently enter numeric contexts. */
/* Koffi 3 原生指针（BigInt 地址），带品牌标记，防止静默进入数值上下文。 */
export type NativePtr = bigint & { readonly [nativePtr]: true }

/**
 * True for NULL and INVALID_HANDLE_VALUE returns from Win32 handle APIs.
 * @param value - a handle as koffi may hand it back (pointer, null, or 0n).
 * @returns whether the value signals an invalid handle.
 */
/*
 * Win32 句柄 API 返回 NULL 或 INVALID_HANDLE_VALUE 时为 true。
 * @param value koffi 可能返回的句柄（指针、null 或 0n）
 * @returns 该值是否表示无效句柄
 */
export function isInvalidHandle(value: NativePtr | null | undefined): boolean {
  if (value === null || value === undefined) return true
  const asBigInt = value as bigint
  return asBigInt === 0n || asBigInt === 0xFFFFFFFFFFFFFFFFn || asBigInt === -1n
}

/** The lazy koffi binding table: every Win32 call the Windows inspector uses. */
/* 惰性 koffi 绑定表：Windows 检查器用到的全部 Win32 调用。 */
interface Win32Bindings {
  createToolhelp32Snapshot(flags: number, processId: number): NativePtr
  process32FirstW(snapshot: NativePtr, entry: NativePtr): number
  process32NextW(snapshot: NativePtr, entry: NativePtr): number
  openProcess(desiredAccess: number, inheritHandle: number, pid: number): NativePtr
  getProcessTimes(
    process: NativePtr,
    creation: NativePtr,
    exit: NativePtr,
    kernel: NativePtr,
    user: NativePtr,
  ): number
  waitForSingleObject(handle: NativePtr, milliseconds: number): number
  closeHandle(handle: NativePtr): number
}

const PVOID: ReturnType<typeof koffi.pointer> = koffi.pointer('void')

/**
 * Resolve the koffi Win32 struct types once. Registration is lazy and cached
 * because koffi's type registry is global per process: test runners that
 * re-evaluate this module (a hoisted `vi.mock` re-imports the graph) must not
 * re-register the names.
 */
/*
 * 解析 koffi 的 Win32 结构体类型（只注册一次）。注册惰性且缓存，因为 koffi 类型注册表
 * 是进程级全局的：会重新求值本模块的测试运行器（vi.mock 重新导入图）不得重注册这些名字。
 */
function win32Structs(): { PROCESSENTRY32W: ReturnType<typeof koffi.struct>; FILETIME: ReturnType<typeof koffi.struct> } {
  if (cachedStructs !== undefined) return cachedStructs
  // koffi PROCESSENTRY32W layout (tlhelp32.h); the size assert pins the x64 layout.
  // koffi 的 PROCESSENTRY32W 布局（tlhelp32.h）；大小断言固定 x64 布局。
  const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: PVOID,
    th32ModuleID: 'uint32',
    cCntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16', 260),
  })
  // koffi FILETIME layout (minwinbase.h): two 32-bit halves of the 64-bit timestamp.
  // koffi 的 FILETIME 布局（minwinbase.h）：64 位时间戳的两个 32 位半。
  const FILETIME = koffi.struct('FILETIME', {
    dwLowDateTime: 'uint32',
    dwHighDateTime: 'uint32',
  })
  /* v8 ignore start -- a layout-mismatch guard fires only on ABI breakage; the windows-native suites exercise the real struct. */
  if (PROCESSENTRY32W.size !== 568) {
    throw new Error(`PROCESSENTRY32W layout mismatch: koffi computed ${PROCESSENTRY32W.size}, Windows headers say 568`)
  }
  /* v8 ignore stop */
  cachedStructs = { PROCESSENTRY32W, FILETIME }
  return cachedStructs
}

let cachedStructs: ReturnType<typeof win32Structs> | undefined

const TH32CS_SNAPPROCESS = 0x2
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const SYNCHRONIZE = 0x00100000
const WAIT_OBJECT_0 = 0
const WAIT_TIMEOUT = 0x102

let cachedBindings: Win32Bindings | undefined

/**
 * Resolve the lazy Win32 bindings (throws the first binding failure, fail-closed).
 * @returns the cached binding table.
 */
/*
 * 解析惰性 Win32 绑定（首次绑定失败即抛错，失败即关闭）。
 * @returns 缓存的绑定表
 */
function win32Bindings(): Win32Bindings {
  if (cachedBindings !== undefined) return cachedBindings
  const { PROCESSENTRY32W, FILETIME } = win32Structs()
  const kernel32 = koffi.load('kernel32.dll')
  const bind = (
    name: string,
    result: ReturnType<typeof koffi.pointer> | string,
    args: Array<ReturnType<typeof koffi.pointer> | string>,
  ): unknown => kernel32.func('__stdcall', name, result, args)
  cachedBindings = {
    createToolhelp32Snapshot: bind('CreateToolhelp32Snapshot', PVOID, ['uint32', 'uint32']),
    process32FirstW: bind('Process32FirstW', 'int', [PVOID, koffi.pointer(PROCESSENTRY32W)]),
    process32NextW: bind('Process32NextW', 'int', [PVOID, koffi.pointer(PROCESSENTRY32W)]),
    openProcess: bind('OpenProcess', PVOID, ['uint32', 'int', 'uint32']),
    getProcessTimes: bind('GetProcessTimes', 'int', [
      PVOID,
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME),
      koffi.pointer(FILETIME),
    ]),
    waitForSingleObject: bind('WaitForSingleObject', 'uint32', [PVOID, 'uint32']),
    closeHandle: bind('CloseHandle', 'int', [PVOID]),
  } as unknown as Win32Bindings
  return cachedBindings
}

/**
 * Allocate koffi memory as a branded {@link NativePtr}; koffi's TS types are
 * `any`, so the cast goes through `unknown` to keep the unsafe surface here.
 * @param type - the koffi type to allocate.
 * @param count - element count.
 * @returns the branded allocation pointer.
 */
/*
 * 分配 koffi 内存并打成品牌 NativePtr；koffi 的 TS 类型是 any，经 unknown 转型
 * 以收窄不安全面。
 * @param type 要分配的 koffi 类型
 * @param count 元素个数
 * @returns 带品牌的分配指针
 */
function allocNative(type: Parameters<typeof koffi.alloc>[0], count: number): NativePtr {
  const value: unknown = koffi.alloc(type, count)
  return value as NativePtr
}

/** Enumerate the current process table through Toolhelp32. */
/* 经 Toolhelp32 枚举当前进程表。 */
function snapshotWindowsProcesses(bindings: Win32Bindings): ProcessEntry[] {
  const { PROCESSENTRY32W } = win32Structs()
  const snapshot = bindings.createToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  /* v8 ignore next -- an invalid snapshot for the process flag is not producible through the public API;
     the guard mirrors POSIX's unreadable-proc tolerance and isInvalidHandle is unit-tested. */
  if (isInvalidHandle(snapshot)) return []
  const entries: ProcessEntry[] = []
  try {
    const entry = allocNative(PROCESSENTRY32W, 1)
    koffi.encode(entry, 'uint32', PROCESSENTRY32W.size)
    let ok = bindings.process32FirstW(snapshot, entry)
    while (ok !== 0) {
      const record = koffi.decode(entry, PROCESSENTRY32W) as {
        th32ProcessID: number
        th32ParentProcessID: number
      }
      entries.push({ pid: record.th32ProcessID, parentPid: record.th32ParentProcessID })
      ok = bindings.process32NextW(snapshot, entry)
    }
  } finally {
    bindings.closeHandle(snapshot)
  }
  return entries
}

/** Read one process's creation identity and current wait state. */
/* 读取一个进程的创建时间身份与当前等待态。 */
function windowsProcessState(bindings: Win32Bindings, pid: number): WindowsProcessState | undefined {
  const { FILETIME } = win32Structs()
  const handle = bindings.openProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid)
  if (isInvalidHandle(handle)) return undefined
  try {
    const creation = allocNative(FILETIME, 1)
    const exit = allocNative(FILETIME, 1)
    const kernel = allocNative(FILETIME, 1)
    const user = allocNative(FILETIME, 1)
    /* v8 ignore next -- a GetProcessTimes failure after a successful open races process exit and
       cannot be staged deterministically; the absent-process path is covered and the caller
       treats undefined as a detector miss. */
    if (bindings.getProcessTimes(handle, creation, exit, kernel, user) === 0) return undefined
    const record = koffi.decode(creation, FILETIME) as { dwLowDateTime: number; dwHighDateTime: number }
    // 零时长等待：WAIT_TIMEOUT 表示仍在运行（active），WAIT_OBJECT_0 表示已退出。
    const wait = bindings.waitForSingleObject(handle, 0)
    /* v8 ignore next -- an opened process handle has exactly one of these two
       zero-time wait states; an unexpected Win32 failure is an unreadable process. */
    if (wait !== WAIT_OBJECT_0 && wait !== WAIT_TIMEOUT) return undefined
    return {
      started: `${record.dwHighDateTime}:${record.dwLowDateTime}`,
      active: wait === WAIT_TIMEOUT,
    }
  } finally {
    bindings.closeHandle(handle)
  }
}

/** The koffi-backed default internals; bindings resolve lazily on first use. */
/* koffi 支撑的默认内部实现；绑定在首次使用时惰性解析。 */
function defaultWindowsProcessInternals(): WindowsProcessInspectorInternals {
  return {
    snapshot: () => snapshotWindowsProcesses(win32Bindings()),
    processState: pid => windowsProcessState(win32Bindings(), pid),
    taskkill: taskkillTree,
  }
}
