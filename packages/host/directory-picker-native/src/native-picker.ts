/*
 * ================================ 文件注释 ================================
 * 【文件职责】native 后端能力背后的跨平台原生单目录选择器：按平台分派——
 * macOS 用 osascript 的 choose folder、Linux 用 Zenity（kdialog 兜底）、
 * Windows 用进程内 koffi 驱动的 IFileOpenDialog 子进程方案。
 * 【技术维度】全部经 runNativeCommand 执行（无 shell 注入）；平台事实可注入
 * 以便确定性测试；取消信号中止原生命令；用户取消（非错误）返回 null。
 * 【产品维度】操作者在宿主屏幕前时，系统原生目录选择器提供与桌面一致的选择
 * 体验。
 * 【逻辑维度】类型（runner/internals）→ 输出/错误辅助（outputPath、errorCode、
 * errorStderr、isMissingCommand、rethrowIfAborted）→ pickNativeDirectory 平台
 * 分派（darwin/win32/linux/其他）。
 * 【关键边界】darwin 的 -128/User canceled 与 linux 的退出码 1 都映射为 null
 * （取消）；linux 上 zenity 缺失（ENOENT）才尝试 kdialog，两者都缺则抛错提示
 * 安装；未支持平台抛错；Windows 用 koffi（安装保证其可用），无 PowerShell 兜底
 * 层。
 * 【新手阅读建议】先读 pickNativeDirectory 的平台分派，再逐个读辅助函数；最后
 * 对照 win32-dialog.ts 理解 Windows 的进程内对话框。
 * ==========================================================================
 */
/** Cross-platform native single-directory chooser behind the native backend's capability. */

import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { pickWin32Directory } from './win32-dialog.ts'

/** Testable command boundary; native implementations never invoke a shell. */
// 命令执行边界（可注入以便测试）；原生实现绝不经过 shell。
export type DirectoryPickerRunner = NativeCommandRunner

/** Injectable platform facts for deterministic adapter tests. */
// 可注入的平台事实：为确定性适配器测试提供平台/执行器/Windows 对话框覆盖。
export interface DirectoryPickerInternals {
  platform?: NodeJS.Platform
  run?: DirectoryPickerRunner
  /** Replaces the in-process Win32 dialog (`pickWin32Directory`) for deterministic tests. */
  pickWin32Dialog?: (signal: AbortSignal) => Promise<string | null>
}

/** 从子进程 stdout 提取所选路径：去尾部换行，空则视为取消（null）。 */
function outputPath(stdout: string): string | null {
  const path = stdout.replace(/[\r\n]+$/, '')
  return path === '' ? null : path
}

/** 提取子进程错误对象的 code（字符串或数字），否则 undefined。 */
function errorCode(error: unknown): string | number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

/** 提取子进程错误对象的 stderr 文本。 */
function errorStderr(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return ''
  const stderr = (error as { stderr?: unknown }).stderr
  return typeof stderr === 'string' ? stderr : ''
}

/** 判错误是否为"命令不存在"（ENOENT）。 */
function isMissingCommand(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

/** 信号已中断时原样重抛错误（把取消语义交给调用方处理）。 */
function rethrowIfAborted(signal: AbortSignal, error: unknown): void {
  if (signal.aborted) throw error
}

/**
 * Open the platform directory picker.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - Platform and runner hooks for deterministic tests.
 * @returns the selected path, or null when the user cancels.
 */
// 打开平台目录选择器：macOS osascript（取消 = -128/User canceled 或退出码 1
// 且 stderr 匹配则 null）；Windows 用 koffi 背书的 IFileOpenDialog 子进程方案
//（无兜底层，任何失败原样浮现）；Linux 先 Zenity（退出码 1 = 取消、ENOENT 才
// 落到 kdialog），两者都缺抛错提示安装；其余平台抛错。
export async function pickNativeDirectory(
  signal: AbortSignal,
  internals: DirectoryPickerInternals = {},
): Promise<string | null> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand

  if (platform === 'darwin') {
    try {
      const result = await run('osascript', [
        '-e', 'set selectedFolder to choose folder with prompt "Select Workspace Directory"',
        '-e', 'POSIX path of selectedFolder',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      if (!signal.aborted && errorCode(error) === 1
        && /(?:User canceled|-128)/i.test(errorStderr(error))) return null
      throw error
    }
  }

  if (platform === 'win32') {
    // The koffi-backed IFileOpenDialog child process — the modern picker with
    // per-monitor-v2 DPI and abort support. koffi is a packaged dependency
    // whose availability the install guarantees, so there is no fallback
    // tier: any failure surfaces as-is (no PowerShell fallback tier; see
    // .agents/notes/implemented/simplification/2026-08-04-drop-windows-powershell-picker-fallback.md).
    const pickDialog = internals.pickWin32Dialog ?? pickWin32Directory
    return await pickDialog(signal)
  }

  if (platform === 'linux') {
    try {
      const result = await run('zenity', [
        '--file-selection', '--directory', '--title=Select Workspace Directory',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (!isMissingCommand(error)) throw error
    }

    try {
      const result = await run('kdialog', [
        '--getexistingdirectory', '.', '--title', 'Select Workspace Directory',
      ], signal)
      return outputPath(result.stdout)
    } catch (error: unknown) {
      rethrowIfAborted(signal, error)
      if (errorCode(error) === 1) return null
      if (isMissingCommand(error)) {
        throw new Error('no supported native directory picker found (install zenity or kdialog)')
      }
      throw error
    }
  }

  throw new Error(`native directory picker is unsupported on ${platform}`)
}
