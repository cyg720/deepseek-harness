/**
 * 文件职责：无密钥启动真实 Headless Loader 树，执行 bash 往返并验证压缩会话持久化。
 * 技术维度：使用 Vitest、Loader smoke、Zstd 解压、stream-json 解析和真实工具链。
 * 产品维度：确保基础 Headless 示例无需外部 API 也能在 CI 验证启动、工具和会话存储路径。
 * 逻辑维度：运行固定驱动，检查临时目录的 zstd 日志头，解析 stdout 事件与结果，再断言工具和用量。
 * 关键边界：stderr 必须为空；持久文件必须是 Zstd；最后一行是结果而前面是事件。
 * 新手阅读建议：先看三个路径常量，再跟踪 runLoaderSmoke 的 inspect 回调，最后读 stdout 分段断言。
 */
import { readFile, readdir } from 'node:fs/promises'
import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 无密钥 smoke 使用的 Headless 驱动入口。 */
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
/** 注入确定性模型和工具的测试组合配置。 */
const configPath = fileURLToPath(new URL('./fixtures/cli.cordis.yml', import.meta.url))
/** 子进程源码启动所需的仓库 TypeScript 配置。 */
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
/** 把回调式 Zstd 解压转换为 Promise 的函数。 */
const decompress = promisify(zstdDecompress)

describe('headless-agent keyless smoke', () => {
  it('boots the real Loader tree, runs a real bash tool round trip, and persists the turn', async () => {
    let persistedHeader: Record<string, unknown> | undefined
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'headless-agent',
      tempDirPrefix: 'headless-agent-smoke-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'prove the tool path'],
      tsconfigPath,
      inspect: async (cwd) => {
        const files = await readdir(cwd, { recursive: true })
        const relativePath = files.find(file => file.endsWith('.jsonl.zstd'))
        if (relativePath === undefined) return
        const compressed = await readFile(join(cwd, relativePath))
        expect(compressed.subarray(0, 4).toString('hex')).toBe('28b52ffd')
        persistedHeader = JSON.parse((await decompress(compressed)).toString()) as Record<string, unknown>
      },
    })
    const lines = stdout.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const events = lines.slice(0, -1).map(line => line['event'] as SessionEvent)
    const result = lines.at(-1)
    expect(stderr).toBe('')
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'bash')).toBe(true)
    const toolResult = events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(toolResult)).toContain('CLI_TOOL_ROUND_TRIP')
    expect(result).toMatchObject({
      type: 'result',
      usage: { inputTokens: 18, outputTokens: 8, cacheReadTokens: 2, reasoningTokens: 1 },
    })
    expect(String(result?.['output'])).toContain('CLI_TOOL_ROUND_TRIP')
    expect(persistedHeader).toMatchObject({ type: 'session' })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
