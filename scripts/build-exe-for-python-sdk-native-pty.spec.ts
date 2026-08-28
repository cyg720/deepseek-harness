import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveLinuxNodePtyAddon, resolveWindowsNodePtyAddons } from './build-exe-for-python-sdk-native-pty.ts'

// 测试创建的临时包根目录，供后置清理。
const roots: string[] = []

// 递归删除本轮全部受控临时根。
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Linux node-pty addon 解析测试套件。
describe('resolveLinuxNodePtyAddon', () => {
  // 验证 release workflow 的 build/Release 产物优先于 prebuild。
  it('prefers the manylinux build produced by the release workflow', () => {
    // 本用例临时包根。
    const root = temporaryPackage()
    // manylinux 构建产物路径。
    const built = createAddon(root, 'build', 'Release', 'pty.node')
    createAddon(root, 'prebuilds', 'linux-x64', 'pty.node')

    expect(resolveLinuxNodePtyAddon(root, 'x64')).toBe(built)
  })

  // 验证普通 beta 安装使用目标架构 prebuild。
  it('uses the target prebuild after an ordinary beta install', () => {
    // 临时包根与 arm64 prebuild 路径。
    const root = temporaryPackage()
    const prebuilt = createAddon(root, 'prebuilds', 'linux-arm64', 'pty.node')

    expect(resolveLinuxNodePtyAddon(root, 'arm64')).toBe(prebuilt)
  })

  // 验证两个位置均缺失时诊断完整列出它们。
  it('reports both expected locations when no addon is installed', () => {
    // 不创建任何 addon 的临时包根。
    const root = temporaryPackage()

    expect(() => resolveLinuxNodePtyAddon(root, 'x64')).toThrow(
      `node-pty addon is absent from both ${join(root, 'build', 'Release', 'pty.node')} and ${join(root, 'prebuilds', 'linux-x64', 'pty.node')}`,
    )
  })
})

describe('resolveWindowsNodePtyAddons', () => {
  it('requires both ConPTY addons from the x64 prebuild', () => {
    const root = temporaryPackage()
    const conpty = createAddon(root, 'prebuilds', 'win32-x64', 'conpty.node')
    const consoleList = createAddon(root, 'prebuilds', 'win32-x64', 'conpty_console_list.node')

    expect(resolveWindowsNodePtyAddons(root, 'x64')).toEqual([conpty, consoleList])
  })

  it('names every missing Windows addon', () => {
    const root = temporaryPackage()

    expect(() => resolveWindowsNodePtyAddons(root, 'x64')).toThrow(
      `Windows node-pty addons are missing: ${join(root, 'prebuilds', 'win32-x64', 'conpty.node')}, ${join(root, 'prebuilds', 'win32-x64', 'conpty_console_list.node')}`,
    )
  })
})

function temporaryPackage(): string {
  // 随机临时包根。
  const root = mkdtempSync(join(tmpdir(), 'dsh-node-pty-addon-'))
  roots.push(root)
  return root
}

/** 创建空 addon 文件。@param root 包根。@param segments 相对路径片段。@returns 文件路径。@example createAddon(root, 'build', 'pty.node')。 */
function createAddon(root: string, ...segments: string[]): string {
  // 由根和相对片段组成的 addon 路径。
  const path = join(root, ...segments)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
  return path
}
/**
 * 文件职责：验证 Python SDK 可执行文件构建时选择正确的 Linux node-pty 原生 addon。
 * 技术维度：使用 Vitest 和临时文件树模拟 release build、普通 prebuild 与缺失安装。
 * 产品维度：保证打包运行时优先使用发布工作流产物，并在缺失时给出两个精确候选路径。
 * 逻辑维度：每例创建临时包；前两例创建不同 addon 并断言选择，第三例断言缺失诊断；afterEach 清理。
 * 关键边界：只验证 Linux x64/arm64 路径选择；临时根均来自 mkdtempSync。
 * 新手阅读建议：先看 temporaryPackage/createAddon，再比较三个用例创建了哪些路径。
 */
