/**
 * ================================ 文件注释 ================================
 * 【文件职责】跨平台"用系统应用打开路径/文本文档"的原生实现，供本地 GUI 载体
 * 使用：macOS 用 open、Windows 用 PowerShell 的 Invoke-Item、Linux 用 xdg-open，
 * WSL 内则先用 wslpath 把路径翻译给 Windows 桌面。
 * 【技术维度】完全不经过 shell（避免注入）：通过 @deepseek-ai/dsh-native-command
 * 的 runNativeCommand 执行外部命令；平台事实（platform/osRelease/env/runner）
 * 可注入以便确定性测试；浏览器可渲染的文档优先交给默认浏览器。
 * 【产品维度】桌面宿主"打开路径/打开设置文档"按钮的后端实现：预设目录、设置
 * 文件等能一键调起本机应用；无桌面的 Linux 容器探测为不可用，界面退化为显示
 * 文本路径而非提供无效按钮。
 * 【逻辑维度】判断浏览器文档（BROWSER_DOCUMENTS）→ macOS 查 LaunchServices 找
 * 默认浏览器 → 按平台分派（darwin/win32/linux-WSL/linux）→ 统一入口
 * openNativePath / openNativeTextFile。
 * 【关键边界】支持性探测 canOpenNativePath：macOS/Windows 恒真，Linux 仅当 WSL
 * 或存在 DISPLAY/WAYLAND_DISPLAY；text-editor 意图绝不咨询浏览器；未支持平台抛错。
 * 【新手阅读建议】先看两个导出函数（openNativePath / openNativeTextFile），再读
 * openNativePathWithIntent 的平台分派，最后看 canOpenNativePath 的可用性判定。
 * ==========================================================================
 */
/**
 * Cross-platform native path and text-document openers used by the local GUI
 * carrier.
 *
 * The default intent prefers the default browser for documents it renders when
 * the platform can name one, then falls back to the default application. WSL
 * translates every path for the Windows desktop instead of assuming a Linux
 * GUI. The text-editor intent never consults the browser.
 */

import { release as osRelease } from 'node:os'
import { extname } from 'node:path'
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

/** Testable command boundary; native implementations never invoke a shell. */
// 命令执行边界（可注入以便测试）；原生实现绝不经过 shell。
export type PathOpenerRunner = NativeCommandRunner

/** Injectable platform facts for deterministic adapter tests. */
// 可注入的平台事实：为确定性适配器测试提供平台/内核版本/环境/执行器覆盖。
export interface PathOpenerInternals {
  platform?: NodeJS.Platform
  /** Kernel release override used to distinguish WSL from desktop Linux. */
  osRelease?: string
  /** Environment used for WSL markers and the desktop Linux browser convention. */
  env?: NodeJS.ProcessEnv
  run?: PathOpenerRunner
}

/** Documents a browser renders, as opposed to ones an editor merely edits. */
// 浏览器能渲染的文档扩展名集合：这类文件优先交给默认浏览器而非默认应用。
const BROWSER_DOCUMENTS = new Set(['.html', '.htm', '.xhtml', '.svg'])

/**
 * The macOS bundle registered for `https` — the default browser, as
 * LaunchServices records it. The nested version dict is stripped first
 * because it carries its own `LSHandlerRoleAll`.
 */
// 从 macOS LaunchServices 的 plist 文本中提取注册给 https 的默认浏览器 bundle：
// 先剥掉嵌套的版本字典（它自带一个 LSHandlerRoleAll，会干扰匹配）。
function macBundleForHttps(plist: string): string | undefined {
  const stripped = plist.replace(/LSHandlerPreferredVersions\s*=\s*\{[^}]*\};/g, '')
  const block = /\{[^{}]*LSHandlerURLScheme\s*=\s*"?https"?;[^{}]*\}/.exec(stripped)?.[0]
  if (block === undefined) return undefined
  return /LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?;/.exec(block)?.[1]
}

/**
 * Open one browser-renderable document with the default browser.
 * @returns true when a browser took it; false when this platform cannot name
 * one, or naming it failed — the caller then uses the default application.
 */
// 尝试用默认浏览器打开可渲染文档：macOS 查 LaunchServices 找默认浏览器 bundle，
// Linux 用 $BROWSER 惯例；返回 false 表示此平台无法命名浏览器，调用方改用默认应用。
async function openInBrowser(
  path: string, signal: AbortSignal, platform: NodeJS.Platform,
  run: PathOpenerRunner, env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (platform === 'darwin') {
    let bundle: string | undefined
    try {
      const { stdout } = await run(
        'defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure'], signal)
      bundle = macBundleForHttps(stdout)
    } catch {
      // No LaunchServices record (a fresh account never changed a default):
      // the content-type handler is then the system's own choice anyway.
      return false
    }
    if (bundle === undefined) return false
    await run('open', ['-b', bundle, path], signal)
    return true
  }
  if (platform === 'linux') {
    // $BROWSER is the portable convention; desktop-entry resolution through
    // xdg-settings needs a launcher this package has no business shipping.
    const browser = env.BROWSER
    if (browser === undefined || browser === '') return false
    await run(browser, [path], signal)
    return true
  }
  // Windows names no browser without reading the UserChoice registry, and its
  // .html association is the browser in the ordinary case.
  return false
}

/** Native path-open intent; macOS distinguishes text editing from file association. */
// 原生打开意图：default 按文件关联打开，text-editor 只做文本编辑（macOS 区别对待）。
type PathOpenIntent = 'default' | 'text-editor'

/** PowerShell single-quoted literal (doubles embedded quotes). */
// 生成 PowerShell 单引号字面量：内嵌单引号翻倍转义，保证路径安全。
function powershellLiteral(path: string): string {
  return `'${path.replace(/'/g, "''")}'`
}

/** Whether one environment marker is set to a non-empty value. */
// 环境标记是否被设置为非空值。
function present(value: string | undefined): boolean {
  return value !== undefined && value !== ''
}

/** Distinguish WSL from desktop Linux using its process and kernel markers. */
// 用进程环境标记（WSL_DISTRO_NAME / WSL_INTEROP）与内核版本（含 microsoft）区分
// WSL 与桌面 Linux。
function isWsl(internals: PathOpenerInternals): boolean {
  const env = internals.env ?? process.env
  if (present(env.WSL_DISTRO_NAME) || present(env.WSL_INTEROP)) return true
  return (internals.osRelease ?? osRelease()).toLowerCase().includes('microsoft')
}

/** Open one Windows-resolvable path through its registered desktop application. */
// 经注册的桌面应用打开 Windows 可解析路径：用 PowerShell 的 Invoke-Item（无 shell 注入）。
async function openWindowsPath(path: string, signal: AbortSignal, run: PathOpenerRunner): Promise<void> {
  await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Invoke-Item -LiteralPath ${powershellLiteral(path)}`,
  ], signal)
}

/** Translate a WSL path before handing it to the Windows desktop. */
// 把 WSL 路径翻译成 Windows 路径再交给桌面：wslpath -w 转写，空结果视为失败。
async function openWslPath(path: string, signal: AbortSignal, run: PathOpenerRunner): Promise<void> {
  const translated = await run('wslpath', ['-w', path], signal)
  signal.throwIfAborted()
  const windowsPath = translated.stdout.replace(/[\r\n]+$/, '')
  if (windowsPath === '') throw new Error('wslpath returned no Windows path')
  await openWindowsPath(windowsPath, signal, run)
}

/** Dispatch one shell-free platform command for the requested open intent. */
// 按请求的打开意图分派平台命令（全部无 shell）：浏览器文档优先给默认浏览器，
// 随后按平台走 open / Invoke-Item / xdg-open；WSL 内先翻译路径。
async function openNativePathWithIntent(
  path: string,
  signal: AbortSignal,
  intent: PathOpenIntent,
  internals: PathOpenerInternals = {},
): Promise<void> {
  const platform = internals.platform ?? process.platform
  const run = internals.run ?? runNativeCommand
  const env = internals.env ?? process.env
  const wsl = platform === 'linux' && isWsl(internals)

  if (!wsl && intent === 'default' && BROWSER_DOCUMENTS.has(extname(path).toLowerCase())
    && await openInBrowser(path, signal, platform, run, env)) return

  if (platform === 'darwin') {
    await run('open', intent === 'text-editor' ? ['-t', path] : [path], signal)
    return
  }

  if (platform === 'win32') {
    await openWindowsPath(path, signal, run)
    return
  }

  if (platform === 'linux') {
    if (wsl) {
      await openWslPath(path, signal, run)
      return
    }
    await run('xdg-open', [path], signal)
    return
  }

  throw new Error(`native path opener is unsupported on ${platform}`)
}

/**
 * Whether {@link openNativePath} plausibly reaches a desktop on this host.
 *
 * macOS and Windows always carry a desktop opener; Linux does when it is WSL
 * (the Windows desktop takes the path) or a display server is announced.
 * A headless or containerised Linux host answers false, which is what lets a
 * surface show a path as text instead of offering a button that would spawn
 * `xdg-open` into nothing.
 * @param internals - platform and environment seam for deterministic tests.
 * @returns true when handing a path to the native opener can work at all.
 */
// 探测本宿主是否真有桌面可打开路径：macOS/Windows 恒真，Linux 仅当是 WSL
// （Windows 桌面接单）或有显示服务器；无头/容器化 Linux 返回 false，让界面
// 把路径显示为文本而非提供会空转 xdg-open 的按钮。
export function canOpenNativePath(internals: PathOpenerInternals = {}): boolean {
  const platform = internals.platform ?? process.platform
  if (platform === 'darwin' || platform === 'win32') return true
  if (platform !== 'linux') return false
  const env = internals.env ?? process.env
  return isWsl(internals) || present(env.DISPLAY) || present(env.WAYLAND_DISPLAY)
}

/**
 * Open a filesystem path with the operating system's default application, or
 * with the default browser when the path names a document a browser renders.
 * @param path - absolute or host-resolvable path (caller owns resolution).
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - Platform, environment, and runner hooks for deterministic tests.
 */
// 公开入口：用默认应用打开路径（浏览器文档优先给默认浏览器）。
export function openNativePath(
  path: string,
  signal: AbortSignal,
  internals: PathOpenerInternals = {},
): Promise<void> {
  return openNativePathWithIntent(path, signal, 'default', internals)
}

/**
 * Open a text document for editing; macOS bypasses the file-type association
 * so a YAML association with a browser cannot consume the gesture.
 * @param path - absolute or host-resolvable text-document path.
 * @param signal - caller/connection lifetime; abort terminates the native command.
 * @param internals - Platform and runner hooks for deterministic tests.
 */
// 公开入口：用文本编辑器打开文档——macOS 上绕过文件类型关联（open -t），防止
// YAML 与浏览器关联时手势被浏览器吞掉。
export function openNativeTextFile(
  path: string,
  signal: AbortSignal,
  internals: PathOpenerInternals = {},
): Promise<void> {
  return openNativePathWithIntent(path, signal, 'text-editor', internals)
}
