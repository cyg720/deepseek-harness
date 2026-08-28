/**
 * REAL-composition tier (packages/AGENTS.md): boot the examples-owned
 * tool-pwsh Loader fixture as a subprocess through the same app/boot path a
 * deployment uses, execute real foreground and background pwsh commands
 * through the tool registry, and assert the assembled model-visible surface:
 * schema, prompt section, and rendered results. Self-skips when no `pwsh`
 * executable exists (a CI accommodation for hosts without PowerShell).
 */
/*
 * 文件职责：验证 loader.spec.ts 覆盖的Shell 命令与沙箱行为、并发与异常场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、临时文件系统或受控子进程。
 * 产品维度：保障 Agent 的Shell 命令与沙箱能力稳定、安全且可诊断。
 * 逻辑维度：准备配置和测试资源，执行被测流程，再核对结果、错误与资源清理。
 * 关键边界：并发写入和进程退出可能竞态；敏感配置不得泄露；资源必须等待完全停止。
 * 新手阅读建议：先看夹具与平台条件，再读正常场景，最后关注并发、安全与失败路径。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'

// The probe follows the executor's own resolution (Program Files installs on
// Windows are found even when bare `pwsh` is not on PATH).
/** 中文说明：变量 hasPwsh 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const hasPwsh = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

/** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const driver = fileURLToPath(new URL(
  './fixtures/loader/driver.ts',
  import.meta.url,
))
/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = fileURLToPath(new URL(
  './fixtures/loader/cordis.yml',
  import.meta.url,
))
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

/** 中文说明：interface PwshLoaderReport 定义本测试所需的数据或行为，用于表达Shell 命令与沙箱场景。 */
interface PwshLoaderReport {
  schemaHasRunInBackground: boolean
  promptHasMarkerSection: boolean
  foregroundText: string
  backgroundText: string
}

describe.skipIf(!hasPwsh)('tool-pwsh through a real Loader composition', () => {
  // Self-hosted Windows runners reach ~40s for this smoke under the full
  // coverage load (measured on the 192-thread CI pool), against the
  // 30s default process deadline. Give the subprocess headroom so the
  // assembled boot completes instead of being SIGKILLed mid-load.
  const processTimeoutMs = 90_000
  it('registers the pwsh surface and renders real foreground and background results', async () => {
    /** 中文说明：变量 report 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let report: PwshLoaderReport | undefined
    const { stderr } = await runLoaderSmoke({
      label: 'tool-pwsh loader smoke',
      tempDirPrefix: 'tool-pwsh-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      processTimeoutMs,
      inspect: async (cwd) => {
        report = JSON.parse(await readFile(join(cwd, 'pwsh-loader-report.json'), 'utf8')) as PwshLoaderReport
      },
    })
    expect(stderr).not.toContain('UNHANDLED')
    expect(report).toBeDefined()
    expect(report).toMatchObject({
      schemaHasRunInBackground: true,
      promptHasMarkerSection: true,
    })
    expect(report?.foregroundText).toBe('loader-ok\n')
    expect(report?.backgroundText).toContain('loader-bg-ok')
    expect(report?.backgroundText).toContain('[status: completed, exit code: 0]')
    // 15s of vitest headroom past the subprocess deadline, mirroring
    // LOADER_SMOKE_TEST_TIMEOUT_MS's margin over its process window.
  }, processTimeoutMs + 15_000)
})
