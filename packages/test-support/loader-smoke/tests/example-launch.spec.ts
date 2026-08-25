/**
 * 文件职责：验证 example-launch.spec.ts 覆盖的快照与装载测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的快照与装载测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXAMPLE_MODE_ENV,
  resolveExampleLaunch,
  resolveExampleMode,
} from '@deepseek-ai/dsh-loader-smoke'

/** 中文说明：常量 SRC_BIN 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SRC_BIN = '/repo/packages/examples/acp-demo/src/bin.ts'
/** 中文说明：常量 TSCONFIG 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const TSCONFIG = '/repo/tsconfig.json'

/** 中文说明：变量 originalMode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const originalMode = process.env[EXAMPLE_MODE_ENV]
afterEach(() => {
  if (originalMode === undefined) Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
  else process.env[EXAMPLE_MODE_ENV] = originalMode
})

describe('resolveExampleMode', () => {
  it('defaults absent/empty/src to src', () => {
    Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
    expect(resolveExampleMode()).toBe('src')
    expect(resolveExampleMode('')).toBe('src')
    expect(resolveExampleMode('src')).toBe('src')
  })

  it('accepts lib', () => {
    expect(resolveExampleMode('lib')).toBe('lib')
  })

  it('throws on any other value', () => {
    expect(() => resolveExampleMode('prod')).toThrow(/must be 'src' or 'lib'/)
  })

  it('reads the environment when no argument is given', () => {
    process.env[EXAMPLE_MODE_ENV] = 'lib'
    expect(resolveExampleMode()).toBe('lib')
    Reflect.deleteProperty(process.env, EXAMPLE_MODE_ENV)
    expect(resolveExampleMode()).toBe('src')
  })
})

describe('resolveExampleLaunch', () => {
  it('src mode: --import tsx on the source bin with the tsconfig paths env', () => {
    const { command, args, env } = resolveExampleLaunch({
      srcBin: SRC_BIN,
      configArgs: ['./cordis.yml'],
      mode: 'src',
      tsconfigPath: TSCONFIG,
    })
    expect(command).toBe(process.execPath)
    expect(args).toContain('--import')
    expect(args).toContain(SRC_BIN)
    expect(args[args.length - 1]).toBe('./cordis.yml')
    expect(env.TSX_TSCONFIG_PATH).toBe(TSCONFIG)
  })

  it('src mode: throws without a tsconfig path', () => {
    expect(() => resolveExampleLaunch({ srcBin: SRC_BIN, mode: 'src' })).toThrow(/needs tsconfigPath/)
  })

  it('lib mode: plain node on the derived lib bin, no tsx and no paths env', () => {
    const { args, env } = resolveExampleLaunch({
      srcBin: SRC_BIN,
      configArgs: ['--config', './cordis.yml'],
      mode: 'lib',
      env: { DSH_HOME: '/tmp/home' },
    })
    expect(args).not.toContain('--import')
    expect(args).toContain('/repo/packages/examples/acp-demo/lib/bin.js')
    expect(args.slice(-2)).toEqual(['--config', './cordis.yml'])
    expect(env.TSX_TSCONFIG_PATH).toBeUndefined()
    expect(env.DSH_HOME).toBe('/tmp/home')
  })

  it('lib mode: uses an explicit plain-Node bin when provided', () => {
    /** 中文说明：变量 fixture 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fixture = '/repo/fixture.ts'
    const { args } = resolveExampleLaunch({ srcBin: fixture, libBin: fixture, mode: 'lib' })
    expect(args).toContain(fixture)
  })

  it('lib mode: rewrites only the last /src/ segment', () => {
    const { args } = resolveExampleLaunch({
      srcBin: '/repo/src/packages/examples/acp-demo/src/bin.ts',
      mode: 'lib',
    })
    expect(args).toContain('/repo/src/packages/examples/acp-demo/lib/bin.js')
  })

  it('lib mode: derives the built bin from a Windows source path', () => {
    const { args } = resolveExampleLaunch({
      srcBin: String.raw`D:\repo\src\packages\examples\acp-demo\src\bin.ts`,
      mode: 'lib',
    })
    expect(args).toContain(String.raw`D:\repo\src\packages\examples\acp-demo\lib\bin.js`)
  })

  it('lib mode: throws when the bin has no /src/ segment', () => {
    expect(() => resolveExampleLaunch({ srcBin: '/repo/lib/bin.js', mode: 'lib' })).toThrow(/"\/src\/" segment/)
  })

  it('defaults the mode from the environment', () => {
    process.env[EXAMPLE_MODE_ENV] = 'lib'
    const { args } = resolveExampleLaunch({ srcBin: SRC_BIN })
    expect(args).toContain('/repo/packages/examples/acp-demo/lib/bin.js')
  })
})
