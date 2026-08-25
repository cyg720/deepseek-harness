/**
 * 文件职责：验证 loader-composition.e2e.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/**
 * Keyless REAL-composition coverage for parent-session cwd inheritance: a
 * test-only cordis.yml boots the headless app through the Loader with the ACP
 * backend's `cwd` omitted, a scripted model delegates once, and the scripted
 * mock ACP child echoes where it actually ran plus the workspace it was
 * announced — both must be the parent session's cwd. Mock-only composition, so
 * only this keyless tier applies (the with-key tier lives in subagent-acp.e2e.ts).
 */

/** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const driver = fileURLToPath(new URL(
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-acp/driver.ts',
  import.meta.url,
))
/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = fileURLToPath(new URL(
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-acp/cordis.yml',
  import.meta.url,
))
/** 中文说明：变量 mockServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const mockServer = fileURLToPath(new URL('./mock-acp-server.ts', import.meta.url))
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** 中文说明：函数 jsonlFiles 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function jsonlFiles(dir: string): Promise<string[]> {
  /** 中文说明：变量 entries 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const entries = await readdir(dir, { withFileTypes: true })
  /** 中文说明：函数值 paths 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const paths = await Promise.all(entries.map(async (entry) => {
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return jsonlFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return paths.flat()
}

describe('ACP subagent cwd inheritance through a real cordis.yml', () => {
  it('runs the child in the parent session workspace and announces it as the ACP session cwd', async () => {
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let events: SessionEvent[] = []
    /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let workspace = ''
    const { stderr } = await runLoaderSmoke({
      label: 'acp-subagent cwd composition smoke',
      tempDirPrefix: 'acp-subagent-cwd-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { DSH_TEST_MOCK_ACP_SERVER: mockServer },
      inspect: async (cwd) => {
        // The child reports realpaths; canonicalize the temp workspace to match.
        workspace = realpathSync(cwd)
        /** 中文说明：变量 logs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const logs = await jsonlFiles(join(cwd, '.sessions'))
        expect(logs).toHaveLength(1)
        /** 中文说明：变量 lines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const lines = (await readFile(logs[0] as string, 'utf8')).trimEnd().split('\n')
        events = lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    // The tool result carries the child's two-line echo: its real process.cwd()
    // and the cwd the backend announced in `session/new` — both the parent
    // session's workspace, never the harness process's launch directory.
    /** 中文说明：函数值 results 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    /** 中文说明：变量 resultText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resultText = results[0]!.data.message.content[0].content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(resultText).toBe(`${workspace}\n${workspace}`)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
