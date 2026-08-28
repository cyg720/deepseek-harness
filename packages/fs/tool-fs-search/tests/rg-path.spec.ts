/**
 * Failure-path tests for the lazy packaged-ripgrep resolution. The success
 * path (the real `@vscode/ripgrep` module) is exercised throughout
 * tools.spec.ts; here the module is mocked to throw at evaluation, proving a
 * missing or corrupt platform package (`--omit=optional`, partial install)
 * surfaces as a per-call `SEARCH_FAILED` — not a composition-load failure.
 */
/*
 * 文件职责：验证打包 ripgrep 缺失或损坏时惰性解析在搜索调用处报告 SEARCH_FAILED。
 * 技术维度：使用 Vitest 模块 mock、Proxy 抛错和最小 ToolExecution 运行真实 runRipgrep 路径。
 * 产品维度：避免可选平台包问题阻止整个应用装配，并给单次文件搜索明确错误。
 * 逻辑维度：mock 模块任意属性访问都失败；第一例执行搜索，第二例验证解析失败被记忆并持续拒绝。
 * 关键边界：解析在 spawn 前失败所以无需 subprocess 服务；错误必须每次稳定复现。
 * 新手阅读建议：先看 vi.mock 的 Proxy，再看 exec 最小字段，最后看 resolveRgPath 两次调用。
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { resolveRgPath, runRipgrep } from '@deepseek-ai/dsh-tool-fs-search'

// Any access to the mocked module's surface throws — the shape a missing
// platform package produces at module evaluation.
// 模拟平台包缺失时的模块求值行为：访问任意导出都会抛错。
vi.mock('@vscode/ripgrep', () => new Proxy({}, {
  /** 模拟属性读取失败。@returns 从不返回，始终抛出缺包错误。 */
  get() {
    throw new Error('platform package @vscode/ripgrep-win32-x64 is not installed')
  },
}))

// 惰性 ripgrep 解析失败测试套件。
describe('lazy packaged-ripgrep resolution', () => {
  // 验证首个搜索调用失败而模块本身仍可加载。
  it('fails the first search call with SEARCH_FAILED instead of failing module load', async () => {
    // The resolution rejects before any spawn, so no subprocess service is needed.
    // 解析在启动子进程前拒绝，因此无需装配 subprocess 服务。
    // 搜索调用的取消控制器。
    const controller = new AbortController()
    const exec = { signal: controller.signal, name: 'glob', callId: ToolCallId('missing-platform-package') } as unknown as ToolExecution

    await expect(runRipgrep(new Context(), exec, 'glob', ['--files'], 1_000_000, 3_000, 64 * 1024))
      .rejects.toMatchObject({ name: 'SearchError', code: 'SEARCH_FAILED' })
  })

  // 验证失败解析结果被记忆，后续调用继续拒绝同类错误。
  it('keeps failing every subsequent call (the resolution is memoized)', async () => {
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
    await expect(resolveRgPath()).rejects.toThrow(/platform package/)
  })
})
