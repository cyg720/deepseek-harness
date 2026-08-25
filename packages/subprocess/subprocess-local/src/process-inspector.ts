/*
 * ================================ 文件注释 ================================
 * 【文件职责】平台进程表检查：为终端就绪、信号与拆解提供"进程树/会话/存活/前台组/
 * stdin 等待"的事实来源，按平台分发（Linux 用 /proc，macOS 用 /bin/ps，Windows 委托
 * windows-inspector.ts 的 koffi 绑定）。
 * 【技术维度】可注入的进程表边界（ProcessInspectorInternals）+ 各平台实现；Linux 的
 * stdin 等待探测读 /proc/<pid>/task/<tid>/syscall 与被阻塞系统调用参数（经 /proc/<pid>/mem
 * 读 fd_set/pollfd）；PID 复用由"启动时间身份"（started 字段）围栏。
 * 【产品维度】PTY 会话能力的地基：判断前台进程组、等待输入（终端就绪）、整树拆解
 * 不误伤 PID 复用后的新进程。
 * 【逻辑维度】定义身份/接口 → Linux 实现（/proc 解析、syscall 探测）→ macOS 实现
 * （/bin/ps）→ createProcessInspector 按平台工厂分发。
 * 【关键边界】进程表读取失败一律按"缺失"容忍（探测漏检安全，误杀危险）；
 * PID 复用由 started 身份围栏；未知架构/平台在加载时响亮失败。
 * 【新手阅读建议】先看 ProcessIdentity（为什么带 started），再看 processTree 的子先序
 * 遍历，最后看 Linux 的 isStdinWaiting 如何经 syscall 探测判定等待输入。
 * ==========================================================================
 */

/** Platform process-table inspection for terminal readiness, signals, and teardown. */

import { closeSync, openSync, readFileSync, readdirSync, readSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import { createWindowsProcessInspector } from './windows-inspector.ts'

/** PID plus start identity, preventing teardown escalation after PID reuse. */
/* PID 加启动身份：防止 PID 复用后终止升级误伤新进程。 */
export interface ProcessIdentity {
  pid: number
  started: string
}

/** Injectable OS process operations used by one local PTY session. */
/* 一个本地 PTY 会话使用的可注入 OS 进程操作。 */
export interface ProcessInspector {
  foregroundPgid(shellPid: number): number | undefined
  isStdinWaiting(pgid: number): boolean
  /** Return the root and its current transitive descendants, children first. */
  /* 返回根进程与其当前传递后代（子在前）。 */
  processTree(rootPid: number): ProcessIdentity[]
  /** Return current members of one POSIX process session when the platform exposes them. */
  /* 平台暴露时返回一个 POSIX 进程会话的当前成员。 */
  processSession(sessionId: number): ProcessIdentity[]
  /** Return whether the exact identity remains a non-quiescent process. */
  /* 返回该精确身份是否仍是未静默（存活）的进程。 */
  isAlive(identity: ProcessIdentity): boolean
  signalGroup(pgid: number, signal: SubprocessTerminalSignal): void
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void
}

/** Testable boundary around filesystem, process-table, and signal syscalls. */
/* 文件系统、进程表与信号系统调用的可测试边界（注入后可在任意宿主确定性测试）。 */
export interface ProcessInspectorInternals {
  readFile(path: string): string
  readDir(path: string): string[]
  open(path: string): number
  read(fd: number, buffer: Buffer, length: number, position: number): number
  close(fd: number): void
  exec(file: string, args: string[]): string
  kill(pid: number, signal: NodeJS.Signals): void
}

/* v8 ignore start -- thin OS bindings; injected logic is unit-tested and real platform composition exercises them. */
/** 默认系统绑定（薄封装 Node 的同步文件系统/子进程/信号 API，v8 豁免为只测注入逻辑）。 */
const DEFAULT_INTERNALS: ProcessInspectorInternals = {
  readFile: path => readFileSync(path, 'utf8'),
  readDir: path => readdirSync(path),
  open: path => openSync(path, 'r'),
  read: (fd, buffer, length, position) => readSync(fd, buffer, 0, length, position),
  close: closeSync,
  exec: (file, args) => execFileSync(file, args, { encoding: 'utf8' }),
  kill: (pid, signal) => process.kill(pid, signal),
}
/* v8 ignore stop */

interface ProcStat {
  pid: number
  parentPid: number
  pgrp: number
  session: number
  state: string
  tpgid: number
  started: string
}

/**
 * Parse fields used from Linux `/proc/<pid>/stat`, including parenthesized comm text.
 * @param text - complete stat line.
 * @returns Parsed identity/group fields, or undefined for malformed input.
 */
/*
 * 解析 Linux /proc/<pid>/stat 中使用的字段（comm 文本带括号，需特殊处理）。
 * @param text 完整 stat 行
 * @returns 解析出的身份/组字段；输入畸形时为 undefined
 */
export function parseProcStat(text: string): ProcStat | undefined {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open <= 0 || close <= open) return undefined
  const pid = Number(text.slice(0, open).trim())
  const rest = text.slice(close + 2).trim().split(/\s+/)
  const state = rest[0] || ''
  const parentPid = Number(rest[1])
  const pgrp = Number(rest[2])
  const session = Number(rest[3])
  const tpgid = Number(rest[5])
  const started = rest[19]
  if (![pid, parentPid, pgrp, session, tpgid].every(Number.isSafeInteger)
    || state.length !== 1 || started === undefined) return undefined
  return { pid, parentPid, pgrp, session, state, tpgid, started }
}

/** 读取并解析单个 Linux 进程的 stat（条目不可读时按缺失处理）。 */
function readLinuxStat(internals: ProcessInspectorInternals, pid: number): ProcStat | undefined {
  try {
    return parseProcStat(internals.readFile(`/proc/${pid}/stat`))
  } catch (_unreadableProcEntry) {
    return undefined
  }
}

/**
 * Report whether a Linux process group has an executing member. `false`
 * means the group contains only zombie/dead entries; `undefined` means the
 * process table could not prove either outcome.
 * @param processGroupId - POSIX process-group id to inspect.
 * @param internals - injectable process-table operations.
 * @returns Live-member presence, or `undefined` when unavailable/absent.
 */
/*
 * 报告一个 Linux 进程组是否有正在执行的成员。false 表示组内只有僵尸/死亡条目；
 * undefined 表示进程表无法证明任一结论。
 * @param processGroupId 待检查的 POSIX 进程组 id
 * @param internals 可注入的进程表操作
 * @returns 是否存在活跃成员；不可用/组不存在时为 undefined
 */
export function linuxProcessGroupHasLiveMembers(
  processGroupId: number,
  internals: ProcessInspectorInternals = DEFAULT_INTERNALS,
): boolean | undefined {
  let entries: string[]
  try {
    entries = internals.readDir('/proc')
  } catch (_unreadableProcDirectory) {
    return undefined
  }
  let matched = false
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const stat = readLinuxStat(internals, Number(entry))
    if (stat?.pgrp !== processGroupId) continue
    matched = true
    // 状态为 Z（僵尸）/X（死）/x（死）之外即视为有活跃成员。
    if (!/^[ZXx]$/.test(stat.state)) return true
  }
  return matched ? false : undefined
}

/** 读取某目录下的数字条目（目录不可读时按空处理），用于遍历 /proc。 */
function numericEntries(internals: ProcessInspectorInternals, path: string): number[] {
  try {
    return internals.readDir(path).filter(entry => /^\d+$/.test(entry)).map(Number)
  } catch (_unreadableProcDirectory) {
    return []
  }
}

/** 一个被阻塞系统调用的信息：系统调用号与最多 6 个参数。 */
interface SyscallInfo {
  number: number
  args: number[]
}

/** 读取某线程当前阻塞的系统调用（运行中或无参数时返回 undefined）。 */
function readSyscall(internals: ProcessInspectorInternals, pid: number, tid: number): SyscallInfo | undefined {
  try {
    const text = internals.readFile(`/proc/${pid}/task/${tid}/syscall`).trim()
    if (text === 'running' || text.startsWith('-1 ')) return undefined
    const fields = text.split(/\s+/)
    const number = Number(fields[0])
    const args = fields.slice(1, 7).map(field => Number.parseInt(field, 16))
    if (!Number.isSafeInteger(number) || args.some(value => !Number.isSafeInteger(value))) return undefined
    return { number, args }
  } catch (_unreadableSyscall) {
    return undefined
  }
}

/** 读取指定进程内存地址处的字节（读失败时按缺失处理）。 */
function readMemory(
  internals: ProcessInspectorInternals,
  pid: number,
  address: number,
  length: number,
): Buffer | undefined {
  let fd: number | undefined
  try {
    fd = internals.open(`/proc/${pid}/mem`)
    const buffer = Buffer.alloc(length)
    const count = internals.read(fd, buffer, length, address)
    return buffer.subarray(0, count)
  } catch (_unreadableProcessMemory) {
    return undefined
  } finally {
    if (fd !== undefined) internals.close(fd)
  }
}

/** fd_set 的起始字节奇偶性表示 fd 0（stdin）是否在集合中。 */
function fdSetHasStdin(internals: ProcessInspectorInternals, pid: number, address: number): boolean {
  return address !== 0 && (readMemory(internals, pid, address, 8)?.[0] ?? 0) % 2 === 1
}

/** 扫描 pollfd 数组：是否存在"事件为 0 且含 POLLIN（0x001）"的条目（即等待 stdin）。 */
function pollHasStdin(
  internals: ProcessInspectorInternals,
  pid: number,
  address: number,
  count: number,
): boolean {
  if (address === 0 || count <= 0) return false
  const memory = readMemory(internals, pid, address, Math.min(count, 1024) * 8)
  if (memory === undefined) return false
  for (let offset = 0; offset + 8 <= memory.length; offset += 8) {
    if (memory.readInt32LE(offset) === 0 && (memory.readInt16LE(offset + 4) & 0x001) !== 0) return true
  }
  return false
}

/** 从 epoll 的 fdinfo 中判断 fd 0（stdin）是否被注册。 */
function epollHasStdin(internals: ProcessInspectorInternals, pid: number, epfd: number): boolean {
  try {
    return internals.readFile(`/proc/${pid}/fdinfo/${epfd}`)
      .split('\n')
      .some(line => /^tfd:\s+0\b/.test(line.trim()))
  } catch (_unreadableFdInfo) {
    return false
  }
}

/** 各架构的"读 stdin 相关系统调用号"表（x64 与 arm64；未知架构不支持判断）。 */
interface SyscallTable {
  read: number
  select?: number
  pselect: number
  poll?: number
  ppoll: number
  epollWait?: number
  epollPwait: number
}

const SYSCALLS: Partial<Record<NodeJS.Architecture, SyscallTable>> = {
  x64: { read: 0, select: 23, pselect: 270, poll: 7, ppoll: 271, epollWait: 232, epollPwait: 281 },
  arm64: { read: 63, pselect: 72, ppoll: 73, epollPwait: 22 },
}

/** 判定一个被阻塞的系统调用是否在等待 stdin（read fd 0 / select/poll/epoll 含 fd 0）。 */
function syscallWaitsOnStdin(
  internals: ProcessInspectorInternals,
  pid: number,
  syscall: SyscallInfo,
  table: SyscallTable,
): boolean {
  const [a0 = 0, a1 = 0, a2 = 0] = syscall.args
  if (syscall.number === table.read) return a0 === 0
  if (syscall.number === table.select || syscall.number === table.pselect) {
    return a0 >= 1 && fdSetHasStdin(internals, pid, a1)
  }
  if (syscall.number === table.poll || syscall.number === table.ppoll) {
    return a1 >= 1 && pollHasStdin(internals, pid, a0, a1)
  }
  if (syscall.number === table.epollWait || syscall.number === table.epollPwait) {
    return a2 >= 1 && epollHasStdin(internals, pid, a0)
  }
  return false
}

/** POSIX 平台检查器的公共基类：信号按负进程组 id 投递，进程级信号先校验存活。 */
abstract class PosixProcessInspector implements ProcessInspector {
  constructor(protected readonly internals: ProcessInspectorInternals) {}

  abstract foregroundPgid(shellPid: number): number | undefined
  abstract isStdinWaiting(pgid: number): boolean
  abstract processTree(rootPid: number): ProcessIdentity[]
  abstract processSession(sessionId: number): ProcessIdentity[]
  abstract isAlive(identity: ProcessIdentity): boolean

  /** 向整个进程组发信号（负 pgid）。 */
  signalGroup(pgid: number, signal: SubprocessTerminalSignal): void {
    this.internals.kill(-pgid, signal)
  }

  /** 向单个进程发信号；进程已不在（身份失配）时静默跳过。 */
  signalProcess(identity: ProcessIdentity, signal: 'SIGTERM' | 'SIGKILL'): void {
    if (this.isAlive(identity)) this.internals.kill(identity.pid, signal)
  }
}

/** 进程树节点：在 ProcessIdentity 基础上带父进程 pid。 */
interface ProcessTreeEntry extends ProcessIdentity {
  parentPid: number
}

/** 从全表构建进程树并做子先序（children-first）遍历，返回根与全部传递后代。 */
function processTree(entries: ProcessTreeEntry[], rootPid: number): ProcessIdentity[] {
  const byPid = new Map(entries.map(entry => [entry.pid, entry]))
  const root = byPid.get(rootPid)
  if (root === undefined) return []
  const byParent = new Map<number, ProcessTreeEntry[]>()
  for (const entry of entries) {
    const children = byParent.get(entry.parentPid) ?? []
    children.push(entry)
    byParent.set(entry.parentPid, children)
  }
  const visited = new Set<number>()
  const result: ProcessIdentity[] = []
  const visit = (entry: ProcessTreeEntry): void => {
    if (visited.has(entry.pid)) return
    visited.add(entry.pid)
    for (const child of byParent.get(entry.pid) ?? []) visit(child)
    result.push({ pid: entry.pid, started: entry.started })
  }
  visit(root)
  return result
}

/** Linux 检查器：前台组取 shell 的 tpgid；stdin 等待经 /proc 系统调用与内存探测。 */
class LinuxProcessInspector extends PosixProcessInspector {
  constructor(
    private readonly arch: NodeJS.Architecture,
    internals: ProcessInspectorInternals,
  ) {
    super(internals)
  }

  foregroundPgid(shellPid: number): number | undefined {
    const tpgid = readLinuxStat(this.internals, shellPid)?.tpgid
    return tpgid !== undefined && tpgid > 0 ? tpgid : undefined
  }

  /** 扫描 /proc：组内任一线程阻塞在读 stdin 的系统调用上即视为等待输入。 */
  isStdinWaiting(pgid: number): boolean {
    const table = SYSCALLS[this.arch]
    if (table === undefined) return false
    for (const pid of numericEntries(this.internals, '/proc')) {
      if (readLinuxStat(this.internals, pid)?.pgrp !== pgid) continue
      for (const tid of numericEntries(this.internals, `/proc/${pid}/task`)) {
        const syscall = readSyscall(this.internals, pid, tid)
        if (syscall !== undefined && syscallWaitsOnStdin(this.internals, pid, syscall, table)) return true
      }
    }
    return false
  }

  processTree(rootPid: number): ProcessIdentity[] {
    const entries = numericEntries(this.internals, '/proc').flatMap((pid) => {
      const stat = readLinuxStat(this.internals, pid)
      return stat === undefined ? [] : [{ pid, parentPid: stat.parentPid, started: stat.started }]
    })
    return processTree(entries, rootPid)
  }

  processSession(sessionId: number): ProcessIdentity[] {
    return numericEntries(this.internals, '/proc').flatMap((pid) => {
      const stat = readLinuxStat(this.internals, pid)
      return stat?.session === sessionId ? [{ pid, started: stat.started }] : []
    })
  }

  isAlive(identity: ProcessIdentity): boolean {
    const stat = readLinuxStat(this.internals, identity.pid)
    return stat?.started === identity.started && !/^[ZXx]$/.test(stat.state)
  }

}

interface PsEntry extends ProcessTreeEntry {}

/** 经 /bin/ps 读取 macOS 进程表（pid/ppid/启动时间三元组）。 */
function macProcessTable(internals: ProcessInspectorInternals): PsEntry[] {
  return internals.exec('/bin/ps', ['-axo', 'pid=,ppid=,lstart=']).split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return []
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), started: match[3] }]
  })
}

/** macOS 检查器：经 /bin/ps 做进程树与存活判断；无 stdin 等待探测（返回 false）。 */
class MacProcessInspector extends PosixProcessInspector {
  foregroundPgid(shellPid: number): number | undefined {
    try {
      const value = Number(this.internals.exec('/bin/ps', ['-o', 'tpgid=', '-p', String(shellPid)]).trim())
      return Number.isSafeInteger(value) && value > 0 ? value : undefined
    } catch (_missingProcess) {
      return undefined
    }
  }

  isStdinWaiting(_pgid: number): boolean {
    return false
  }

  processTree(rootPid: number): ProcessIdentity[] {
    return processTree(macProcessTable(this.internals), rootPid)
  }

  processSession(_sessionId: number): ProcessIdentity[] {
    return []
  }

  isAlive(identity: ProcessIdentity): boolean {
    return macProcessTable(this.internals).some(entry => entry.pid === identity.pid && entry.started === identity.started)
  }

}

/**
 * Create the supported platform inspector or fail at plugin load.
 * @param platform - target Node platform.
 * @param arch - target CPU architecture for Linux syscall numbers.
 * @param internals - filesystem/process boundary, injectable for deterministic tests.
 * @returns Platform process inspector.
 */
/*
 * 创建受支持平台的进程检查器，或在插件加载时响亮失败（不支持的平台直接抛错）。
 * @param platform 目标 Node 平台
 * @param arch Linux 系统调用号所需的 CPU 架构
 * @param internals 文件系统/进程边界，可注入以获得确定性测试
 * @returns 平台进程检查器
 */
export function createProcessInspector(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  internals: ProcessInspectorInternals = DEFAULT_INTERNALS,
): ProcessInspector {
  if (platform === 'linux') return new LinuxProcessInspector(arch, internals)
  if (platform === 'darwin') return new MacProcessInspector(internals)
  if (platform === 'win32') return createWindowsProcessInspector()
  throw new Error(`subprocess-local: terminal inspection is unsupported on platform ${platform}`)
}
