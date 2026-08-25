/**
 * Keyless REAL-composition coverage for parent-session cwd inheritance across
 * the SDK wire: a test-only cordis.yml boots the headless app through the
 * Loader with the SDK backend's `cwd` omitted, a scripted model delegates
 * once, and the child — a COMPLETE second harness runtime booted from its own
 * cordis.yml and driven over stdio JSON-RPC — echoes where it actually ran.
 * Both the parent's tool result and the child's own persisted session log
 * must carry the parent session's cwd. Mock-only composition, so only this
 * keyless tier applies (the with-key tier lives in subagent-sdk.e2e.ts).
 */
/**
 * 文件职责：验证 loader-composition.e2e.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { realpathSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type SessionEvent } from '@deepseek-ai/dsh-session'
import { resolveExampleLaunch, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：变量 fixtureDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureDir = new URL('../../../../examples/jsonrpc-agent/tests/fixtures/subagent/subagent-dsh-sdk/', import.meta.url)
/** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const driver = fileURLToPath(new URL('driver.ts', fixtureDir))
/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = fileURLToPath(new URL('cordis.yml', fixtureDir))
/** 中文说明：变量 childConfigPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const childConfigPath = fileURLToPath(new URL('child.cordis.yml', fixtureDir))
/** 中文说明：变量 runtimeBin 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const runtimeBin = fileURLToPath(new URL('../../../../packages/examples/jsonrpc-demo/src/bin.ts', import.meta.url))
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

/** 中文说明：函数 sessionEvents 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function sessionEvents(log: string): Promise<SessionEvent[]> {
  /** 中文说明：变量 lines 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lines = (await readFile(log, 'utf8')).trimEnd().split('\n')
  return lines.slice(1).map(line => JSON.parse(line) as SessionEvent)
}

describe('SDK subagent cwd inheritance through a real cordis.yml', () => {
  it('runs the child runtime in the parent session workspace', async () => {
    // The child launch honors the same src/lib mode as the driving harness,
    // per the shared example-launch resolver (testing policy forbids
    // hand-written `--import tsx` argv for example subprocesses).
    /** 中文说明：变量 childLaunch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const childLaunch = resolveExampleLaunch({
      srcBin: runtimeBin,
      configArgs: [childConfigPath],
      tsconfigPath: repoTsconfig,
    })

    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let events: SessionEvent[] = []
    /** 中文说明：变量 childEvents 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let childEvents: SessionEvent[] = []
    /** 中文说明：变量 workspace 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let workspace = ''
    const { stderr } = await runLoaderSmoke({
      label: 'dsh-sdk-subagent cwd composition smoke',
      tempDirPrefix: 'dsh-sdk-subagent-cwd-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      // Two complete harness runtimes boot in sequence (driver, then the SDK
      // child); from-source tsx boots under load need more than the default
      // 30s window.
      processTimeoutMs: 120_000,
      env: {
        DSH_TEST_CHILD_COMMAND: childLaunch.command,
        DSH_TEST_CHILD_ARGS: JSON.stringify(childLaunch.args),
        DSH_TEST_CHILD_ENV: JSON.stringify({
          ...Object.fromEntries(Object.entries(childLaunch.env).filter(([, value]) => value !== undefined)),
        }),
      },
      inspect: async (cwd) => {
        // The child reports realpaths; canonicalize the temp workspace to match.
        workspace = realpathSync(cwd)
        /** 中文说明：变量 parentLogs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const parentLogs = await jsonlFiles(join(cwd, '.sessions'))
        expect(parentLogs).toHaveLength(1)
        events = await sessionEvents(parentLogs[0] as string)
        // The child runtime persisted its own transcript in ITS cwd — which
        // must be the parent session's workspace for the inheritance to hold.
        /** 中文说明：变量 childLogs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const childLogs = await jsonlFiles(join(cwd, '.child-sessions'))
        expect(childLogs).toHaveLength(1)
        childEvents = await sessionEvents(childLogs[0] as string)
      },
    })
    expect(stderr).not.toContain('UNHANDLED')

    // The parent's tool result carries the child model's echo of its real
    // process.cwd() — the parent session's workspace, never the harness
    // process's launch directory.
    /** 中文说明：函数值 results 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    /** 中文说明：变量 resultText 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resultText = results[0]!.data.message.content[0].content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(resultText).toBe(`child cwd: ${workspace}`)

    // The child ran a real turn of its own: user message in, assistant out.
    expect(childEvents.some(event => event.type === 'user/message')).toBe(true)
    /** 中文说明：函数值 childAnswers 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const childAnswers = childEvents.filter(event => event.type === 'assistant/message')
    expect(childAnswers.length).toBeGreaterThan(0)
    // 15s of vitest headroom past the subprocess deadline, mirroring
    // LOADER_SMOKE_TEST_TIMEOUT_MS's margin over the default window.
  }, 135_000)
})
