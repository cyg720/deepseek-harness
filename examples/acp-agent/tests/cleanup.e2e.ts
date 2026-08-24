/** Regression coverage for ACP example teardown. */
/**
 * 文件职责：验证 ACP 示例清理器即使进程关闭失败也会删除工作区，并能汇总双重失败。
 * 技术维度：使用 Vitest mock、临时目录和 AggregateError 检查异步清理路径。
 * 产品维度：避免自动化示例失败后泄漏临时文件，同时保留所有清理诊断。
 * 逻辑维度：afterEach 兜底删除；第一例模拟关闭失败但目录删除成功，第二例同时制造目录删除失败。
 * 关键边界：fallbackWorkdir 只保存 mkdtemp 返回路径；NUL 路径专用于稳定触发文件系统错误。
 * 新手阅读建议：先看 afterEach，再比较两个用例中 closeFailure、spawned 和最终错误结构。
 */

import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupAcpExampleTest } from './cleanup.ts'

// 需要测试后兜底删除的临时工作区；清理成功后恢复 undefined。
let fallbackWorkdir: string | undefined

// 后置清理钩子，防止失败断言留下临时目录。
afterEach(async () => {
  if (fallbackWorkdir !== undefined) await rm(fallbackWorkdir, { recursive: true, force: true })
  fallbackWorkdir = undefined
})

// ACP 示例清理函数测试套件。
describe('cleanupAcpExampleTest', () => {
  // 验证关闭失败不会阻止工作区删除，并将关闭错误向上报告。
  it('removes the workspace after process shutdown fails', async () => {
    fallbackWorkdir = await mkdtemp(join(tmpdir(), 'acp-cleanup-'))
    // 模拟的进程关闭错误。
    const closeFailure = new Error('close failed')
    // 只实现 close 的进程替身，调用时拒绝 closeFailure。
    const spawned = { close: vi.fn().mockRejectedValue(closeFailure) }

    await expect(cleanupAcpExampleTest(spawned, fallbackWorkdir))
      .rejects.toMatchObject({ errors: [closeFailure] })
    await expect(access(fallbackWorkdir)).rejects.toThrow()
    fallbackWorkdir = undefined
  })

  // 验证进程关闭和工作区删除错误同时保存在 AggregateError 中。
  it('reports process and workspace failures together', async () => {
    // 第一项预期错误：关闭进程失败。
    const closeFailure = new Error('close failed')
    // 拒绝关闭的进程替身。
    const spawned = { close: vi.fn().mockRejectedValue(closeFailure) }

    // 捕获的清理失败；NUL 路径还会触发文件系统删除错误。
    const failure = await cleanupAcpExampleTest(spawned, '\0').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toHaveLength(2)
    expect((failure as AggregateError).errors[0]).toBe(closeFailure)
  })
})
