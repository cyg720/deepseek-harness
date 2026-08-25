// @vitest-environment jsdom
/*
 * 文件职责：验证客户端模块加载器的依赖排序、动态导入、失败隔离和卸载。
 * 技术维度：Cordis、Vitest、动态 import、依赖图与可控模块清单。
 * 产品维度：保证宿主声明的前端模块能够按依赖安全启动，并在变化时正确更新。
 * 逻辑维度：构造模块描述与导入结果，运行加载器，检查应用顺序、错误报告和清理。
 * 关键边界：循环或缺失依赖必须失败；模块 effect 的归属和销毁顺序不可泄漏。
 * 新手阅读建议：先读夹具模块与装载辅助函数，再按排序、变化、失败和清理分组阅读。
 */
/**
 * ClientModuleSystem behavior: lazy CJS arrival (bundle execution only
 * registers the factory), materialization on first import/require with
 * memoization and recursive self-sequencing, the resolution branch order,
 * shared in-flight arrival, invalidate-refetch (HMR), style claiming, the
 * default transport hook, and the loud failure modes (duplicate
 * registration, cycles, table misses, double boot).
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply, createClientModuleSystem, parseBootManifest,
  /** 中文说明：类型 `BootModuleRow` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
  type BootModuleRow, type ClientBundleRegistration, type ClientModuleCreateOptions,
  /** 中文说明：类型 `ClientModuleLoader` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
  type ClientModuleLoader, type ClientModuleLoaderTarget, type DshWindow,
} from '../src/client/index.ts'

/** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `MODULES_ID` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const MODULES_ID = '@deepseek-ai/dsh-client-modules'
/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `win` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const win = globalThis as DshWindow
/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bootstrapExports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const bootstrapExports = { apply, createClientModuleSystem }

/** 中文说明：类型 `Factory` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
type Factory = ClientBundleRegistration['factory']

afterEach(() => {
  vi.unstubAllGlobals()
  delete win.__ModuleLoader__
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `el` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  for (const el of document.querySelectorAll('style, script')) el.remove()
})

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `row` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const row = (id: string, fields: Partial<BootModuleRow> = {}): BootModuleRow =>
  ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0', external: [], ...fields })

/** 中文说明：类型 `Bench` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface Bench {
  loader: ClientModuleLoader
  target: ClientModuleLoaderTarget
  fetched: string[]
  gates: Map<string, () => void>
}

/** Build the page-global facade shape consumed by the module system. */
/* 中文说明：测试辅助函数 `registrationTarget`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function registrationTarget(pending: ClientBundleRegistration[] = []): ClientModuleLoaderTarget {
  /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `pendingQueue` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const pendingQueue = [...pending]
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: options => createClientModuleSystem(target, {
      id: MODULES_ID,
      exports: bootstrapExports,
    }, options),
  }
  return target
}

/**
 * Loader over scripted bundles: load records the row URL, optionally waits on
 * a release callback, then registers the scripted factory through the window
 * sink (`null` scripts a bundle that never calls load).
 */
/* 中文说明：测试辅助函数 `bench`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function bench(
  entries: BootModuleRow[],
  bundles: Record<string, Factory | null> = {},
  opts: {
    seed?: Record<string, unknown>
    gated?: string[]
    pending?: ClientBundleRegistration[]
    defaultTransport?: boolean
  } = {},
): Bench {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fetched` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const fetched: string[] = []
  /** 中文说明：协调异步执行顺序或保存待完成工作的 Promise；变量 `gates` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const gates = new Map<string, () => void>()
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `target` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const target = registrationTarget(opts.pending)
  win.__ModuleLoader__ = target
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loadBundle` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const loadBundle = async (url: string): Promise<void> => {
    fetched.push(url)
    if (opts.gated?.includes(url) === true) {
      await new Promise<void>((resolve) => { gates.set(url, resolve) })
    }
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `id` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const id = /\/plugins\/(.+)\/client\.js/.exec(url)?.[1]
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `factory` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const factory = id === undefined ? undefined : bundles[id]
    if (factory == null || id === undefined) return
    win.__ModuleLoader__?.load({ id, factory })
  }
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `loader` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const loader = target.create({
    boot: { rev: 'graph', entries },
    staticModules: opts.seed ?? {},
    ...(opts.defaultTransport === true ? {} : { loadBundle }),
  })
  return { loader, target, fetched, gates }
}

describe('Cordis plugin face', () => {
  it('rejects activation before the HTML facade creates the module system', () => {
    expect(() => { apply(new Context()) }).toThrow('createClientModuleSystem must run before plugin boot')
  })
})

describe('lazy CJS arrival', () => {
  it('drains registrations queued by parser-blocking preload scripts into the same live facade', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('runtime')], {}, {
      pending: [{ id: 'runtime', factory: () => ({ marker: 'preloaded' }) }],
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('runtime', '', {})
    expect((exports as { marker: string }).marker).toBe('preloaded')
    expect(b.target.pendingQueue).toEqual([])
    expect(b.fetched).toEqual([])
    expect(win.__ModuleLoader__).toBe(b.target)
    expect(b.target.mode).toBe('live')
  })

  it('prefetch loads and registers but does not run the factory', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ran` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ran: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => { ran.push('a'); return {} } })
    await b.loader.prefetch('a')
    expect(b.fetched).toEqual(['/plugins/a/client.js?rev=0'])
    expect(ran).toEqual([])
    expect(b.loader.loadCache.has('a')).toBe(false)
  })

  it('import materializes once and memoizes the exports', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ran` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ran: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => { ran.push('a'); return { marker: 'a' } } })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `first` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const first = await b.loader.import('a', '', {})
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `second` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const second = await b.loader.import('a', '', {})
    expect(first).toBe(second)
    expect((first as { marker: string }).marker).toBe('a')
    expect(ran).toEqual(['a'])
    expect(b.loader.loadCache.get('a')?.id).toBe('a')
  })

  it('import without prefetch loads, registers, and materializes in one call', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => ({ marker: 'direct' }) })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('a', '', {})
    expect((exports as { marker: string }).marker).toBe('direct')
    expect(b.fetched).toHaveLength(1)
  })

  it('registers declared dynamic requests before materializing their consumer', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([
      row('consumer', { external: ['provider/client', 'react'] }),
      row('provider'),
    ], {
      consumer: req => ({ provider: req('provider/client'), react: req('react') }),
      provider: () => ({ marker: 'provider' }),
    }, { seed: { react: { marker: 'react' } } })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('consumer', '', {}) as {
      provider: { marker: string }
      react: { marker: string }
    }
    expect(b.fetched).toEqual([
      '/plugins/provider/client.js?rev=0',
      '/plugins/consumer/client.js?rev=0',
    ])
    expect(exports.provider.marker).toBe('provider')
    expect(exports.react.marker).toBe('react')
  })

  it('concurrent callers share one in-flight arrival and materialize once', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ran` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ran: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `url` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const url = '/plugins/a/client.js?rev=0'
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => { ran.push('a'); return { marker: 'a' } } }, { gated: [url] })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `first` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const first = b.loader.import('a', '', {})
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `second` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const second = b.loader.import('a', '', {})
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `third` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const third = b.loader.prefetch('a')
    b.gates.get(url)?.()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `[s1, s2]` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const [s1, s2] = await Promise.all([first, second, third])
    expect(s1).toBe(s2)
    expect(b.fetched).toEqual([url])
    expect(ran).toEqual(['a'])
  })

  it('prefetch after registration is a no-op without invalidate', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => ({}) })
    await b.loader.prefetch('a')
    await b.loader.prefetch('a')
    expect(b.fetched).toHaveLength(1)
  })
})

describe('require resolution', () => {
  it('a factory requiring a registered-but-unmaterialized module materializes it recursively', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `order` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const order: string[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a'), row('b')], {
      a: (req) => {
        order.push('a')
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `dep` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const dep = req('b/client') as { helper: string }
        return { got: dep.helper }
      },
      b: () => { order.push('b'); return { helper: 'from-b' } },
    })
    await b.loader.prefetch('a')
    await b.loader.prefetch('b')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('a', '', {})
    expect((exports as { got: string }).got).toBe('from-b')
    expect(order).toEqual(['a', 'b'])
    expect(b.loader.loadCache.get('a')?.edges.has('b/client')).toBe(true)
    expect(b.loader.loadCache.has('b')).toBe(true)
  })

  it('require prefers the platform seed word over the module table', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `react` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const react = { marker: 'react' }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a')], {
      a: req => ({ dep: req('react') }),
    }, { seed: { react } })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('a', '', {})
    expect((exports as { dep: unknown }).dep).toBe(react)
    expect(await b.loader.import('react', '', {})).toBe(react)
    expect(b.loader.loadCache.has('react')).toBe(false)
  })

  it('require answers an already-materialized module from the cache', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `built` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let built = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a'), row('c')], {
      a: req => ({ dep: req('c') }),
      c: () => { built += 1; return { marker: 'c' } },
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `c` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const c = await b.loader.import('c', '', {})
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `a` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const a = await b.loader.import('a', '', {})
    expect((a as { dep: unknown }).dep).toBe(c)
    expect(built).toBe(1)
  })

  it('a require that misses the module table is loud', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: req => ({ dep: req('ghost') }) })
    await expect(b.loader.import('a', '', {})).rejects.toThrow('require("ghost") missed the module table')
  })

  it('a require cycle is fatal', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a'), row('b')], {
      a: req => ({ dep: req('b') }),
      b: req => ({ dep: req('a') }),
    })
    await b.loader.prefetch('b')
    await expect(b.loader.import('a', '', {})).rejects.toThrow('require cycle through "a"')
  })
})

describe('bootstrap module', () => {
  it('caches the materialized modules exports under the package id and /client alias', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([
      row('consumer', { external: [`${MODULES_ID}/client`] }),
      row(MODULES_ID),
    ], {
      consumer: req => ({ dep: req(`${MODULES_ID}/client`) }),
    })
    await b.loader.prefetch(MODULES_ID)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('consumer', '', {}) as { dep: unknown }
    expect(exports.dep).toBe(bootstrapExports)
    expect(await b.loader.import(`${MODULES_ID}/client`, '', {})).toBe(bootstrapExports)
    expect(b.fetched).toEqual(['/plugins/consumer/client.js?rev=0'])
  })

  it('publishes the same closed-over system when the modules Cordis plugin activates', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([])
    /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    apply(ctx)
    expect(ctx.modules).toBe(b.loader)
  })

  it('rejects a second queued registration for the bootstrap id', () => {
    expect(() => bench([], {}, {
      pending: [{ id: `${MODULES_ID}/client`, factory: () => ({}) }],
    })).toThrow(`duplicate factory registration for "${MODULES_ID}/client"`)
  })
})

describe('failure modes', () => {
  it('duplicate factory registration is loud', () => {
    bench([])
    win.__ModuleLoader__?.load({ id: 'x', factory: () => ({}) })
    expect(() => win.__ModuleLoader__?.load({ id: 'x', factory: () => ({}) }))
      .toThrow('duplicate factory registration for "x"')
  })

  it('a bundle that never registers its id is loud', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a')], { a: null })
    await expect(b.loader.import('a', '', {})).rejects.toThrow('without registering "a"')
  })

  it('an unknown import specifier is loud', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([])
    await expect(b.loader.import('nope', '', {})).rejects.toThrow('cannot resolve "nope"')
  })

  it('an unknown prefetch id is loud', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([])
    await expect(b.loader.prefetch('nope')).rejects.toThrow('prefetch("nope") — not a graph entry')
  })

  it('a duplicate graph entry is loud at construction', () => {
    expect(() => bench([row('a'), row('a')])).toThrow('duplicate graph entry "a"')
  })

  it('a module arrival cycle is loud even if a malformed host graph reaches the browser', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([
      row('a', { external: ['b'] }),
      row('b', { external: ['a'] }),
    ])
    await expect(b.loader.prefetch('a')).rejects.toThrow('module arrival cycle a -> b -> a')
  })

  it('double boot is loud', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([])
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `options` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const options: ClientModuleCreateOptions = {
      boot: { rev: 'graph', entries: [] },
      staticModules: {},
    }
    expect(() => b.target.create(options)).toThrow('create called after module-system boot')
  })
})

describe('boot manifest wire', () => {
  it('normalizes absent shared-module fields and carries the declared ones', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `manifest` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const manifest = parseBootManifest({
      rev: 'graph',
      entries: [
        { id: 'a', url: '/plugins/a/client.js', rev: '1' },
        { id: 'b', url: '/plugins/b/client.js', rev: '2', external: ['react'] },
      ],
    })
    expect(manifest.modules).toEqual([
      { id: 'a', url: '/plugins/a/client.js', rev: '1', external: [] },
      { id: 'b', url: '/plugins/b/client.js', rev: '2', external: ['react'] },
    ])
  })

  it('rejects a non-array external', () => {
    expect(() => parseBootManifest({
      rev: 'graph',
      entries: [{ id: 'a', url: '/a', rev: '1', external: 'react' }],
    })).toThrow('client-modules: boot manifest entry "a" external must be a string array')
  })
})

describe('HMR reset', () => {
  it('invalidate drops the factory and record so the module reloads and re-registers', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `generation` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let generation = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => ({ generation: ++generation }) })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `first` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const first = await b.loader.import('a', '', {})
    b.loader.invalidate('a')
    expect(b.loader.loadCache.has('a')).toBe(false)
    await b.loader.prefetch('a')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `second` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const second = await b.loader.import('a', '', {})
    expect(b.fetched).toHaveLength(2)
    expect((first as { generation: number }).generation).toBe(1)
    expect((second as { generation: number }).generation).toBe(2)
  })
})

describe('style claiming', () => {
  it('claims untagged style tags for the materializing plugin and inventories owned css ids', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `foreign` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const foreign = document.createElement('style')
    foreign.setAttribute('data-plugin', 'other')
    document.head.appendChild(foreign)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('a')], {
      a: () => {
        document.head.appendChild(document.createElement('style'))
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `tagged` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const tagged = document.createElement('style')
        tagged.setAttribute('data-plugin', 'a')
        tagged.setAttribute('data-plugin-css', 'sheet-1')
        document.head.appendChild(tagged)
        return {}
      },
    })
    await b.loader.import('a', '', {})
    expect(b.loader.loadCache.get('a')?.styles).toEqual(['a', 'sheet-1'])
    expect(document.querySelectorAll('style[data-plugin="a"]')).toHaveLength(2)
    expect(foreign.getAttribute('data-plugin')).toBe('other')
  })

  it('materialization without a document skips the style inventory', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const b = bench([row('a')], { a: () => ({}) })
    vi.stubGlobal('document', undefined)
    try {
      await b.loader.import('a', '', {})
    } finally {
      vi.unstubAllGlobals()
    }
    expect(b.loader.loadCache.get('a')?.styles).toEqual([])
  })
})

describe('default transport seam', () => {
  it('loads through an external classic script and removes the settled node', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `append` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `script` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const script = nodes[0]
      if (!(script instanceof HTMLScriptElement)) throw new Error('expected script node')
      expect(script.async).toBe(true)
      expect(script.getAttribute('src')).toBe('/plugins/dee/client.js?rev=0')
      queueMicrotask(() => {
        win.__ModuleLoader__?.load({ id: 'dee', factory: () => ({ marker: 'via-script' }) })
        script.dispatchEvent(new Event('load'))
      })
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('dee')], {}, { defaultTransport: true })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `exports` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const exports = await b.loader.import('dee', '', {})
    expect((exports as { marker: string }).marker).toBe('via-script')
    expect(append).toHaveBeenCalledOnce()
    expect([...document.querySelectorAll('script')]).toEqual([])
  })

  it('a script load failure is loud and removes the node', async () => {
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `script` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const script = nodes[0]
      if (!(script instanceof HTMLScriptElement)) throw new Error('expected script node')
      queueMicrotask(() => { script.dispatchEvent(new Event('error')) })
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `b` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const b = bench([row('dee')], {}, { defaultTransport: true })
    await expect(b.loader.prefetch('dee')).rejects.toThrow(
      'bundle script /plugins/dee/client.js?rev=0 failed to load',
    )
    expect([...document.querySelectorAll('script')]).toEqual([])
  })
})
