/**
 * ================================ 文件注释 ================================
 * 【文件职责】native 后端 Linux 选择器二进制的 PATH 探针：为解析器提供一次启动
 * 时采样的事实——有值守的 Linux 宿主若没有 zenity/kdialog，就保留可用的 browse
 * 交互，而不是一个每次拾取都失败的后端。
 * 【技术维度】accessSync(X_OK) 判可执行；按 PATH 分隔符逐目录扫描两个候选二
 * 进制；可执行性判定可注入（生产用 canExecute，测试用确定性谓词）。
 * 【产品维度】自适应目录选择器的决策输入之一：Linux 上是否有原生选择器可用。
 * 【逻辑维度】候选二进制表 → canExecute（判单个候选）→ hasLinuxChooserBinary
 * （扫 PATH）。
 * 【关键边界】PATH 缺失/空值则什么都不扫；只认可执行文件（不存在或不可执行
 * 均返回 false）。
 * 【新手阅读建议】与 resolve.ts 的决策逻辑对照阅读。
 * ==========================================================================
 */
/**
 * PATH probe for the native backend's Linux chooser binaries: one boot-time
 * sampled fact for the resolver, so an attended Linux host without
 * zenity/kdialog keeps the working `browse` interaction instead of a backend
 * whose every pick fails.
 * @module @deepseek-ai/dsh-host-directory-picker-auto/probe
 */

import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** The chooser binaries the native backend can drive on Linux (zenity, KDialog fallback). */
// native 后端在 Linux 上可驱动的选择器二进制（zenity，kdialog 兜底）。
const LINUX_CHOOSER_BINARIES = ['zenity', 'kdialog'] as const

/**
 * Whether the current process may execute the candidate path.
 * @param candidate - absolute or PATH-joined file path.
 * @returns true only for an existing executable file.
 */
// 判当前进程能否执行候选路径：仅当存在且可执行时为 true。
export function canExecute(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
  } catch {
    // Absent or non-executable candidate — the only signals accessSync(X_OK) emits.
    return false
  }
  return true
}

/**
 * Scan a PATH value for one of the native backend's Linux chooser binaries.
 * @param pathValue - the `PATH` environment value (absent or empty scans nothing).
 * @param isExecutable - executability predicate ({@link canExecute} in production; injected for deterministic tests).
 * @returns whether any PATH directory holds an executable chooser binary.
 */
// 扫描 PATH 值寻找 native 后端的 Linux 选择器二进制：任一目录中有可执行候选
// 即返回 true。
export function hasLinuxChooserBinary(pathValue: string | undefined, isExecutable: (candidate: string) => boolean): boolean {
  for (const dir of (pathValue ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of LINUX_CHOOSER_BINARIES) {
      if (isExecutable(join(dir, name))) return true
    }
  }
  return false
}
