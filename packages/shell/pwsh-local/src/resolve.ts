/**
 * ================================ 文件注释 ================================
 * 【文件职责】PowerShell 可执行文件解析：枚举 Windows 上 pwsh 的常见安装位置并按顺序探测，
 * 产出执行器实际 spawn 的 pwsh 路径。刻意保持零依赖，让非包消费者（如仓库 vitest.config.ts
 * 里的覆盖率门探针）能与执行器及其测试套件共享同一份解析定义。
 * 【技术维度】纯函数模块：只使用 node:fs 的 lstatSync 与 node:path 的 join；所有探测输入
 * （env、platform）显式参数化，解析是输入的纯函数。
 * 【产品维度】Windows 用户体验：自动找到 PowerShell 7 安装（含 Microsoft Store 变体），
 * 找不到时回退到系统自带的 Windows PowerShell 5.1，避免"模型说 pwsh 不存在"的挫败感。
 * 【逻辑维度】candidatePwshPaths 按优先级构造候选列表（安装目录 → PATH 条目 → 5.1）→
 * candidateExists 逐个探测存在性 → resolvePwshPath 返回第一个存在的候选或裸 pwsh。
 * 【关键边界】lstat 不跟随重解析点，因此能看到 Store 应用的执行别名（stat 会撞上目标的
 * ACL 报 EACCES）；真实目录永远不会匹配；探测失败一律按"不可用"处理。
 * 【新手阅读建议】先看 candidatePwshPaths 的候选顺序（含 PATH 引号清理细节），
 * 再看 candidateExists 为何用 lstat 而非 stat，最后看 resolvePwshPath 的组装逻辑。
 * ==========================================================================
 */

/**
 * PowerShell executable resolution, dependency-free so non-package consumers
 * (the repository's coverage-gate probe in `vitest.config.ts`) can share the
 * ONE resolution definition with the executor and its suites — a probe that
 * resolved differently from the code under test could exempt a file whose
 * suites actually run.
 *
 * @module @deepseek-ai/dsh-pwsh-local/resolve
 */

import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Well-known Windows PowerShell install locations plus PATH entries, newest
 * first. Explicitly parameterized (env) so resolution is a pure function of
 * its inputs on every platform.
 * @param env - the environment to probe; defaults to the process environment.
 * @returns candidate `pwsh` executable paths in resolution order.
 */
/**
 * 枚举 pwsh 可执行文件的候选路径：Windows 的常见安装位置加上 PATH 条目，新的在前。
 * 显式以 env 为参数，使解析在任何平台上都是输入的纯函数（便于测试与复用）。
 * @param env 待探测的环境变量，缺省用进程环境
 * @returns 按解析顺序排列的候选 pwsh 路径
 */
export function candidatePwshPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  const candidates = [
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
  ]
  // Microsoft Store installs (and any user-added location) live on PATH;
  // entries may carry surrounding quotes from `setx`-style definitions.
  for (const entry of (env.PATH ?? '').split(';')) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed.length === 0) continue
    candidates.push(join(trimmed, 'pwsh.exe'))
  }
  // Windows PowerShell 5.1 remains the last-resort fallback on legacy hosts.
  candidates.push(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  return candidates
}

/**
 * Whether a candidate can be spawned. lstat opens the entry itself instead of
 * following reparse points, so it sees the Store app execution alias where
 * stat hits the target's ACL (EACCES); Node reports that alias as a symlink
 * on current releases and as a plain file on older ones, and CreateProcess
 * resolves either shape. A real directory never matches.
 */
/**
 * 判断候选路径是否可被 spawn：lstat 直接打开条目本身而不跟随重解析点，因此能"看见"
 * Store 应用的执行别名（stat 会命中目标 ACL 报 EACCES）。Node 当前版本把该别名报为
 * 符号链接、旧版本报为普通文件，CreateProcess 两种形状都能解析；真实目录永远不匹配。
 */
function candidateExists(candidate: string): boolean {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    // ENOENT (the candidate vanished between listing and probing) is the only
    // expected failure; any other error names an unspawnable path, so false
    // is the safe answer for it too.
    return false
  }
}

/**
 * Resolve the pwsh executable this executor spawns.
 * @param configured - an explicit `pwshPath` config value, trusted as-is.
 * @param env - the environment to probe on Windows; defaults to the process environment.
 * @param platform - the platform to resolve for; defaults to the process platform.
 * @returns the first existing well-known location on Windows (PowerShell 7
 *   install, a PATH entry such as the Microsoft Store install, then Windows
 *   PowerShell 5.1), else `pwsh` for PATH resolution.
 */
/**
 * 解析本执行器要 spawn 的 pwsh 可执行文件：Windows 上依次探测已知安装位置并返回第一个
 * 存在的（PowerShell 7 安装目录、PATH 条目如 Microsoft Store 安装、再退到 Windows
 * PowerShell 5.1），非 Windows 平台返回裸 `pwsh` 交给 PATH 解析。
 * @param configured 显式配置的 pwshPath，原样信任
 * @param env Windows 上待探测的环境变量，缺省用进程环境
 * @param platform 为哪个平台解析，缺省用进程平台
 * @returns 解析出的 pwsh 可执行路径
 */
export function resolvePwshPath(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (configured !== undefined && configured.length > 0) return configured
  if (platform === 'win32') {
    for (const candidate of candidatePwshPaths(env)) {
      if (candidateExists(candidate)) return candidate
    }
  }
  return 'pwsh'
}
