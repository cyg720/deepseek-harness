/**
 * 文件职责：验证 loader-composition.e2e.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
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
  '../../../../examples/acp-agent/tests/fixtures/subagent/subagent-codex/',
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
if (bundlePatch === undefined) throw new Error('Codex package must declare a Bundle patch')
/** 中文说明：变量 bundlePatchPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const bundlePatchPath = join(packageDir, bundlePatch)
/** 中文说明：变量 repoTsconfig 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

describe('Codex provider public Loader composition', () => {
  it('loads the Bundle default, two named instances, their tools, and job controls without starting Codex', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'subagent-codex Loader composition',
      tempDirPrefix: 'dsh-subagent-codex-loader-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      binArgs: [configPath, bundlePatchPath],
      tsconfigPath: repoTsconfig,
      env: {
        // Loading the optional package must not probe or start a Codex binary.
        PATH: '',
      },
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      providers: ['codex-primary', 'codex-secondary', 'codex'],
      providerDetails: [
        {
          name: 'codex',
          capabilities: {
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
        {
          name: 'codex-primary',
          capabilities: {
            outputSchema: false,
            depthLimit: false,
            toolFilter: false,
            persona: false,
          },
          inheritsParentContext: false,
        },
        {
          name: 'codex-secondary',
          capabilities: {
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
          name: 'subagent_codex_primary',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
        {
          name: 'subagent_codex_secondary',
          parameterNames: ['description', 'prompt', 'run_in_background'],
          required: ['description', 'prompt'],
        },
      ],
      jobTools: ['job_kill', 'job_list', 'job_output'],
      starts: 0,
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
