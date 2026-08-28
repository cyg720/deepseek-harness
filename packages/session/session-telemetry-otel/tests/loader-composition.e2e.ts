/**
 * REAL-composition tier: boot the examples-owned telemetry Loader fixture as
 * a subprocess (per testing policy, through the same app/boot path a
 * deployment uses), run one mocked-model turn with a real bash round trip,
 * and assert against what the mock OTLP collector actually received on the
 * wire: ledger mirroring, the deployment-mounted redact rule applied to the
 * exported copy, ops markers, and the untouched canonical log.
 */
/*
 * 文件职责：验证 loader-composition.e2e.ts 覆盖的会话遥测行为、持久化与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、事件日志、SQLite 或 OpenTelemetry。
 * 产品维度：保障 Agent 的会话遥测状态稳定、可重放且可诊断。
 * 逻辑维度：准备或解析会话数据，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：持久化和遥测输入不可信；敏感数据必须脱敏；事件与数据库资源必须正确收尾。
 * 新手阅读建议：先看数据类型和辅助函数，再读写入/投影主流程，最后关注恢复、脱敏和失败场景。
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const driver = fileURLToPath(new URL(
  './fixtures/driver.ts',
  import.meta.url,
))
/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = fileURLToPath(new URL(
  './fixtures/cordis.yml',
  import.meta.url,
))
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** 中文说明：常量 FIXTURE_SECRET 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURE_SECRET = 'sk-e2efixture1234567890'
/** 中文说明：常量 FIXTURE_PLACEHOLDER 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURE_PLACEHOLDER = '[E2E-REDACTED]'

/** 中文说明：interface OtlpLogRecord 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
interface OtlpLogRecord {
  attributes?: { key: string; value: Record<string, unknown> }[]
  body?: unknown
}

/** 中文说明：interface OtlpCapture 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
interface OtlpCapture {
  resourceLogs: {
    scopeLogs: {
      scope: { name: string }
      logRecords: OtlpLogRecord[]
    }[]
  }[]
}

/** 中文说明：interface FixtureOutput 定义本测试所需的数据或行为，用于表达会话遥测场景。 */
interface FixtureOutput {
  captures: OtlpCapture[]
  logContent: string
}

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

/** 中文说明：函数 readFixtureOutput 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function readFixtureOutput(cwd: string): Promise<FixtureOutput> {
  /** 中文说明：变量 captures 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const captures = JSON.parse(await readFile(join(cwd, 'otlp-captures.json'), 'utf8')) as OtlpCapture[]
  /** 中文说明：变量 logs 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const logs = await jsonlFiles(join(cwd, '.sessions'))
  expect(logs).toHaveLength(1)
  return { captures, logContent: await readFile(logs[0] as string, 'utf8') }
}

/** 中文说明：函数 allRecords 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function allRecords(captures: OtlpCapture[]) {
  return captures.flatMap(capture => capture.resourceLogs.flatMap(resource =>
    resource.scopeLogs.flatMap(scoped => scoped.logRecords.map(record => ({ scope: scoped.scope.name, record })))))
}

/** 中文说明：函数 eventTypes 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function eventTypes(captures: OtlpCapture[]): string[] {
  return allRecords(captures).flatMap(({ record }) =>
    record.attributes?.flatMap(attribute =>
      attribute.key === 'event.type' && typeof attribute.value['stringValue'] === 'string'
        ? [attribute.value['stringValue']]
        : []) ?? [])
}

describe('session-telemetry-otel through a real headless cordis.yml', () => {
  it('exports redacted ledger records to the collector while the canonical log keeps the secret', async () => {
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let output!: FixtureOutput
    const { stderr } = await runLoaderSmoke({
      label: 'session-telemetry-otel loader smoke',
      tempDirPrefix: 'telemetry-otel-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      inspect: async (cwd) => { output = await readFixtureOutput(cwd) },
    })
    expect(stderr).not.toContain('UNHANDLED')

    /** 中文说明：变量 records 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const records = allRecords(output.captures)
    expect(records.length).toBeGreaterThan(0)

    /** 中文说明：变量 types 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const types = eventTypes(output.captures)
    /** 中文说明：该循环依次处理会话数据；循环变量仅在当前循环中有效。 */
    for (const expected of ['turn/start', 'user/message', 'tool/call', 'tool/result', 'assistant/message', 'turn/end']) {
      expect(types, expected).toContain(expected)
    }
    expect(records.some(({ scope }) => scope.endsWith('/ops'))).toBe(true)

    // The deployment-mounted rule on the wire: the fixture credential never
    // leaves the process, its surrounding prose does, and the placeholder
    // marks the spot — the seam itself ships no rules.
    /** 中文说明：变量 wire 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wire = JSON.stringify(output.captures)
    expect(wire).not.toContain(FIXTURE_SECRET)
    expect(wire).toContain(FIXTURE_PLACEHOLDER)
    expect(wire).toContain('prove telemetry with key')

    // The canonical session log is never rewritten.
    expect(output.logContent).toContain(FIXTURE_SECRET)
    expect(output.logContent).not.toContain(FIXTURE_PLACEHOLDER)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('exports only prefixes ending in feedback under feedback-only mode', async () => {
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let output!: FixtureOutput
    const { stderr } = await runLoaderSmoke({
      label: 'session-telemetry-otel feedback-only loader smoke',
      tempDirPrefix: 'telemetry-otel-feedback-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { DSH_TELEMETRY_E2E_MODE: 'FEEDBACK_ONLY' },
      inspect: async (cwd) => { output = await readFixtureOutput(cwd) },
    })
    expect(stderr).not.toContain('UNHANDLED')

    /** 中文说明：变量 wire 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wire = JSON.stringify(output.captures)
    expect(eventTypes(output.captures)).toContain('feedback/record')
    expect(wire).toContain('fixture feedback')
    expect(wire).toContain('prove telemetry with key')
    expect(wire).not.toContain('post-feedback private suffix')
    expect(output.logContent).toContain('post-feedback private suffix')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('keeps disabled feedback local and prints the stable warning', async () => {
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let output!: FixtureOutput
    const { stdout } = await runLoaderSmoke({
      label: 'session-telemetry-otel disabled loader smoke',
      tempDirPrefix: 'telemetry-otel-disabled-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { DSH_TELEMETRY_E2E_MODE: 'DISABLED' },
      inspect: async (cwd) => { output = await readFixtureOutput(cwd) },
    })

    expect(output.captures).toEqual([])
    expect(output.logContent).toContain('fixture feedback')
    expect(stdout.match(/session telemetry is DISABLED; nothing will be shared and this feedback remains local/)?.[0])
      .toMatchInlineSnapshot('"session telemetry is DISABLED; nothing will be shared and this feedback remains local"')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
