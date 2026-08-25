/**
 * 文件职责：验证 topology.spec.ts 覆盖的 LLM 计量、配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型调用及令牌统计能向 Agent 和使用者提供稳定、可追踪的结果。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、投影结果和清理行为。
 * 关键边界：测试替身必须保持确定性；持久化事件应可重放；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmConfigurableProvider, StreamChunk } from '@deepseek-ai/dsh-llm'

/** 中文说明：class NoopAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class NoopAdapter extends LlmAdapter {

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

/** 中文说明：函数 setup 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

/** 中文说明：函数 entry 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function entry(overrides: Partial<LlmConfigurableProvider> = {}): LlmConfigurableProvider {
  return {
    provider: 'openai',
    displayName: 'OpenAI',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'openai'],
    ...overrides,
  }
}

describe('llm/adapters-updated', () => {
  it('fires at both adapter registration commit points with the registry already readable', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 observed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observed: string[][] = []
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerAdapter(['a', 'b'], new NoopAdapter())
    expect(observed).toEqual([['a', 'b']])
    dispose()
    expect(observed).toEqual([['a', 'b'], []])
  })

  it('contains a throwing listener without vetoing registration or starving later listeners', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 later 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const later = vi.fn()
    ctx.on('llm/adapters-updated', () => {
      throw new Error('broken observer')
    })
    ctx.on('llm/adapters-updated', later)
    ctx.llm.registerAdapter(['a'], new NoopAdapter())
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['a'])
    expect(later).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('llm: an llm/adapters-updated listener failed')
  })

  it('contains an ASYNC listener rejection instead of leaving it unhandled', async () => {
    // An emit listener may be an async function; its rejection cannot reach
    // the synchronous catch, so an uncontained one escapes the process as an
    // unhandled rejection rather than a warned observer failure.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：函数值 warn 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    /** 中文说明：变量 unhandled 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      // Typed as returning unknown so the listener is not a Promise-returning
      // function type: the point is exactly that an async one may slip in.
      /** 中文说明：函数值 rejecting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const rejecting = (): unknown => Promise.reject(new Error('async observer'))
      ctx.on('llm/adapters-updated', rejecting)
      ctx.llm.registerAdapter(['a'], new NoopAdapter())
      expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['a'])
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(unhandled).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith('llm: an llm/adapters-updated listener failed')
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('replaces a route set in one event, never publishing an empty registry between the two', async () => {
    // The retry-policy swap in llm-deepseek: disposing and re-registering
    // would let an observer see the provider disappear and come back.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 observed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const observed: string[][] = []
    /** 中文说明：变量 registration 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registration = ctx.llm.registerAdapter(['a'], new NoopAdapter())
    ctx.on('llm/adapters-updated', () => {
      observed.push(ctx.llm.listProviders().map(provider => provider.id))
    })
    registration.replace(['a'])
    expect(observed).toEqual([['a']])
  })

  it('rethrows the first INVARIANT-coded listener failure after notifying the rest', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 later 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const later = vi.fn()
    ctx.on('llm/adapters-updated', () => {
      throw Object.assign(new Error('registry incoherent'), { code: 'INVARIANT' })
    })
    ctx.on('llm/adapters-updated', later)
    expect(() => ctx.llm.registerAdapter(['a'], new NoopAdapter())).toThrow('registry incoherent')
    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('configurable-provider directory', () => {
  it('registers entries, lists detached copies in order, and fires the topology event', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = vi.fn()
    ctx.on('llm/adapters-updated', events)
    ctx.llm.registerConfigurableProviders([
      entry({ provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] }),
      entry(),
    ])
    expect(events).toHaveBeenCalledTimes(1)
    /** 中文说明：变量 listed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const listed = ctx.llm.listConfigurableProviders()
    expect(listed).toEqual([
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    ])
    listed[0]!.displayName = 'mutated'
    ;(listed[1]!.settingsPath as string[]).push('mutated')
    expect(ctx.llm.listConfigurableProviders()[0]!.displayName).toBe('DeepSeek')
    expect(ctx.llm.listConfigurableProviders()[1]!.settingsPath).toEqual(['providers', 'openai'])
  })

  it('detaches stored entries from caller-owned objects', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = entry()
    ctx.llm.registerConfigurableProviders([source])
    source.displayName = 'mutated'
    expect(ctx.llm.listConfigurableProviders()[0]!.displayName).toBe('OpenAI')
  })

  it('withdraws every entry when the registration disposes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerConfigurableProviders([entry()])
    /** 中文说明：变量 events 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const events = vi.fn()
    ctx.on('llm/adapters-updated', events)
    dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
    expect(events).toHaveBeenCalledTimes(1)
  })

  it('withdraws entries when the contributing fiber disposes', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fiber = await ctx.plugin({
      inject: ['llm'],
      apply: (child: Context) => {
        child.llm.registerConfigurableProviders([entry()])
      },
    })
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('rejects an empty registration', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([])).toThrow(LlmError)
    expect(() => ctx.llm.registerConfigurableProviders([])).toThrow(/at least one provider/)
  })

  it.each([
    [entry({ provider: '' }), /non-empty provider/],
    [entry({ displayName: '' }), /non-empty provider/],
    [entry({ settingsNs: '' }), /non-empty provider/],
    [entry({ settingsPath: ['providers', ''] }), /empty settingsPath segment/],
  ])('rejects invalid entries all-or-nothing', async (invalid, message) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([entry({ provider: 'valid-first' }), invalid])).toThrow(message)
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })

  it('replaces its entries atomically, keeping the old set when a candidate collides', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.llm.registerConfigurableProviders([entry(), entry({ provider: 'second' })])
    ctx.llm.registerConfigurableProviders([entry({ provider: 'owned-elsewhere' })])

    // A candidate another registration already declares refuses the whole swap.
    expect(() =>{  handle.replace([entry({ provider: 'owned-elsewhere' })]) }).toThrow(/already declared/)
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider).sort())
      .toEqual(['owned-elsewhere', 'second', entry().provider].sort())

    // Its own entries are not "already declared" against itself, so a swap that
    // keeps one and drops another lands whole.
    handle.replace([entry({ displayName: 'Renamed' })])
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider).sort())
      .toEqual(['owned-elsewhere', entry().provider].sort())
    expect(ctx.llm.listConfigurableProviders().find(view => view.provider === entry().provider)?.displayName)
      .toBe('Renamed')

    // An empty replace is legal, unlike an empty initial registration.
    handle.replace([])
    expect(ctx.llm.listConfigurableProviders().map(view => view.provider)).toEqual(['owned-elsewhere'])

    handle()
    expect(() =>{  handle.replace([entry()]) }).toThrow(/was disposed/)
  })

  it('rejects duplicates within one registration and across registrations', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => ctx.llm.registerConfigurableProviders([entry(), entry()])).toThrow(/already declared/)
    ctx.llm.registerConfigurableProviders([entry()])
    expect(() => ctx.llm.registerConfigurableProviders([entry({ displayName: 'Other' }), entry({ provider: 'unseen' })]))
      .toThrow(/already declared/)
    expect(ctx.llm.listConfigurableProviders()).toHaveLength(1)
  })
})

describe('model discovery registry', () => {
  it('offers one interrogation per settings namespace and disposes with its fiber', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：函数值 discover 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const discover = vi.fn(() => Promise.resolve([{ id: 'from-endpoint' }]))

    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerModelDiscovery('llm-example', discover)
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual([{ id: 'from-endpoint' }])
    expect(discover).toHaveBeenCalledWith({ baseURL: 'https://gateway.example/v1' })

    // Disposal is observed through the offer itself, which is the only thing
    // the registration ever produced.
    dispose()
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toThrow(/no model discovery is registered/)
  })

  it('rejects an unnamed namespace and a second registration of the same one', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：函数值 discover 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const discover = (): Promise<never[]> => Promise.resolve([])

    expect(() => ctx.llm.registerModelDiscovery('', discover)).toThrow(/non-empty settings namespace/)
    ctx.llm.registerModelDiscovery('llm-example', discover)
    expect(() => ctx.llm.registerModelDiscovery('llm-example', discover)).toThrow(/already registered/)
    // The refused second registration left the first one serving.
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' }))
      .resolves.toEqual([])
  })

  it('normalizes what an interrogation returns without inventing capacities', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([
      { id: 'keep', name: 'Keep', contextWindow: 1024, maxTokens: 256 },
      { id: '' },
      { id: 'keep' },
      { id: 'bare' },
    ] as never))

    expect(await ctx.llm.discoverModels('llm-example', { baseURL: 'https://gateway.example/v1' })).toEqual([
      { id: 'keep', name: 'Keep', contextWindow: 1024, maxTokens: 256 },
      { id: 'bare' },
    ])
  })

  it('refuses a namespace nothing serves and a draft with no endpoint', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    ctx.llm.registerModelDiscovery('llm-example', () => Promise.resolve([]))

    await expect(ctx.llm.discoverModels('llm-absent', { baseURL: 'https://gateway.example/v1' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', { baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', { provider: '', baseURL: '' }))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    await expect(ctx.llm.discoverModels('llm-example', {}))
      .rejects.toMatchObject({ code: 'INVALID_DISCOVERY' })
    // Naming a route alone is enough: the adapter may know it without an endpoint.
    await expect(ctx.llm.discoverModels('llm-example', { provider: 'known-route' })).resolves.toEqual([])
  })
})
