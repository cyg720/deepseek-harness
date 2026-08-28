/**
 * 文件职责：验证 llm/plugin-package-inventory-deepseek 中 inventory spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import AgentPresets, { mountPreset } from '@deepseek-ai/dsh-agent-presets'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import * as PluginInventory from '../src/index.ts'

/**
 * 常量说明：contexts 用于处理 contexts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const contexts: Context[] = []
/**
 * 常量说明：roots 用于处理 roots 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const roots: string[] = []
/**
 * 常量说明：SIGNAL 用于处理 SIGNAL 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SIGNAL = new AbortController().signal

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
afterEach(async () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ctx（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ctx)，并按返回类型处理结果。
   */
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：root（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(root)，并按返回类型处理结果。
   */
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * 功能说明：处理 packagePlugin 相关流程；使用场景由所在模块及调用位置决定。
 * @param root （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param dir （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param manifest （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param source （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<string>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 packagePlugin(root, dir, manifest, source)，
 * 并按返回类型处理结果。
 */
async function packagePlugin(
  root: string,
  dir: string,
  manifest: object,
  source = 'export default () => {}\n',
): Promise<string> {
  /**
   * 常量说明：packageDir 用于处理 packageDir 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packageDir = join(root, dir)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({ type: 'module', ...manifest })}\n`)
  await writeFile(join(packageDir, 'plugin.mjs'), source)
  return `./${dir}/plugin.mjs`
}

/**
 * 功能说明：处理 harness 相关流程；使用场景由所在模块及调用位置决定。
 * @param enabled （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<{ ctx: Context; root: string; disposeInventory: () =>
 * Promise…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 harness(enabled)，并按返回类型处理结果。
 */
async function harness(enabled?: boolean): Promise<{ ctx: Context; root: string; disposeInventory: () => Promise<void> }> {
  /**
   * 常量说明：root 用于处理 root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-packages-'))
  roots.push(root)
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(join(root, 'cordis.yml')).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentPresets, { default: 'fixture', roots: [], includeShippedRoot: false, includeUserRoot: false })
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  /**
   * 常量说明：inventory 用于处理 inventory 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const inventory = enabled === undefined
    ? ctx.plugin(PluginInventory)
    : ctx.plugin(PluginInventory, { enabled })
  await inventory
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return { ctx, root, disposeInventory: () => inventory.dispose() }
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('DeepSeek plugin package inventory', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('contributes by default and can be explicitly disabled', async () => {
    /**
     * 常量说明：defaultHarness 用于处理 defaultHarness 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const defaultHarness = await harness()
    /**
     * 常量说明：defaultFields 用于处理 defaultFields 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const defaultFields = await defaultHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(defaultFields.fields).toHaveProperty('dsh_plugin_packages')

    /**
     * 常量说明：disabledHarness 用于处理 disabledHarness 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disabledHarness = await harness(false)
    /**
     * 常量说明：disabledFields 用于处理 disabledFields 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const disabledFields = await disabledHarness.ctx.deepseekLlmApiExtensions.prepare({
      body: { messages: [] }, signal: SIGNAL,
    })
    expect(disabledFields.fields).not.toHaveProperty('dsh_plugin_packages')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports active package versions once, retains parallel versions, and excludes inactive or loose entries', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    /**
     * 常量说明：oneA 用于处理 oneA 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oneA = await packagePlugin(root, 'one-a', { name: 'one', version: '1.0.0' })
    /**
     * 常量说明：oneB 用于处理 oneB 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const oneB = await packagePlugin(root, 'one-b', { name: 'one', version: '2.0.0' })
    /**
     * 常量说明：disabled 用于处理 disabled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const disabled = await packagePlugin(root, 'disabled', { name: 'disabled', version: '1.0.0' })
    await mkdir(join(root, 'loose'), { recursive: true })
    await writeFile(join(root, 'loose/plugin.mjs'), 'export default () => {}\n')

    await ctx.loader.create({ name: oneA })
    await ctx.loader.create({ name: oneA })
    await ctx.loader.create({ name: oneB })
    await ctx.loader.create({ name: disabled, disabled: true })
    await ctx.loader.create({ name: './loose/plugin.mjs' })

    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages).toEqual({
      version: 1,
      packages: [
        { name: 'one', version: '1.0.0' },
        { name: 'one', version: '2.0.0' },
      ],
    })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails request preparation for an active package with malformed identity metadata', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    /**
     * 常量说明：bad 用于处理 bad 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bad = await packagePlugin(root, 'bad', { name: 'bad' })
    await ctx.loader.create({ name: bad })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .rejects.toThrow(/must declare non-empty name and version/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('omits a loose ESM module whose nearest manifest only marks the module type', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    /**
     * 常量说明：marker 用于处理 marker 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const marker = await packagePlugin(root, 'marker-only', {})
    await ctx.loader.create({ name: marker })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .resolves.toMatchObject({ fields: { dsh_plugin_packages: { version: 1, packages: [] } } })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses the host inventory when a request has no matching or joined live agent', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    /**
     * 常量说明：plugin 用于处理 plugin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const plugin = await packagePlugin(root, 'host-only', { name: 'host-only', version: '3.0.0' })
    await ctx.loader.create({ name: plugin })
    /**
     * 常量说明：missing 用于处理 missing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const missing = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: 'missing' })
    expect(missing.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'host-only', version: '3.0.0' }])

    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = SessionId('bare-agent')
    /**
     * 常量说明：agentScope 用于处理 agentScope 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const agentScope = createScope(ctx, {})
    ctx.agents.register({ id, ctx: agentScope.ctx, session: { id } } as unknown as Agent)
    /**
     * 常量说明：bare 用于处理 bare 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const bare = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: id })
    expect(bare.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'host-only', version: '3.0.0' }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('resolves scoped and unscoped bare subpaths, absolute/file modules, and skips URL or Cordis modules', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/plain-package', { name: 'plain-package', version: '1.0.0' })
    await packagePlugin(root, 'node_modules/@scope/scoped-package', { name: '@scope/scoped-package', version: '2.0.0' })
    await packagePlugin(root, 'absolute-package', { name: 'absolute-package', version: '3.0.0' })
    /**
     * 常量说明：absolute 用于处理 absolute 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const absolute = join(root, 'absolute-package/plugin.mjs')
    /**
     * 常量说明：internal 用于处理 internal 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const internal = ctx.loader.internal
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：specifier（string）：提供本次调用所需的数据；
     * 必须满足声明的类型及调用时序要求。；参数：args（unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
     * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用
     * 匿名回调(specifier, args)，并按返回类型处理结果。
     */
    ctx.loader.internal = {
      version: 'v2',
      import: async (specifier: string, ...args: unknown[]) => {
        if (specifier === 'https://plugins.example/test.mjs') /**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
return { default: () => {} }
        // Node ESM on Windows requires a file URL; retain the raw Loader name for package attribution.
        /**
         * 常量说明：portableSpecifier 用于处理 portableSpecifier 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const portableSpecifier = specifier === absolute ? pathToFileURL(specifier).href : specifier
        /**
         * 功能说明：处理 import 相关流程；使用场景由所在模块及调用位置决定。
         * @param specifier （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @param args （unknown[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
         * @returns Promise<unknown>；调用方应按声明类型处理，不应假定未声明的附加状态。
         * @example 在完成前置校验后调用 import(specifier, args)，并按返回类型处理结果。
         */
        return await (internal as never as { import(specifier: string, ...args: unknown[]): Promise<unknown> })
          .import(portableSpecifier, ...args)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    await ctx.loader.create({ name: 'plain-package/plugin.mjs' })
    await ctx.loader.create({ name: '@scope/scoped-package/plugin.mjs' })
    await ctx.loader.create({ name: absolute })
    await ctx.loader.create({ name: pathToFileURL(absolute).href })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.loader.builtins.noop = () => {}
    await ctx.loader.create({ name: 'cordis:noop' })
    await ctx.loader.create({ name: 'https://plugins.example/test.mjs' })

    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([
      { name: '@scope/scoped-package', version: '2.0.0' },
      { name: 'absolute-package', version: '3.0.0' },
      { name: 'plain-package', version: '1.0.0' },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('fails when a Loader-resolved bare entry has no package manifest', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx } = await harness()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    ctx.loader.internal = {
      version: 'v2',
      import: async () => ({ default: () => {} }),
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'missing-package' })
    await expect(ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL }))
      .rejects.toThrow(/cannot resolve active package/)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('supports a direct embedding whose context has no base URL', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
    await ctx.plugin(PluginInventory)
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages).toEqual({ version: 1, packages: [] })
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('uses each ordinary Loader tree base for conflicting bare package versions', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/versioned-plugin', {
      name: 'versioned-plugin', version: '1.0.0',
    })
    /**
     * 常量说明：nestedRoot 用于处理 nestedRoot 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const nestedRoot = join(root, 'nested')
    await packagePlugin(nestedRoot, 'node_modules/versioned-plugin', {
      name: 'versioned-plugin', version: '2.0.0',
    })
    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = join(nestedRoot, 'cordis.yml')
    await writeFile(composition, '- id: nested\n  name: versioned-plugin/plugin.mjs\n')

    await ctx.loader.create({ name: 'versioned-plugin/plugin.mjs' })
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(composition).href } })

    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([
      { name: 'versioned-plugin', version: '1.0.0' },
      { name: 'versioned-plugin', version: '2.0.0' },
    ])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('mirrors the standing preset bare-package override instead of its local node_modules', async () => {
    /**
     * 常量说明：ctx、root 用于处理 ctx、root 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, root } = await harness()
    await packagePlugin(root, 'node_modules/preset-only', { name: 'preset-only', version: '4.0.0' })
    /**
     * 常量说明：presetDir 用于处理 presetDir 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const presetDir = join(root, 'preset')
    await mkdir(presetDir, { recursive: true })
    await packagePlugin(presetDir, 'node_modules/preset-only', { name: 'preset-only', version: '9.0.0' })
    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = join(presetDir, 'agent.cordis.yml')
    await writeFile(composition, '- id: preset-only\n  name: preset-only/plugin.mjs\n')

    /**
     * 常量说明：standingKey 用于处理 standingKey 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const standingKey = {}
    /**
     * 常量说明：standing 用于处理 standing 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const standing = createScope(ctx, standingKey)
    await mountPreset(standing.ctx, { id: 'fixture', trust: 'user', path: composition })
    /**
     * 常量说明：agentKey 用于处理 agentKey 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agentKey = {}
    /**
     * 常量说明：agentScope 用于处理 agentScope 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const agentScope = createScope(ctx, agentKey, { parent: standingKey })
    /**
     * 常量说明：id 用于处理 id 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const id = SessionId('preset-agent')
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = { id, ctx: agentScope.ctx, session: { id } } as unknown as Agent
    ctx.agents.register(agent)

    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL, sessionId: id })
    expect(prepared.fields.dsh_plugin_packages?.packages).toEqual([{ name: 'preset-only', version: '4.0.0' }])
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('withdraws the inventory field when the contributing plugin reloads', async () => {
    /**
     * 常量说明：ctx、disposeInventory 用于处理 ctx、disposeInventory 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { ctx, disposeInventory } = await harness()
    expect((await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })).fields)
      .toHaveProperty('dsh_plugin_packages')
    await disposeInventory()
    expect((await ctx.deepseekLlmApiExtensions.prepare({ body: { messages: [] }, signal: SIGNAL })).fields)
      .not.toHaveProperty('dsh_plugin_packages')
  })
})
