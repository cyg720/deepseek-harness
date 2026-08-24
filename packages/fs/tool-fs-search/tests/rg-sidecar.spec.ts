import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 提升到 mock 初始化前的依赖 rg 路径和 existsSync 替身。
const { dependencyRgPath, existsSync } = vi.hoisted(() => ({
  dependencyRgPath: '/node_modules/@vscode/ripgrep/bin/rg',
  existsSync: vi.fn(),
}))

// 保留真实 node:fs 其余导出，只替换 existsSync。
vi.mock('node:fs', async (importOriginal) => {
  // node:fs 真实模块。
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync }
})

// 模拟 @vscode/ripgrep 暴露固定依赖二进制路径。
vi.mock('@vscode/ripgrep', () => ({ rgPath: dependencyRgPath }))

// 每例前清空模块缓存、mock 调用和 process.pkg。
beforeEach(() => {
  vi.resetModules()
  existsSync.mockReset()
  Reflect.deleteProperty(process, 'pkg')
})

// 每例后再次删除 process.pkg，防止失败路径泄漏环境。
afterEach(() => {
  Reflect.deleteProperty(process, 'pkg')
})

// ripgrep 路径解析测试套件。
describe('ripgrep resolution', () => {
  // 验证打包运行时且 sidecar 存在时选择当前 exe-rg。
  it('uses the native sidecar beside the current executable', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    existsSync.mockReturnValue(true)
    // 当前可执行文件旁的 sidecar 候选路径。
    const sidecar = `${process.execPath}-rg`
    // 动态导入的解析函数，读取本例 process.pkg/mock 状态。
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(sidecar)
    expect(existsSync).toHaveBeenCalledWith(sidecar)
  })

  // 验证普通 Node 直接使用依赖路径且不探测 sidecar。
  it('uses the dependency binary in an ordinary Node process', async () => {
    existsSync.mockReturnValue(true)
    // 本例动态导入的解析函数。
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
    expect(existsSync).not.toHaveBeenCalled()
  })

  // 验证打包运行时 sidecar 缺失时回退依赖路径。
  it('uses the dependency binary when a packaged runtime has no sidecar', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    existsSync.mockReturnValue(false)
    // 本例动态导入的解析函数。
    const { resolveRgPath } = await import('@deepseek-ai/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
    expect(existsSync).toHaveBeenCalledWith(`${process.execPath}-rg`)
  })
})
/**
 * 文件职责：验证打包运行时优先选择可执行文件旁的 ripgrep sidecar，普通 Node 或缺 sidecar 时使用依赖二进制。
 * 技术维度：使用 Vitest hoisted mock、动态模块导入和 process.pkg 属性模拟打包环境。
 * 产品维度：保证单文件可执行发行版使用随附 rg，同时开发安装继续使用 @vscode/ripgrep。
 * 逻辑维度：每例重置模块/mock；分别模拟 sidecar 存在、普通 Node、打包但 sidecar 缺失三种路径。
 * 关键边界：process.pkg 是打包运行时标志且测试后必须删除；动态 import 确保每例重新解析。
 * 新手阅读建议：先看 hoisted 与两个 vi.mock，再读 before/after 清理，最后比较三种 existsSync 期望。
 */
