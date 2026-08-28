/**
 * The shipped presets are this package's own, not an assembly fact each app
 * must patch in: a roster configured with nothing still supplies the built-in
 * compositions, prepended so they always mount and win a duplicate id.
 * `includeShippedRoot: false` is how a deployment supplying purely its own
 * presets — or an embedder using the roster as bare machinery — opts out.
 *
 * `$DSH_HOME` is repointed per test for the same reason as the user-root
 * suite: the derived writable root is resolved in the constructor.
 * @remarks 文件说明：文件职责：验证 preset/agent-presets 中 shipped root spec 相关行为与失败场景。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AgentPresets, { SHIPPED_PRESET_ROOT, type Config } from '@deepseek-ai/dsh-agent-presets'

/**
 * 常量说明：FIXTURES 用于处理 FIXTURES 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
/**
 * 常量说明：SYSTEM_ROOT 用于处理 SYSTEM_ROOT 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SYSTEM_ROOT = join(FIXTURES, 'system')

/**
 * 变量说明：previousHome 用于处理 previousHome 相关数据，作用于当前作用域；其值可能随流程推进而变化，
 * 读写时需遵守声明类型和所在生命周期。
 */
let previousHome: string | undefined

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
beforeEach(async () => {
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-shipped-root-'))
})

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

/** Boot a roster with the shipped root left to the plugin's default.
 * @remarks 中文说明：功能说明：处理 roster 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：config（Partial<Config>）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<Context>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * roster(config)，并按返回类型处理结果。 */
async function roster(config: Partial<Config> = {}): Promise<Context> {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentPresets, {
    default: 'standard',
    roots: [],
    includeShippedRoot: true,
    includeUserRoot: true,
    ...config,
  })
  return ctx
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('the shipped preset root', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('supplies the built-in presets from a bare roster, healthy and system-trusted', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await roster({ includeUserRoot: false })

    /**
     * 常量说明：listed 用于处理 listed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listed = await ctx.agentPresets.list()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：preset（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(preset)，并按返回类型处理结果。
     */
    expect(listed.map(preset => preset.id).sort()).toEqual(['cordis', 'minimal', 'ptc', 'standard'])
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：preset（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(preset)，并按返回类型处理结果。
     */
    expect(listed.every(preset => preset.trust === 'system')).toBe(true)
    // Not `broken === undefined`: health asks whether each row's package is
    // installed above the base, and the shipped rows name packages the
    // deployment installs beside the roster. This fixture base is not that
    // install, so unresolved rows are the only reason it can report here —
    // malformed would be a different one, and this asserts there is none.
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：preset（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(preset)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：reason（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(reason)，并按返回类型处理结果。
     */
    expect(listed.map(preset => preset.broken)
      .filter(reason => reason !== undefined && !reason.includes('cannot be resolved'))).toEqual([])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('prepends the shipped root before configured roots and the derived user root', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await roster({ roots: [{ path: SYSTEM_ROOT, trust: 'user' }] })

    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root)，并按返回类型处理结果。
     */
    expect(ctx.agentPresets.roots.map(root => root.path)).toEqual([
      SHIPPED_PRESET_ROOT,
      SYSTEM_ROOT,
      expect.stringContaining('.agent-presets'),
    ])
    expect(ctx.agentPresets.roots[0]).toEqual({ path: SHIPPED_PRESET_ROOT, trust: 'system' })
    // Prepended, so a configured directory claiming a shipped id is shadowed:
    // the fixture root also carries `minimal`, and the roster serves the
    // shipped one.
    /**
     * 常量说明：minimal 用于处理 minimal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：preset（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(preset)，并按返回类型处理结果。
     */
    const minimal = (await ctx.agentPresets.list()).find(preset => preset.id === 'minimal')
    expect(minimal?.path.startsWith(SHIPPED_PRESET_ROOT)).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mounts a roster without the shipped set when includeShippedRoot is false', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await roster({
      includeShippedRoot: false,
      includeUserRoot: false,
      roots: [{ path: SYSTEM_ROOT, trust: 'system' }],
    })

    expect(ctx.agentPresets.roots).toEqual([{ path: SYSTEM_ROOT, trust: 'system' }])
    /**
     * 常量说明：minimal 用于处理 minimal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：preset（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(preset)，并按返回类型处理结果。
     */
    const minimal = (await ctx.agentPresets.list()).find(preset => preset.id === 'minimal')
    expect(minimal?.path.startsWith(SYSTEM_ROOT)).toBe(true)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('enables web_fetch in each tool-bearing Web app preset', async () => {
    /**
     * 变量说明：id 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const id of ['cordis', 'ptc', 'standard']) {
      /**
       * 常量说明：source 用于处理 source 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const source = await readFile(join(SHIPPED_PRESET_ROOT, id, 'agent.cordis.yml'), 'utf8')
      /**
       * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const entries: unknown = yaml.load(source, { schema: entryListSchema })
      if (!Array.isArray(entries)) throw new TypeError(`${id} preset must contain a Cordis entry list`)
      /**
       * 常量说明：toolWeb 用于处理 toolWeb 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（unknown）：提供本次调用所需的数据；
       * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
       * 典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
       */
      const toolWeb: unknown = entries.find((entry: unknown) =>
        typeof entry === 'object' && entry !== null && 'id' in entry && entry.id === 'tool-web')
      if (typeof toolWeb !== 'object' || toolWeb === null || !('config' in toolWeb)
        || typeof toolWeb.config !== 'object' || toolWeb.config === null || !('fetch' in toolWeb.config)) {
        throw new TypeError(`${id} preset must configure tool-web.fetch`)
      }
      expect(toolWeb.config.fetch, id).toBe(true)
    }
  })
})
