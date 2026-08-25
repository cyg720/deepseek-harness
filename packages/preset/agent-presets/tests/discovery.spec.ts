/**
 * 文件职责：验证 discovery.spec.ts 覆盖的 Agent 预设发现、装载与会话行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和临时配置目录。
 * 产品维度：保障用户选择的 Agent 预设能稳定生效并保持会话一致。
 * 逻辑维度：准备预设配置，装载插件，触发会话流程，再核对状态与错误。
 * 关键边界：配置来源和优先级必须明确；临时资源必须在用例结束时释放。
 * 新手阅读建议：先看夹具与辅助函数，再按发现、装载、会话顺序阅读用例。
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPOSITION_FILE, discoverPresets, scanRoot } from '@deepseek-ai/dsh-agent-presets'

/** 中文说明：函数值 fsHarness 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const fsHarness = vi.hoisted(() => ({
  nextReadError: undefined as NodeJS.ErrnoException | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  /** 中文说明：变量 actual 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: unknown, ...rest: never[]) => {
      /** 中文说明：变量 error 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const error = fsHarness.nextReadError
      if (error !== undefined) {
        fsHarness.nextReadError = undefined
        throw error
      }
      return (actual.readFile as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
    }) as typeof actual.readFile,
  }
})

/** 中文说明：常量 FIXTURES 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/** 中文说明：常量 SYSTEM 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SYSTEM = { path: join(FIXTURES, 'system'), trust: 'system' as const }
/** 中文说明：常量 USER 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const USER = { path: join(FIXTURES, 'user'), trust: 'user' as const }

beforeEach(() => {
  fsHarness.nextReadError = undefined
})

describe('display order', () => {
  it('puts declared order first, then everything else by id', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-order-'))
    /** 中文说明：该循环依次处理预设数据；循环变量仅在当前循环中有效。 */
    for (const [id, order] of [['zulu', 1], ['alpha', 2]] as const) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
      await writeFile(join(root, id, 'preset.yml'), `order: ${String(order)}\n`)
    }
    /** 中文说明：该循环依次处理预设数据；循环变量仅在当前循环中有效。 */
    for (const id of ['bravo', 'yankee']) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
    }

    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: root, trust: 'system' })

    // The shipped set reads by capability; presets that declare nothing stay
    // alphabetical behind them rather than interleaving unpredictably.
    expect(found.map(preset => preset.id)).toEqual(['zulu', 'alpha', 'bravo', 'yankee'])
  })

  it('breaks a tie between equal declared orders by id', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-order-tie-'))
    /** 中文说明：该循环依次处理预设数据；循环变量仅在当前循环中有效。 */
    for (const id of ['yankee', 'alpha']) {
      await mkdir(join(root, id), { recursive: true })
      await writeFile(join(root, id, COMPOSITION_FILE), '[]\n')
      await writeFile(join(root, id, 'preset.yml'), 'order: 1\n')
    }

    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: root, trust: 'system' })

    // Two presets claiming the same slot must still list in a stable order:
    // a directory-scan order would reshuffle the picker between reads.
    expect(found.map(preset => preset.id)).toEqual(['alpha', 'yankee'])
  })
})

describe('preset discovery', () => {
  it('reports one preset per directory holding a composition, ordered by id', async () => {
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot(SYSTEM)

    expect(found.map(preset => preset.id)).toEqual(['minimal', 'standard'])
    expect(found[0]).toEqual({
      id: 'minimal',
      trust: 'system',
      path: join(SYSTEM.path, 'minimal', COMPOSITION_FILE),
    })
  })

  it('reports a directory with no composition as a broken preset slot', async () => {
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot(USER)

    // The directory still occupies its id — a copy to that name is refused —
    // so hiding it would leave nothing to see or delete. It surfaces broken.
    /** 中文说明：函数值 ghost 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const ghost = found.find(preset => preset.id === 'not-a-preset')
    expect(ghost?.broken).toMatch(/agent\.cordis\.yml is missing/)
  })

  it('skips a directory whose name no preset id could ever claim', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-oddname-'))
    await mkdir(join(root, '.hidden'))
    await mkdir(join(root, 'Has_Caps'))
    await mkdir(join(root, 'usable'))
    await writeFile(join(root, 'usable', COMPOSITION_FILE), '[]\n')

    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: root, trust: 'user' })

    // `.hidden` and `Has_Caps` cannot collide with any copy target, so
    // reporting tool residue as broken presets would only train users to
    // ignore the marker.
    expect(found.map(preset => preset.id)).toEqual(['usable'])
  })

  it('records the root trust on every preset it discovers', async () => {
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot(USER)

    expect(found.every(preset => preset.trust === 'user')).toBe(true)
  })

  it('lets the earlier root win a duplicate id', async () => {
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await discoverPresets([SYSTEM, USER])

    /** 中文说明：函数值 standard 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const standard = found.filter(preset => preset.id === 'standard')
    expect(standard).toHaveLength(1)
    expect(standard[0]?.trust).toBe('system')
  })

  it('treats an absent root as supplying no presets', async () => {
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: join(FIXTURES, 'no-such-root'), trust: 'user' })

    expect(found).toEqual([])
  })

  it('ignores a plain file sitting beside the preset directories', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-'))
    await writeFile(join(root, 'stray.yml'), '- id: x\n')
    await mkdir(join(root, 'real'))
    await writeFile(join(root, 'real', COMPOSITION_FILE), '[]\n')

    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: root, trust: 'user' })

    expect(found.map(preset => preset.id)).toEqual(['real'])
  })

  it('reports a root it cannot read rather than treating it as empty', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-'))
    /** 中文说明：变量 notADirectory 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const notADirectory = join(root, 'file-as-root')
    await writeFile(notADirectory, 'not a directory\n')

    await expect(scanRoot({ path: notADirectory, trust: 'user' }))
      .rejects.toThrow(/cannot read preset root/)
  })

  it('expands a leading tilde in a root path', async () => {
    // `~` alone resolves to the home directory, which exists but holds no
    // preset directories; the point is that it did not throw on a literal `~`.
    /** 中文说明：变量 found 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const found = await scanRoot({ path: '~/.dsh-agent-presets-absent', trust: 'user' })

    expect(found).toEqual([])
  })
})

describe('composition health', () => {
  /** One directory under a fresh root holding `composition`, scanned. */
  /** 中文说明：函数 scanned 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
  async function scanned(composition: string): Promise<string | undefined> {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-health-'))
    await mkdir(join(root, 'probe'))
    await writeFile(join(root, 'probe', COMPOSITION_FILE), composition)
    const [preset] = await scanRoot({ path: root, trust: 'user' })
    return preset?.broken
  }

  it('reports unparsable YAML with the parser\'s reason', async () => {
    expect(await scanned('- id: x\n  name: [unclosed\n')).toMatch(/not valid YAML/)
  })

  it('reports a composition that is not a list of rows', async () => {
    expect(await scanned('name: not-a-list\n')).toMatch(/top-level list of plugin rows/)
  })

  it('reports the first row that names no plugin, by position', async () => {
    expect(await scanned('- id: ok\n  name: some-plugin\n- id: broken\n'))
      .toMatch(/row 2 names no plugin/)
  })

  it('reports a row that is not a map at all', async () => {
    expect(await scanned('- just-a-string\n')).toMatch(/row 1 is not a plugin row/)
  })

  it('descends into a group\'s own row list', async () => {
    /** 中文说明：变量 composition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config:\n    - id: inner\n'
    expect(await scanned(composition)).toMatch(/row 1 row 1 names no plugin/)
  })

  it('reports a group whose config is not a list', async () => {
    /** 中文说明：变量 composition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config: not-a-list\n'
    expect(await scanned(composition)).toMatch(/group row 1 must hold a list/)
  })

  it('accepts a group whose own list is healthy', async () => {
    /** 中文说明：变量 composition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const composition = '- id: grp\n  name: cordis:group\n  group: true\n  config:\n    - id: inner\n      name: some-plugin\n'
    expect(await scanned(composition)).toBeUndefined()
  })

  it('reports a composition that stats but cannot be read', async () => {
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = await mkdtemp(join(tmpdir(), 'dsh-presets-unreadable-'))
    await mkdir(join(root, 'sealed'))
    /** 中文说明：变量 path 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const path = join(root, 'sealed', COMPOSITION_FILE)
    await writeFile(path, '[]\n')
    fsHarness.nextReadError = Object.assign(new Error('EACCES: injected read failure'), { code: 'EACCES' })

    const [preset] = await scanRoot({ path: root, trust: 'user' })

    expect(fsHarness.nextReadError).toBeUndefined()
    expect(preset?.broken).toMatch(/cannot be read/)
  })

  it('accepts the loader dialect, !!js scalars included', async () => {
    // Health must never call a composition broken that the loader accepts:
    // `!!js` is the loader's own extension, so it parses here too.
    /** 中文说明：变量 composition 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const composition = '- id: x\n  name: some-plugin\n  config:\n    value: !!js "1 + 1"\n'
    expect(await scanned(composition)).toBeUndefined()
  })

  it('accepts an empty list', async () => {
    expect(await scanned('[]\n')).toBeUndefined()
  })
})
