/**
 * 文件职责：验证 subagent/tool-subagent 中 list models spec 相关行为与失败场景。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  ToolCallId,
  LlmAdapter,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as tool from '../src/index.ts'
import { registerListSubagentModels } from '../src/list-models.ts'
import { testToolSignal, text } from './harness.ts'

/**
 * 类说明：CatalogAdapter 用于集中封装 处理 CatalogAdapter 相关状态与行为。
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。
 * 使用场景：由 subagent/tool-subagent 在对应插件或业务生命周期内创建和调用。
 */
class CatalogAdapter extends LlmAdapter {
  /**
   * 功能说明：处理 CatalogAdapter 相关流程；使用场景由所在模块及调用位置决定。
   * @param empty （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new CatalogAdapter(empty) 创建实例，并在所属生命周期内使用。
   */
  constructor(private readonly empty = false) {
    super()
  }

  /**
   * 功能说明：处理 providerInfo 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 providerInfo(provider)，并按返回类型处理结果。
   */
  override providerInfo(provider: string) {
    return { id: provider, name: `${provider.toUpperCase()} API` }
  }

  /**
   * 功能说明：列出 Models 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<readonly LlmModelInfo[]>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 listModels(provider)，并按返回类型处理结果。
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (this.empty) return Promise.resolve([])
    return Promise.resolve([
      { provider, id: 'fast', name: 'Fast', description: 'Focused work.' },
      { provider, id: 'plain', name: 'Plain' },
    ])
  }

  /**
   * 功能说明：解析 Model 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<LlmResolvedModelInfo>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolveModel(provider, model)，并按返回类型处理结果。
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (model === 'plain') return Promise.resolve({ provider, id: model, name: 'Plain' })
    return Promise.resolve({
      provider,
      id: model,
      name: 'Fast',
      description: 'Focused work.',
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High', description: 'Quality first.' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  }

  /**
   * 功能说明：处理 stream 相关流程；使用场景由所在模块及调用位置决定。
   * @param _options （GenerateOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @returns AsyncIterable<StreamChunk>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 stream(_options)，并按返回类型处理结果。
   */
  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    return (async function* () { yield { type: 'finish' as const, reason: { kind: 'stop' as const } } })()
  }
}

/**
 * 功能说明：处理 setupListTool 相关流程；使用场景由所在模块及调用位置决定。
 * @param routes （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setupListTool(routes)，并按返回类型处理结果。
 */
async function setupListTool(routes = [
  { provider: 'alpha', model: 'fast' },
  { provider: 'alpha', model: 'plain' },
  { provider: 'beta', model: 'fast' },
  { provider: 'beta', model: 'plain' },
]) {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerListSubagentModels(ctx, { routes })
  return ctx
}

/**
 * 功能说明：处理 setupAllowedListTool 相关流程；使用场景由所在模块及调用位置决定。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 setupAllowedListTool()，并按返回类型处理结果。
 */
async function setupAllowedListTool() {
  /**
   * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  registerListSubagentModels(ctx, {
    routes: [
      { provider: 'alpha', model: 'fast' },
      { provider: 'alpha', model: 'unlisted' },
      { provider: 'missing', model: 'hidden' },
    ],
  })
  return ctx
}

/**
 * 变量说明：counter 用于处理 counter 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
 */
let counter = 0

/**
 * 功能说明：处理 call 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @param args （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 call(ctx, args)，并按返回类型处理结果。
 */
function call(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`list-models-${++counter}`),
    name: 'list_subagent_models',
    arguments: args,
  })
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
describe('list_subagent_models', () => {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('is omitted unless its delegation-tool instance owns discovery', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(tool, { provider: 'unused' })
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('stays registered without the optional LLM service and rejects discovery calls', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    registerListSubagentModels(ctx, { routes: [{ provider: 'alpha', model: 'fast' }] })
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`llm` service is unavailable')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects two discovery-owning instances in one tool scope', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    expect(() => {
      registerListSubagentModels(ctx, { routes: [{ provider: 'alpha', model: 'fast' }] })
    }).toThrow('tool "list_subagent_models" is already registered')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('lists registered providers and follows live registration changes', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    /**
     * 常量说明：empty 用于处理 empty 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const empty = await call(ctx, {})
    expect(empty.isError).toBe(false)
    expect(text(empty)).toBe('(no LLM providers)')

    /**
     * 常量说明：registration 用于处理 registration 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const registration = ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    /**
     * 常量说明：providers 用于处理 providers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const providers = await call(ctx, {})
    expect(providers.isError).toBe(false)
    expect(text(providers)).toBe('alpha — ALPHA API')

    registration.replace(['beta'])
    /**
     * 常量说明：changed 用于处理 changed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const changed = await call(ctx, {})
    expect(text(changed)).toBe('beta — BETA API')

    /**
     * 常量说明：tools 用于处理 tools 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const tools = ctx.tools
    await ctx.fiber.dispose()
    expect(tools.get('list_subagent_models')).toBeUndefined()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('lists one provider\'s advertised models without treating the catalog as a whitelist', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'alpha' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha/fast — Fast: Focused work.\nalpha/plain — Plain')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('intersects provider and model discovery with the Session allowlist', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupAllowedListTool()
    ctx.llm.registerAdapter(['alpha', 'beta'], new CatalogAdapter())

    expect(text(await call(ctx, {}))).toBe('alpha — ALPHA API')
    expect(text(await call(ctx, { provider: 'alpha' }))).toBe('alpha/fast — Fast: Focused work.')
    expect(text(await call(ctx, { provider: 'alpha', model: 'unlisted' })))
      .toContain('alpha/unlisted — Fast')

    /**
     * 常量说明：denied 用于处理 denied 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const denied = await call(ctx, { provider: 'alpha', model: 'plain' })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('is not allowed for this Session')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an unauthorized provider before calling its adapter catalog', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool([{ provider: 'alpha', model: 'fast' }])
    /**
     * 常量说明：adapter 用于处理 adapter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const adapter = new CatalogAdapter()
    /**
     * 常量说明：listModels 用于列出 Models 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const listModels = vi.spyOn(adapter, 'listModels')
    ctx.llm.registerAdapter(['alpha', 'secret'], adapter)

    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'secret' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('provider "secret" is not allowed for this Session')
    expect(listModels).not.toHaveBeenCalled()
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders an empty advertised model list', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool([{ provider: 'alpha', model: 'fast' }])
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter(true))
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'alpha' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('(no advertised models for alpha)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('inspects exact-model efforts, descriptions, and defaults', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha', 'secret'], new CatalogAdapter())
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'alpha', model: 'fast' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe(
      'alpha/fast — Fast: Focused work.\nReasoning efforts:\n'
      + 'low — Low\nhigh (default) — High: Quality first.',
    )
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('renders exact models without reasoning metadata', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'alpha', model: 'plain' })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('alpha/plain — Plain\nReasoning efforts:\n(no advertised reasoning efforts)')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ args, expected }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ args, expected })，
   * 并按返回类型处理结果。
   */
  it.each([
    { args: { model: 'fast' }, expected: '`model` requires `provider`' },
    { args: { provider: '' }, expected: '`provider` must be non-empty' },
    { args: { provider: 'missing' }, expected: 'is not allowed for this Session' },
  ])('rejects incomplete or unavailable provider requests', async ({ args, expected }) => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, args)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(expected)
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('rejects an empty exact model after resolving the provider', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool()
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'alpha', model: '' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('`model` must be non-empty')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports registered alternatives for an unavailable provider', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool([
      { provider: 'alpha', model: 'fast' },
      { provider: 'missing', model: 'fast' },
    ])
    ctx.llm.registerAdapter(['alpha'], new CatalogAdapter())
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('available providers: alpha')
    expect(text(result)).not.toContain('secret')
  })

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  it('reports no available provider when the authorized registry intersection is empty', async () => {
    /**
     * 常量说明：ctx 用于处理 ctx 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const ctx = await setupListTool([{ provider: 'missing', model: 'fast' }])
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = await call(ctx, { provider: 'missing' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('available providers: (none)')
  })
})
