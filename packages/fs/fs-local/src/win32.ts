/**
 * ================================ 文件注释 ================================
 * 【文件职责】Windows 安全描述符（ACL/DACL）助手，服务于本地文件的原子替换：
 * 读取既有文件的 DACL、把受保护的 DACL 拷到暂存文件、用 ReplaceFileW 完成
 * "保留被替换文件 ACL 等元数据"的替换。
 * 【技术维度】用 Koffi（FFI 绑定库）懒加载 advapi32.dll / kernel32.dll 的 Win32
 * API：GetFileSecurityW / SetFileSecurityW / ReplaceFileW / GetLastError；
 * 非 Windows 进程从不打开 Win32 库（懒加载保证）。路径先经 toNamespacedPath
 * 转成 Win32 命名空间路径（\\?\ 前缀，绕过长路径与相对路径问题）。
 * 【产品维度】保证 Windows 上原子写不丢失原文件的 ACL：新文件先继承目录 DACL，
 * 替换时把原文件 DACL 复制到暂存文件并加上"禁止继承"保护，再用 ReplaceFileW
 * 提交，避免机密文件在暂存阶段暴露。
 * 【逻辑维度】按出现顺序：Win32 函数类型别名 → 绑定接口 → 错误常量 → 懒加载
 * win32() → errnoCode（Win32 错误码 → Node errno 码）→ win32Error（构造结构化
 * 错误）→ readFileDaclWin32 → copyFileDaclWin32 → replaceFileWin32。
 * 【关键边界】DACL 拷贝只保护机密性于"目标仍为空"的暂存期；ReplaceFileW 失败时
 * 若目标已消失（ENOENT）退回普通 rename；错误统一带 win32Code 供诊断。
 * 【新手阅读建议】先看 win32() 理解 Koffi 懒加载，再看三个导出函数理解
 * "读 DACL → 拷 DACL → 替换"的完整链条。
 * ==========================================================================
 */
/**
 * Windows security-descriptor helpers for atomic local-file replacement. Koffi loads lazily so
 * non-Windows processes never open Win32 libraries.
 * @module @deepseek-ai/dsh-fs-local/win32
 */
/**
 * 模块总览：本文件只在 Windows 上被使用（fsio.ts 的平台分支），且只在写入/替换
 * 文件时需要保留安全语义时才调用这些 API。
 */

import { toNamespacedPath } from 'node:path'

// 以下四个类型别名描述 Koffi 绑定出的 Win32 API 函数签名（__stdcall 调用约定）。
type GetFileSecurityW = (
  path: string,
  requestedInformation: number,
  descriptor: Buffer | null,
  length: number,
  needed: [number],
) => number
type SetFileSecurityW = (path: string, securityInformation: number, descriptor: Buffer) => number
type ReplaceFileW = (
  replaced: string,
  replacement: string,
  backup: null,
  flags: number,
  exclude: null,
  reserved: null,
) => number
type GetLastError = () => number

// 一次懒加载后缓存的 Win32 绑定集合。
interface Win32Bindings {
  getFileSecurityW: GetFileSecurityW
  setFileSecurityW: SetFileSecurityW
  replaceFileW: ReplaceFileW
  getLastError: GetLastError
}

// 带 Win32 原始错误码的结构化异常（供诊断与测试断言）。
interface Win32ErrnoException extends NodeJS.ErrnoException {
  win32Code: number
}

// DACL 安全信息标志：0x00000004 表示"只操作 DACL"，0x80000000 表示"禁止从父目录继承"。
const DACL_SECURITY_INFORMATION = 0x00000004
const PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
const ERROR_ACCESS_DENIED = 5

// 绑定缓存：首次调用 win32() 时填充。
let bindings: Win32Bindings | undefined

// 懒加载并缓存 Koffi 绑定：只有真正需要 Win32 API 时才会动态 import koffi。
async function win32(): Promise<Win32Bindings> {
  if (bindings !== undefined) return bindings
  const koffi = (await import('koffi')).default
  const advapi32 = koffi.load('advapi32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  bindings = {
    getFileSecurityW: advapi32.func('int __stdcall GetFileSecurityW(const char16_t *path, uint32_t requested, void *descriptor, uint32_t length, _Out_ uint32_t *needed)') as GetFileSecurityW,
    setFileSecurityW: advapi32.func('int __stdcall SetFileSecurityW(const char16_t *path, uint32_t information, const void *descriptor)') as SetFileSecurityW,
    replaceFileW: kernel32.func('int __stdcall ReplaceFileW(const char16_t *replaced, const char16_t *replacement, const char16_t *backup, uint32_t flags, void *exclude, void *reserved)') as ReplaceFileW,
    getLastError: kernel32.func('uint32_t __stdcall GetLastError()') as GetLastError,
  }
  return bindings
}

// 把 Win32 错误码翻译成 Node 的 errno 码（ENOENT/EACCES/EIO），供统一错误处理。
function errnoCode(win32Code: number): string {
  switch (win32Code) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return 'ENOENT'
    case ERROR_ACCESS_DENIED:
      return 'EACCES'
    default:
      return 'EIO'
  }
}

// 构造 Win32 风格的结构化错误：code/errno/syscall/path 齐全，并带上原始 win32Code。
function win32Error(syscall: string, win32Code: number, path: string): Win32ErrnoException {
  const code = errnoCode(win32Code)
  const error = new Error(`${syscall} ${code} (Win32 ${win32Code}): ${path}`) as Win32ErrnoException
  error.code = code
  error.errno = win32Code
  error.syscall = syscall
  error.path = path
  error.win32Code = win32Code
  return error
}

/**
 * Read a file's self-relative DACL security descriptor.
 * @param path - existing file whose DACL is read.
 * @returns a descriptor buffer accepted by `SetFileSecurityW`.
 */
/**
 * 读取文件的"自相对 DACL 安全描述符"。先查所需缓冲区大小（传入 null/0），
 * 再分配缓冲区真正读取；失败抛带 win32Code 的错误。
 * @param path 要读取 DACL 的既有文件。
 * @returns 可直接交给 SetFileSecurityW 的描述符缓冲区。
 */
export async function readFileDaclWin32(path: string): Promise<Buffer> {
  const api = await win32()
  const nativePath = toNamespacedPath(path)
  const needed: [number] = [0]
  api.getFileSecurityW(nativePath, DACL_SECURITY_INFORMATION, null, 0, needed)
  if (needed[0] === 0) throw win32Error('GetFileSecurityW', api.getLastError(), path)

  const descriptor = Buffer.alloc(needed[0])
  if (api.getFileSecurityW(nativePath, DACL_SECURITY_INFORMATION, descriptor, descriptor.length, needed) === 0) {
    throw win32Error('GetFileSecurityW', api.getLastError(), path)
  }
  return descriptor.subarray(0, needed[0])
}

/**
 * Copy an existing file's DACL onto another file and protect it from staging-parent inheritance.
 * The destination must still be empty when confidentiality depends on this call.
 * @param source - existing file whose DACL is copied.
 * @param destination - existing file that receives the protected DACL.
 */
/**
 * 把既有文件的 DACL 复制到另一个文件，并加上"禁止从暂存父目录继承"保护。
 * 若机密性依赖本调用，目标文件此刻必须仍为空（尚未写入内容）。
 * @param source 提供 DACL 的既有文件。
 * @param destination 接收受保护 DACL 的文件（暂存文件）。
 */
export async function copyFileDaclWin32(source: string, destination: string): Promise<void> {
  const descriptor = await readFileDaclWin32(source)
  const api = await win32()
  const information = (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION) >>> 0
  if (api.setFileSecurityW(toNamespacedPath(destination), information, descriptor) === 0) {
    throw win32Error('SetFileSecurityW', api.getLastError(), destination)
  }
}

/**
 * Replace a Windows file while preserving the replaced file's ACL and other replace metadata.
 * @param replaced - existing destination file.
 * @param replacement - closed staging file on the same volume.
 */
/**
 * 替换 Windows 文件并保留被替换文件的 ACL 及其它替换元数据。
 * @param replaced 既有的目标文件。
 * @param replacement 同卷上已关闭的暂存文件。
 */
export async function replaceFileWin32(replaced: string, replacement: string): Promise<void> {
  const api = await win32()
  if (api.replaceFileW(
    toNamespacedPath(replaced),
    toNamespacedPath(replacement),
    null,
    0,
    null,
    null,
  ) === 0) {
    throw win32Error('ReplaceFileW', api.getLastError(), replaced)
  }
}
