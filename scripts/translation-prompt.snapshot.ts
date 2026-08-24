/** Runnable keyless snapshot for the assembled translation request and consumed response. */
/**
 * 文件职责：无密钥运行翻译提示装配器，并把请求与已记录响应和快照文件比较。
 * 技术维度：使用 Vitest、promisify(execFile)、文件系统 API 和文件快照断言启动真实脚本。
 * 产品维度：防止翻译示例、请求格式或响应消费逻辑意外漂移。
 * 逻辑维度：执行验证脚本并解析 stdout；记录模式写入期望文件，普通模式确认文件存在并比较。
 * 关键边界：stderr 必须为空，stdout 必须是 JSON；只有 DSH_SNAPSHOT=record/refresh 才允许更新快照。
 * 新手阅读建议：先看四个常量，再沿子进程输出、JSON 校验、记录分支和快照断言阅读。
 */

import { execFile } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// Promise 版本的 execFile，便于在测试中 await 子进程结果。
const execFileAsync = promisify(execFile)
// 仓库根目录，由当前 scripts 目录向上一级解析。
const root = resolve(import.meta.dirname, '..')
// 版本化请求响应期望快照的绝对路径。
const expected = join(root, 'scripts/snapshots/translation-prompt-v4/request-response.expected.json')
// 是否允许刷新快照；只接受 record 或 refresh 两个显式环境值。
const refreshing = process.env.DSH_SNAPSHOT === 'record' || process.env.DSH_SNAPSHOT === 'refresh'

// 翻译提示可运行快照测试套件。
describe('translation prompt runnable snapshot', () => {
  // 验证装配、记录响应消费和文件快照；异步返回 Promise<void>。
  it('assembles the reviewed examples and consumes a recorded new-pair response', async () => {
    // 子进程标准输出和错误输出；stdout 应为快照 JSON，stderr 必须为空。
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      join(root, 'scripts/verify-translation-prompt.ts'),
      '--snapshot',
    ], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
    expect(stderr).toBe('')
    expect(() => {
      JSON.parse(stdout)
    }).not.toThrow()
    if (refreshing) {
      await mkdir(dirname(expected), { recursive: true })
      await writeFile(expected, stdout)
    } else {
      await access(expected)
    }
    await expect(stdout).toMatchFileSnapshot(expected)
  })
})
