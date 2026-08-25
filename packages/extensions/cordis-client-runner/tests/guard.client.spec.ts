/**
 * @vitest-environment jsdom
 *
 * Guard facade account: the whitelist a dynamic plugin's `apply` sees, the
 * automatic shadowing priority on the slots seat, the theme seat's pinned
 * override source and fiber-owned disposer, and the Context denial that keeps a
 * dynamic package from reaching a foreign context. Registrations ride the
 * CALLING fiber, so disposing it must remove them (HMR safety).
 */
/**
 * 文件职责：验证Cordis 客户端运行器的 guard.client.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis Context、插件生命周期、React 和 Vitest。
 * 产品维度：保证Cordis 客户端运行器在配置、运行、失败和清理场景中可理解且可靠。
 * 逻辑维度：构造插件或沙箱，驱动操作并断言日志与清理。
 * 关键边界：沙箱与宿主 Context 不可混用；反馈追加新记录，不改写既有会话历史。
 * 新手阅读建议：先读类型和夹具，再按注册、执行、错误与卸载流程阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FC } from 'react'
import type {
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  DynamicCordisPackage,
} from '@deepseek-ai/dsh-api-remotes/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { dynamicCordisContext } from '../src/client/guard.ts'
import type { DynamicCordisSlotLedgerRow } from '../src/client/guard.ts'

/** 中文说明：测试局部值 C，由紧邻初始化决定。 */
const C: FC<object> = () => null

/** The exact running package carried by a Client dispatch. */
/** 中文说明：函数 pkg 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function pkg(): DynamicCordisPackage {
  return {
    pluginId: 'dyn-1' as CordisDynamicPluginId,
    packageId: 'pkg-1' as CordisDynamicPackageId,
    pluginRunId: 'run-1' as CordisDynamicPluginRunId,
    name: 'demo',
  }
}

/** Erased facade view: a dynamic package reads services off plain properties. */
/** 中文说明：类型或类 Facade 约束扩展或反馈数据职责。 */
type Facade = Record<string, unknown> & { get(name: string): unknown }

/** 中文说明：类型或类 Bench 约束扩展或反馈数据职责。 */
interface Bench {
  ctx: Context
  slots: SlotRegistry
  facade: Facade
  ledger: DynamicCordisSlotLedgerRow[]
  /** Components the facade claimed for the package, in registration order. */
  claimed: unknown[]
  dispose: () => Promise<void>
  overrideTokens: ReturnType<typeof vi.fn>
  themeLayerDispose: ReturnType<typeof vi.fn>
}

/**
 * Mount a dynamic-plugin fiber declaring `inject`, and capture the facade its
 * apply receives (the real product path: the facade wraps the fiber's own ctx).
 */
/** 中文说明：函数 boot 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function boot(inject: string[], extras: Record<string, unknown> = {}): Promise<Bench> {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  /** 中文说明：测试局部值 themeLayerDispose，由紧邻初始化决定。 */
  const themeLayerDispose = vi.fn()
  /** 中文说明：测试局部值 overrideTokens，由紧邻初始化决定。 */
  const overrideTokens = vi.fn(() => themeLayerDispose)
  ctx.reflect.provide('theme', {
    overrideTokens,
    getTheme: () => ({ preference: 'light' }),
    reload: () => Promise.resolve('reloaded'),
    revision: 3,
    escape: () => new Context(),
    escapeLater: () => Promise.resolve(new Context()),
  })
  /** 中文说明：测试局部值 [name，由紧邻初始化决定。 */
  for (const [name, value] of Object.entries(extras)) ctx.reflect.provide(name, value)
  /** 中文说明：测试局部值 ledger，由紧邻初始化决定。 */
  const ledger: DynamicCordisSlotLedgerRow[] = []
  /** 中文说明：测试局部值 claimed，由紧邻初始化决定。 */
  const claimed: unknown[] = []
  /** 中文说明：测试局部值 nextPriority，由紧邻初始化决定。 */
  let nextPriority = 0
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let facade: Facade | undefined
  /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
  const fiber = ctx.plugin({
    name: 'dyn/dyn-1',
    inject,
    apply: (own: Context) => {
      facade = dynamicCordisContext(own, {
        pkg: pkg(),
        ledger,
        claim: (component) => { claimed.push(component) },
        allocatePriority: () => --nextPriority,
        reportFailure: () => {},
      }) as unknown as Facade
    },
  })
  await fiber
  if (facade === undefined) throw new Error('facade was not captured')
  return {
    ctx,
    slots: ctx.slots,
    facade,
    ledger,
    claimed,
    dispose: async () => { await fiber.dispose() },
    overrideTokens,
    themeLayerDispose,
  }
}

describe('facade surface', () => {
  it('forwards whitelisted lifecycle verbs to the real ctx', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot([])
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: string[] = []
    /** 中文说明：测试局部值 on，由紧邻初始化决定。 */
    const on = bench.facade.on as (event: string, listener: (key: string) => void) => void
    on('slots/changed', key => seen.push(key))
    bench.ctx.emit('slots/changed', 'root')
    expect(seen).toEqual(['root'])
  })

  it('teaches the object form when an existing service was not declared', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot([])
    expect(() => bench.facade.slots).toThrow(/service "slots" is not declared by your plugin/)
    expect(() => bench.facade.slots).toThrow(/a plain `function` has no declaration site/)
  })

  it('withholds framework internals with a teaching list', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot([])
    expect(() => bench.facade.registry).toThrow(/dynamic ctx does not expose "registry"/)
    expect(() => bench.facade.registry).toThrow(/any service your returned plugin declared in inject/)
  })

  it('answers `get` and `has` over the same whitelist, and refuses writes', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    expect(typeof bench.facade.get('slots')).toBe('object')
    expect('get' in bench.facade).toBe(true)
    expect('on' in bench.facade).toBe(true)
    expect('slots' in bench.facade).toBe(true)
    expect('registry' in bench.facade).toBe(false)
    expect(Symbol.iterator in bench.facade).toBe(false)
    expect((bench.facade as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
    expect(() => { bench.facade.slots = 1 }).toThrow(/dynamic ctx is read-only/)
  })

  it('denies a service value or return that is a cordis Context', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['leaky'], {
      leaky: { escape: () => new Context(), later: () => Promise.resolve(new Context()), plain: 7 },
    })
    /** 中文说明：测试局部值 leaky，由紧邻初始化决定。 */
    const leaky = bench.facade.leaky as { escape(): unknown; later(): Promise<unknown>; plain: number }
    expect(() => leaky.escape()).toThrow(/returned a cordis Context/)
    await expect(leaky.later()).rejects.toThrow(/returned a cordis Context/)
    expect(leaky.plain).toBe(7)
  })

  it('passes a primitive service through untouched', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['flag'], { flag: 'on' })
    expect(bench.facade.flag).toBe('on')
  })
})

describe('slots seat', () => {
  it('assigns a descending shadowing priority per registration and ledgers it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as { register(options: object, component: unknown): () => void }
    slots.register({ name: 'root' }, C)
    slots.register({ name: 'root' }, C)
    expect(bench.ledger).toEqual([
      { slot: 'root', priority: -1 },
      { slot: 'root', priority: -2 },
    ])
    // Newest-wins ordering is what "registering IS shadowing" means.
    /** 中文说明：测试局部值 priorities，由紧邻初始化决定。 */
    const priorities = bench.slots.entries('root').map(entry => entry.options.priority)
    expect(priorities).toContain(-1)
    expect(priorities).toContain(-2)
  })

  it('keeps an explicit priority when the target elects its own order', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as { register(options: object, component: unknown): () => void }
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = vi.spyOn(bench.slots, 'spec').mockReturnValue({ kind: 'chain', scope: 'root' })
    slots.register({ name: 'root', priority: 5 }, C)
    spec.mockRestore()
    expect(bench.ledger).toEqual([{ slot: 'root', priority: 5 }])
  })

  it('rejects a malformed register call before touching the registry', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as { register(options: unknown, component: unknown): () => void }
    expect(() => slots.register(null, C)).toThrow(/needs an options object with a `name`/)
    expect(() => slots.register({}, C)).toThrow(/need a string `name`/)
    expect(bench.slots.entries('root')).toHaveLength(0)
  })

  it('forwards non-register slot methods through the generic guard', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as {
      register(options: object, component: unknown): () => void
      entries(key: string): readonly unknown[]
    }
    slots.register({ name: 'root' }, C)
    expect(slots.entries('root')).toHaveLength(1)
  })

  it('denies a non-callable slots member that would hand out a context', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as { ctx: unknown }
    // The service's own ctx is the classic escape route out of the facade.
    expect(() => slots.ctx).toThrow(/service "slots" returned a cordis Context/)
  })

  it('removes its registrations when the calling fiber unloads (HMR safety)', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['slots'])
    /** 中文说明：测试局部值 slots，由紧邻初始化决定。 */
    const slots = bench.facade.slots as { register(options: object, component: unknown): () => void }
    slots.register({ name: 'root' }, C)
    expect(bench.slots.entries('root')).toHaveLength(1)
    await bench.dispose()
    expect(bench.slots.entries('root')).toHaveLength(0)
  })
})

describe('theme seat', () => {
  it('pins the override source to the package id whatever the caller passes', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['theme'])
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = bench.facade.theme as { overrideTokens(source: unknown, tokens: unknown): () => void }
    /** 中文说明：测试局部值 tokens，由紧邻初始化决定。 */
    const tokens = { '--dsw-alias-x': { light: '#fff', dark: '#000' } }
    theme.overrideTokens('pretend-to-be-someone-else', tokens)
    expect(bench.overrideTokens).toHaveBeenCalledWith('dyn-1.pkg-1', tokens)
  })

  it('teaches the two-argument shape when the token map arrives first', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['theme'])
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = bench.facade.theme as { overrideTokens(source: unknown, tokens?: unknown): () => void }
    expect(() => theme.overrideTokens({ '--x': { light: 'a', dark: 'b' } }))
      .toThrow(/takes two arguments; source is replaced with your package id/)
    expect(bench.overrideTokens).not.toHaveBeenCalled()
  })

  it('hangs the layer disposer on the fiber while still returning it', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['theme'])
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = bench.facade.theme as { overrideTokens(source: unknown, tokens: unknown): () => void }
    /** 中文说明：测试局部值 handle，由紧邻初始化决定。 */
    const handle = theme.overrideTokens('mine', {})
    expect(handle).toBe(bench.themeLayerDispose)
    expect(bench.themeLayerDispose).not.toHaveBeenCalled()
    // Model code cannot be trusted to keep the handle: unload must restore.
    await bench.dispose()
    expect(bench.themeLayerDispose).toHaveBeenCalledTimes(1)
  })

  it('forwards other theme methods, including asynchronous ones', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['theme'])
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = bench.facade.theme as {
      getTheme(): { preference: string }
      reload(): Promise<string>
      revision: number
    }
    expect(theme.getTheme().preference).toBe('light')
    await expect(theme.reload()).resolves.toBe('reloaded')
    expect(theme.revision).toBe(3)
  })

  it('denies a Context a theme method hands back, synchronously or awaited', async () => {
    /** 中文说明：测试局部值 bench，由紧邻初始化决定。 */
    const bench = await boot(['theme'])
    /** 中文说明：测试局部值 theme，由紧邻初始化决定。 */
    const theme = bench.facade.theme as { escape(): unknown; escapeLater(): Promise<unknown> }
    expect(() => theme.escape()).toThrow(/service "theme" returned a cordis Context/)
    await expect(theme.escapeLater()).rejects.toThrow(/service "theme" returned a cordis Context/)
  })
})
