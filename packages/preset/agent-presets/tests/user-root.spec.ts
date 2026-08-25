/**
 * The writable root is this package's own, not an assembly fact each app must
 * remember: a roster configured with only a `system` root still discovers and
 * authors into `<dshHome>/.agent-presets`, the way `dsh-skill-filesystem` owns
 * `<dshHome>/skills`. `includeUserRoot: false` is how a deployment — or a test
 * pinning an exact roster — opts out.
 *
 * `$DSH_HOME` is repointed per test because the derived root is resolved in the
 * constructor: the plugin must be mounted while the environment names the
 * temporary home, or it would reach the developer's real one.
 */
/*
 * 文件职责：验证 user-root.spec.ts 覆盖的 Agent 预设发现、装载与会话行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和临时配置目录。
 * 产品维度：保障用户选择的 Agent 预设能稳定生效并保持会话一致。
 * 逻辑维度：准备预设配置，装载插件，触发会话流程，再核对状态与错误。
 * 关键边界：配置来源和优先级必须明确；临时资源必须在用例结束时释放。
 * 新手阅读建议：先看夹具与辅助函数，再按发现、装载、会话顺序阅读用例。
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, { COMPOSITION_FILE, type Config } from '@deepseek-ai/dsh-agent-presets'

/** 中文说明：常量 FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** 中文说明：常量 SYSTEM_ROOT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SYSTEM_ROOT = join(FIXTURES, 'system')
/** Spelled out rather than imported: the convention is what these tests assert. */
/* 中文说明：常量 USER_ROOT_SEGMENT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const USER_ROOT_SEGMENT = '.agent-presets'
/** 中文说明：常量 VALID 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const VALID = '- id: tool-alpha\n  name: ../../plugins/contribute.js\n  config:\n    tool: alpha\n'

/** 中文说明：变量 home 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let home: string
/** 中文说明：变量 previousHome 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let previousHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-preset-home-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/** Boot a roster over the fixture system root, with the derived root left to the plugin. */
/* 中文说明：函数 roster 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function roster(config: Partial<Config> = {}): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [{ path: SYSTEM_ROOT, trust: 'system' as const }],
    includeUserRoot: true,
    ...config,
  })
  return ctx
}

/** Hand-place a preset directory under the harness home's preset root. */
/* 中文说明：函数 seedHomePreset 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function seedHomePreset(id: string): Promise<void> {
  await mkdir(join(home, USER_ROOT_SEGMENT, id), { recursive: true })
  await writeFile(join(home, USER_ROOT_SEGMENT, id, COMPOSITION_FILE), VALID)
}

describe('the harness-home preset root', () => {
  it('is what a roster gets when config names no roots at all', () => {
    // The schema default is the contract an app relies on by saying nothing;
    // every other case here passes the field explicitly. The cast stands for
    // the untyped document the Loader hands the schema, which is where a
    // composition that omits the key actually comes from.
    /** 中文说明：变量 parsed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parsed = AgentPresets.Config({ default: 'standard' } as unknown as Config)

    expect(parsed).toMatchObject({ includeUserRoot: true, roots: [] })
  })

  it('is discovered without any app configuring it', async () => {
    await seedHomePreset('mine')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await roster()

    /** 中文说明：变量 listed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listed = await ctx.agentPresets.list()

    expect(listed.find(preset => preset.id === 'mine')).toMatchObject({ trust: 'user' })
    expect((await ctx.agentPresets.resolve('mine')).path)
      .toBe(join(home, USER_ROOT_SEGMENT, 'mine', COMPOSITION_FILE))
  })

  it('makes a roster with only a system root authorable, and receives the copy', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await roster()

    expect(ctx.agentPresets.authorable).toBe(true)
    await ctx.agentPresets.copy('standard', 'copied')

    expect(existsSync(join(home, USER_ROOT_SEGMENT, 'copied', COMPOSITION_FILE))).toBe(true)
  })

  it('sorts after every configured root, so a shipped id still shadows a home directory', async () => {
    // `standard` exists in the fixture system root; claiming the name at home
    // must not take it over, because `copy` refuses an id any root supplies
    // and a session resolving `standard` must reach the shipped composition.
    await seedHomePreset('standard')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await roster()

    expect((await ctx.agentPresets.resolve('standard')).trust).toBe('system')
    await expect(ctx.agentPresets.copy('standard', 'standard')).rejects.toThrow(/already exists/)
  })

  it('is absent under includeUserRoot: false, which leaves the roster unauthorable', async () => {
    await seedHomePreset('mine')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await roster({ includeUserRoot: false })

    expect((await ctx.agentPresets.list()).map(preset => preset.id)).not.toContain('mine')
    expect(ctx.agentPresets.authorable).toBe(false)
    await expect(ctx.agentPresets.copy('standard', 'mine'))
      .rejects.toThrow(/no user-writable preset root/)
  })

  it('yields to a configured user root for authoring, which writableRoot takes first', async () => {
    /** 中文说明：变量 explicit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const explicit = await mkdtemp(join(tmpdir(), 'dsh-preset-explicit-'))
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await roster({
      roots: [
        { path: SYSTEM_ROOT, trust: 'system' as const },
        { path: explicit, trust: 'user' as const },
      ],
    })

    await ctx.agentPresets.copy('standard', 'copied')

    expect(existsSync(join(explicit, 'copied', COMPOSITION_FILE))).toBe(true)
    expect(existsSync(join(home, USER_ROOT_SEGMENT, 'copied'))).toBe(false)
  })
})
