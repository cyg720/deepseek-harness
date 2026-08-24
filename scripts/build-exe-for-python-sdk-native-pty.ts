/** Resolve the native node-pty input used by the Python SDK runtime builder. */
/**
 * 文件职责：为 Python SDK 运行时可执行程序构建解析 Linux node-pty 原生插件路径。
 * 技术维度：使用 Node.js 文件存在检查和路径拼接，在工作流构建产物与依赖预构建物之间选择。
 * 产品维度：保证打包的 Python SDK 运行时包含目标架构可用的伪终端原生模块。
 * 逻辑维度：优先检查本次工作流编译的 pty.node，再检查目标架构预构建，均缺失则抛错。
 * 关键边界：arch 只允许 x64 或 arm64；函数不下载或编译插件，也不接受不存在的路径。
 * 新手阅读建议：按 built、prebuilt、throw 的优先顺序阅读，并对照构建工作流了解文件来源。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prefer the workflow's manylinux build and fall back to node-pty's target prebuild.
 * @param packageDirectory - installed node-pty package directory.
 * @param arch - Linux target architecture.
 * @returns the existing addon path.
 */
/**
 * 解析目标 Linux 架构现有的 node-pty 原生插件。
 * @param packageDirectory - 已安装 node-pty 包的目录。
 * @param arch - Linux 目标架构，仅允许 x64 或 arm64。
 * @returns 优先返回工作流编译产物，否则返回目标预构建插件路径。
 * @example resolveLinuxNodePtyAddon('/repo/node_modules/node-pty', 'x64')。
 */
export function resolveLinuxNodePtyAddon(
  packageDirectory: string,
  arch: 'x64' | 'arm64',
): string {
  // built：工作流在 node-pty 包内生成的 Release 原生插件路径，优先使用。
  const built = join(packageDirectory, 'build', 'Release', 'pty.node')
  if (existsSync(built)) return built
  // prebuilt：node-pty 随包提供的目标 Linux 架构预构建插件路径。
  const prebuilt = join(packageDirectory, 'prebuilds', `linux-${arch}`, 'pty.node')
  if (existsSync(prebuilt)) return prebuilt
  throw new Error(
    `build-exe-for-python-sdk: node-pty addon is absent from both ${built} and ${prebuilt}.`,
  )
}
