/**
 * 文件职责：验证 loader-smoke.spec.ts 覆盖的快照与装载测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的快照与装载测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：变量 configPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const configPath = '/tmp/fixture.cordis.yml'
/** 中文说明：变量 tsconfigPath 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
/** 中文说明：函数值 fixture 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.ts`, import.meta.url))
// macOS realpaths temp dirs into /private; TMPDIR may live under /var or /tmp.
/** 中文说明：函数值 canonicalTempPath 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const canonicalTempPath = (path: string): string => path.replace(/^\/private(?=\/(?:var|tmp)\/)/, '')

describe('runLoaderSmoke', () => {
  it('isolates the process, closes stdin, captures output, and removes the cwd', async () => {
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await runLoaderSmoke({
      label: 'success fixture',
      tempDirPrefix: 'loader-smoke-success-',
      binScript: fixture('success'),
      configPath,
      tsconfigPath,
      mode: 'src',
      env: { LOADER_SMOKE_MARKER: 'present' },
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = JSON.parse(result.stdout) as {
      configPath: string
      args: string[]
      cwd: string
      dshHome: string
      agentsHome: string
      marker: string
      input: string
    }
    expect(output).toMatchObject({
      configPath,
      args: [configPath],
      marker: 'present',
      input: '',
    })
    expect(canonicalTempPath(output.dshHome)).toBe(canonicalTempPath(join(output.cwd, '.dsh')))
    expect(canonicalTempPath(output.agentsHome)).toBe(canonicalTempPath(join(output.cwd, '.agents')))
    expect(result.stderr).toContain('fixture stderr')
    expect(existsSync(output.cwd)).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('passes an arbitrary bin argv and inspects world state before cleanup', async () => {
    /** 中文说明：变量 inspected 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let inspected = ''
    /** 中文说明：变量 marker 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let marker = ''
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = await runLoaderSmoke({
      label: 'argv fixture',
      tempDirPrefix: 'loader-smoke-argv-',
      binScript: fixture('success'),
      libBinScript: fixture('success'),
      configPath,
      binArgs: ['--config', configPath, '--output-format', 'json', 'task with spaces'],
      tsconfigPath,
      prepare: cwd => writeFile(join(cwd, 'marker.txt'), 'prepared'),
      inspect: async (cwd) => {
        inspected = cwd
        marker = await readFile(join(cwd, 'marker.txt'), 'utf8')
      },
    })
    /** 中文说明：变量 output 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const output = JSON.parse(result.stdout) as { args: string[]; cwd: string }
    expect(output.args).toEqual(['--config', configPath, '--output-format', 'json', 'task with spaces'])
    expect(canonicalTempPath(inspected)).toBe(canonicalTempPath(output.cwd))
    expect(marker).toBe('prepared')
    expect(existsSync(inspected)).toBe(false)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('rejects a non-zero exit with captured diagnostics', async () => {
    await expect(runLoaderSmoke({
      label: 'failure fixture',
      tempDirPrefix: 'loader-smoke-fail-',
      binScript: fixture('fail'),
      libBinScript: fixture('fail'),
      configPath,
      tsconfigPath,
    })).rejects.toThrow('failure fixture exited 7 (expected 0). stdout:\n\nstderr:\nfixture failed')
  })

  it('accepts a declared expected failure exit and rejects any other outcome', async () => {
    // A scenario pinning a designed failure surface declares its exit code…
    /** 中文说明：变量 declared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const declared = await runLoaderSmoke({
      label: 'declared failure fixture',
      tempDirPrefix: 'loader-smoke-declared-fail-',
      binScript: fixture('fail'),
      libBinScript: fixture('fail'),
      configPath,
      tsconfigPath,
      expectedExitCode: 7,
    })
    expect(declared.stderr).toBe('fixture failed\n')

    // …and a run that succeeds instead still fails the smoke.
    await expect(runLoaderSmoke({
      label: 'unexpectedly clean fixture',
      tempDirPrefix: 'loader-smoke-clean-',
      binScript: fixture('success'),
      libBinScript: fixture('success'),
      configPath,
      tsconfigPath,
      expectedExitCode: 7,
    })).rejects.toThrow(/exited 0 \(expected 7\)/)
  })

  it('kills a process at its deadline and reports captured output', async () => {
    await expect(runLoaderSmoke({
      label: 'hanging fixture',
      tempDirPrefix: 'loader-smoke-hang-',
      binScript: fixture('hang'),
      libBinScript: fixture('hang'),
      configPath,
      tsconfigPath,
      processTimeoutMs: 100,
    })).rejects.toThrow('hanging fixture did not exit within 0.1s.')
  })
})
