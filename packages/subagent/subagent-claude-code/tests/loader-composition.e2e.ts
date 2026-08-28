/**
 * 文件职责：验证 loader-composition.e2e.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOADER_SMOKE_TEST_TIMEOUT_MS,
  runLoaderSmoke,
} from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：变量 fixtureDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const fixtureDir = fileURLToPath(new URL(
  './fixtures/loader/',
  import.meta.url,
))
/** 中文说明：变量 driver 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const driver = join(fixtureDir, 'driver.ts')
/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = join(fixtureDir, 'cordis.yml')
/** 中文说明：变量 packageDir 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const packageDir = fileURLToPath(new URL('..', import.meta.url))
/** 中文说明：变量 manifest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
/** 中文说明：变量 bundlePatch 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const bundlePatch = manifest.dsh?.bundle?.patch
if (bundlePatch === undefined) throw new Error('Claude Code package must declare a Bundle patch')
/** 中文说明：变量 bundlePatchPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const bundlePatchPath = join(packageDir, bundlePatch)
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('product-provider public Loader composition', () => {
  it('loads the Bundle default, two named Claude instances, their tools, and Codex without starting either product', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'product-provider Loader composition',
      tempDirPrefix: 'dsh-product-provider-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      binArgs: [configPath, bundlePatchPath],
      tsconfigPath: repoTsconfig,
      env: {
        // Loading the optional package must not probe or start a Claude binary.
        PATH: '',
      },
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      registeredProviders: ['claude-code', 'claude-primary', 'claude-secondary', 'codex'],
      providers: [
        {
          name: 'codex',
          capabilities: {
            agentOptions: false,
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
        {
          name: 'claude-code',
          capabilities: {
            agentOptions: false,
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
        {
          name: 'claude-primary',
          capabilities: {
            agentOptions: false,
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
        {
          name: 'claude-secondary',
          capabilities: {
            agentOptions: false,
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
      ],
      tools: [
        {
          name: 'subagent_codex',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
        {
          name: 'subagent_claude_code',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
        {
          name: 'subagent_claude_primary',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
        {
          name: 'subagent_claude_secondary',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
      ],
      jobTools: ['job_kill', 'job_list', 'job_output'],
      starts: 0,
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
