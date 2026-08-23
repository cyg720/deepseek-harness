/**
 * ================================ 文件注释 ================================
 * 【文件职责】JSONL 后端的 Windows 持久命名空间助手：在 Node 无法 fsync 父目录的
 *   平台上，用原生 MoveFileExW(MOVEFILE_WRITE_THROUGH) 实现"目录/文件的 durable
 *   发布"，保证崩溃后命名项仍然存在。
 * 【技术维度】通过 Koffi FFI 惰性加载 kernel32.dll 的 MoveFileExW/GetLastError；
 *   每个缺失目录先建成随机暂存兄弟目录再写透移动到最终名；扩展长度路径
 *   （\\?\ 前缀）规避 MAX_PATH；Win32 错误码手工映射为 Node errno。
 * 【产品维度】Windows 用户与会话日志同样获得"断电不丢"的持久化承诺，
 *   与 POSIX 路径的行为保持一致。
 * 【逻辑维度】按代码顺序：①FFI 类型与 Win32 错误码常量；②惰性加载 win32()；
 *   ③errnoCode 映射与 win32Error 构造；④assertDirectory 探测；
 *   ⑤publishNewFileWin32 发布单文件；⑥ensureDurableDirectoryWin32 逐层建目录、
 *   createLeafDirectoryWin32 处理并发创建竞争。
 * 【关键边界】发布语义是"目标必须不存在 + 不允许跨卷复制回退"；仅 Windows
 *   进程会真正加载 Koffi（惰性导入）；与另一创建者竞争时只有确认赢家是目录
 *   才接受，否则照常报错。
 * 【新手阅读建议】先读文件头英文注释理解"为什么 Windows 需要另一条路"，
 * 再看 ensureDurableDirectoryWin32 的逐层循环，最后看错误码映射表即可。
 * ==========================================================================
 */
/**
 * Windows durable namespace helpers for the JSONL backend.
 *
 * POSIX publishes a newly-created log by creating a directory entry and then
 * fsyncing the parent directory. Windows does not expose that parent-directory
 * fsync contract through Node, so the Windows path uses the native durable
 * namespace primitive instead: create a staging object in the target directory
 * and publish it with `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` without
 * replacement or cross-volume copy fallback.
 *
 * @module dsh-session-persistence-jsonl/win32
 */
/**
 * 【中文导读】上面英文说明：POSIX 靠"建目录项 + fsync 父目录"实现持久发布；
 * Windows 没有等价接口，这里改用原生写透移动原语完成同一目标。
 */

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join, parse, resolve, toNamespacedPath } from 'node:path'

/** 【中文】kernel32!MoveFileExW 的 FFI 签名：返回非 0 表示成功。 */
type MoveFileExW = (existing: string, replacement: string, flags: number) => number
/** 【中文】kernel32!GetLastError 的 FFI 签名：取最近一次调用的错误码。 */
type GetLastError = () => number

/** 【中文】已加载的原生绑定集合（进程内缓存）。 */
interface Win32Bindings {
  moveFileExW: MoveFileExW
  getLastError: GetLastError
}

/** 【中文】带 Win32 扩展字段的错误对象（win32Code 原生码、dest 目标路径）。 */
interface Win32ErrnoException extends NodeJS.ErrnoException {
  win32Code: number
  dest: string
}

/** 【中文】MOVEFILE_WRITE_THROUGH：移动操作写透到底层存储才算完成（崩溃持久）。 */
const MOVEFILE_WRITE_THROUGH = 0x00000008
/** 【中文】ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND → ENOENT。 */
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
/** 【中文】ERROR_ACCESS_DENIED → EACCES。 */
const ERROR_ACCESS_DENIED = 5
/** 【中文】ERROR_NOT_SAME_DEVICE → EXDEV（跨卷，未启用复制回退时拒绝）。 */
const ERROR_NOT_SAME_DEVICE = 17
/** 【中文】ERROR_FILE_EXISTS / ERROR_ALREADY_EXISTS → EEXIST。 */
const ERROR_FILE_EXISTS = 80
/** 【中文】ERROR_INVALID_NAME → EINVAL。 */
const ERROR_INVALID_NAME = 123
const ERROR_ALREADY_EXISTS = 183

/** 【中文】模块级缓存：首次加载后复用，避免重复加载 DLL。 */
let bindings: Win32Bindings | undefined

/** Load the small Win32 API lazily so non-Windows processes never load Koffi. */
/**
 * 【中文】惰性加载 kernel32 绑定：只有 Windows 路径真正被走到时才 import Koffi，
 * 非 Windows 进程永远不加载它。
 * @returns 可用的 MoveFileExW / GetLastError 绑定。
 */
async function win32(): Promise<Win32Bindings> {
  if (bindings !== undefined) return bindings
  const koffi = (await import('koffi')).default
  const kernel32 = koffi.load('kernel32.dll')
  bindings = {
    moveFileExW: kernel32.func('__stdcall', 'MoveFileExW', 'int', ['str16', 'str16', 'uint']) as MoveFileExW,
    getLastError: kernel32.func('__stdcall', 'GetLastError', 'uint', []) as GetLastError,
  }
  return bindings
}

/** 【中文】把 Win32 原生错误码映射为 Node 风格 errno 字符串；未知码归为 EIO。 */
function errnoCode(win32Code: number): string {
  switch (win32Code) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return 'ENOENT'
    case ERROR_ACCESS_DENIED:
      return 'EACCES'
    case ERROR_NOT_SAME_DEVICE:
      return 'EXDEV'
    case ERROR_FILE_EXISTS:
    case ERROR_ALREADY_EXISTS:
      return 'EEXIST'
    case ERROR_INVALID_NAME:
      return 'EINVAL'
    default:
      return 'EIO'
  }
}

/** 【中文】构造带完整上下文的错误对象：Node errno、原生码、系统调用名与两个路径。 */
function win32Error(syscall: string, win32Code: number, path: string, dest: string): Win32ErrnoException {
  const code = errnoCode(win32Code)
  const error = new Error(`${syscall} ${code} (Win32 ${win32Code}): ${path} -> ${dest}`) as Win32ErrnoException
  error.code = code
  error.errno = win32Code
  error.syscall = syscall
  error.path = path
  error.dest = dest
  error.win32Code = win32Code
  return error
}

/** 【中文】与 index.ts 同名的本地 ENOENT 判断助手。 */
function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** 【中文】与 index.ts 同名的本地 EEXIST 判断助手。 */
function isEEXIST(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

/**
 * 【中文】探测路径是否为已存在的目录：是返回 true；不存在（ENOENT）返回 false；
 * 存在但不是目录则抛 ENOTDIR。裸盘根用原路径探测（Node 拒绝其扩展长度拼写），
 * 其余路径加 \\?\ 前缀以支持超长路径探测。
 * @param path - 待探测路径。
 * @returns 是目录 true；不存在 false。
 */
async function assertDirectory(path: string): Promise<boolean> {
  try {
    // A bare drive root is already short, and Node rejects its extended-length
    // spelling as EISDIR. Descendants retain the namespace for long-path probes.
    // 裸盘根本身就很短，Node 会把它的扩展长度拼写拒为 EISDIR；
    // 其余后代路径保留命名空间前缀以探测超长路径。
    const probe = path === parse(path).root ? path : toNamespacedPath(path)
    const info = await stat(probe)
    if (info.isDirectory()) return true
    const error = new Error(`path exists but is not a directory: ${path}`) as NodeJS.ErrnoException
    error.code = 'ENOTDIR'
    error.path = path
    throw error
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
}

/**
 * Publish `existing` at `replacement` with Windows write-through rename
 * semantics. The destination must not already exist; the move must stay within
 * the volume (no copy fallback flag is set).
 * @param existing - the synced staging path to move.
 * @param replacement - the final path, which must not already exist.
 */
/**
 * 【中文】以 Windows 写透移动语义把 existing 发布为 replacement：目标必须不存在
 *（未设置替换标志）、移动必须留在同一卷（未设置复制回退标志），完成后对崩溃
 * 持久。失败时按 GetLastError 构造带 errno 的错误。
 * @param existing - 已 fsync 的暂存路径。
 * @param replacement - 最终路径，必须尚不存在。
 */
export async function publishNewFileWin32(existing: string, replacement: string): Promise<void> {
  const api = await win32()
  const ok = api.moveFileExW(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH)
  if (ok === 0) throw win32Error('MoveFileExW', api.getLastError(), existing, replacement)
}

/**
 * Create `target` and its missing ancestors with durable Windows namespace
 * publication. Each missing directory is first created as a random staging
 * sibling, then moved to its final name with `MOVEFILE_WRITE_THROUGH`; races
 * with another creator are accepted only after verifying the winner is a
 * directory.
 * @param target - the absolute directory path to create durably when absent.
 */
/**
 * 【中文】持久地创建 target 及其缺失的各级祖先目录：先探测盘根，再逐段下探，
 * 缺失的每层都经 createLeafDirectoryWin32 以"暂存 + 写透移动"方式发布。
 * @param target - 需要确保存在的绝对目录路径。
 */
export async function ensureDurableDirectoryWin32(target: string): Promise<void> {
  const absolute = resolve(target)
  const root = parse(absolute).root
  await assertDirectory(root)

  const segments = absolute.slice(root.length).split(/[\\/]+/).filter(part => part.length > 0)
  let current = root
  for (const segment of segments) {
    const next = join(current, segment)
    if (!await assertDirectory(next)) await createLeafDirectoryWin32(current, next)
    current = next
  }
}

/**
 * 【中文】在 parent 下创建单个叶子目录：先 mkdtemp 一个随机暂存兄弟目录（本身
 * 已是真实目录），再写透移动到最终名。若与另一创建者竞争得到 EEXIST，只有确认
 * 赢家确实是目录才视为成功；否则清理暂存并照常抛错。
 * @param parent - 父目录。
 * @param target - 目标叶子目录完整路径。
 */
async function createLeafDirectoryWin32(parent: string, target: string): Promise<void> {
  // Keep the staging component independent of the target basename so a legal
  // 255-byte target component does not make mkdtemp's sibling name too long.
  // 暂存名与目标名解耦：合法但很长的目标组件不会把 mkdtemp 的兄弟名撑爆。
  const staging = await mkdtemp(toNamespacedPath(join(parent, '.dsh-mkdir-')))
  try {
    await publishNewFileWin32(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    // 并发创建竞争：对方先发布成功且确为目录 → 接受；否则原样上抛。
    if (isEEXIST(error) && await assertDirectory(target)) return
    throw error
  }
}
