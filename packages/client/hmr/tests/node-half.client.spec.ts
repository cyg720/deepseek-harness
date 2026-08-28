/**
 * Node half of the HMR plugin: bundle watches follow the graph, stat changes
 * report through clientModuleHost.rebuilt, and everything dies with the fiber.
 */
/*
 * 文件职责：验证客户端热模块替换节点的更新接收、模块重载和失败恢复行为。
 * 技术维度：Cordis、Vitest、模拟模块加载器与异步更新事件。
 * 产品维度：保证开发模式下界面代码更新后无需整页刷新即可可靠生效。
 * 逻辑维度：装载 HMR 节点，推送不同更新消息，观察模块状态、日志和清理结果。
 * 关键边界：只覆盖客户端节点协议；模拟全局状态和监听器必须在用例后恢复。
 * 新手阅读建议：先看测试装载辅助函数，再按成功更新、无效消息和失败场景阅读。
 */
import { mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientArtifactBaseline, ClientModuleRegistry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, Config, EVENTS_ENDPOINT, inject } from '../src/index.ts'

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `POLL_MS` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const POLL_MS = 20

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `dir: string` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/**
 * Controllable clientModuleHost fake over a mutable id → bundle-path table.
 * Structural (Pick+cast): the plugin only touches the read/notify surface;
 * the service class carries private scan state a literal need not reproduce.
 */
/* 中文说明：类型 `FakeHost` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
type FakeHost = ClientModuleRegistry & { rebuiltCalls: string[]; fireGraphChanged(): void }
/** 中文说明：类型 `FakeHostOptions` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface FakeHostOptions {
  beforeGraphRead?: () => void
  rebuilt?: (id: string) => string | undefined
}

function artifactBaseline(path: string): ClientArtifactBaseline {
  const bundle = statSync(path)
  return { path, mtimeMs: bundle.mtimeMs, size: bundle.size }
}

function fakeClientModuleHost(rows: Map<string, string>, options: FakeHostOptions = {}): FakeHost {
  /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `graphListeners` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const graphListeners = new Set<() => void>()
  /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `rebuiltCalls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const rebuiltCalls: string[] = []
  const baselines = new Map([...rows].map(([id, path]) => [id, artifactBaseline(path)]))
  const fake: Pick<FakeHost, 'graph' | 'artifactBaseline' | 'rebuilt' | 'onRebuilt' | 'onGraphChanged' | 'rebuiltCalls' | 'fireGraphChanged'> = {
    rebuiltCalls,
    fireGraphChanged: () => { for (const l of graphListeners) l() },
    graph: (): WebBootGraph => {
      options.beforeGraphRead?.()
      return {
        rev: 'r',
        entries: [...rows.keys()].map(id => ({ id, url: `/plugins/??${id}/client.js&rev=r`, rev: 'r' })),
        batches: [],
      }
    },
    artifactBaseline: (id) => {
      const path = rows.get(id)
      if (path === undefined) return undefined
      let baseline = baselines.get(id)
      if (baseline?.path !== path) {
        baseline = artifactBaseline(path)
        baselines.set(id, baseline)
      }
      return { ...baseline }
    },
    rebuilt: (id) => {
      rebuiltCalls.push(id)
      return options.rebuilt?.(id) ?? 'r2'
    },
    onRebuilt: () => () => {},
    onGraphChanged: (listener) => {
      graphListeners.add(listener)
      return () => { graphListeners.delete(listener) }
    },
  }
  return fake as FakeHost
}

// Structural fake: the plugin only touches register(); the service class
// carries private state a literal cannot (and need not) reproduce.
/** 中文说明：测试辅助函数 `fakeHttpServer`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function fakeHttpServer(routes: WebRoute[]): WebServer {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fake` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const fake: Pick<WebServer, 'register' | 'tapIndex' | 'port'> = {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
  return fake as WebServer
}

/** 中文说明：测试辅助函数 `mount`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
async function mount(clientModuleHost: FakeHost, webServer: WebServer) {
  /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  ctx.provide('clientModules', clientModuleHost)
  ctx.provide('webServer', webServer)
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const fiber = ctx.plugin(
    { inject: [...inject], Config, apply },
    { pollIntervalMs: POLL_MS },
  )
  await fiber.await()
  return fiber
}

describe('hmr node half', () => {
  it('watches graph bundles, ignores map-only changes, and unwatches on dispose', async () => {
    const bundle = join(dir, 'a.js')
    writeFileSync(bundle, 'v1')
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientModuleHost` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientModuleHost = fakeClientModuleHost(new Map([['pkg-a', bundle]]))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = await mount(clientModuleHost, fakeHttpServer(routes))

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'exact', path: EVENTS_ENDPOINT })
    expect(clientModuleHost.rebuiltCalls).toEqual([])

    // Nudge mtime past stat granularity so the poller sees a content signal.
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 2))
    writeFileSync(bundle, 'v2-longer')
    await vi.waitFor(() => { expect(clientModuleHost.rebuiltCalls).toContain('pkg-a') }, { timeout: 3_000 })

    clientModuleHost.rebuiltCalls.length = 0
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 2))
    writeFileSync(`${bundle}.map`, '{"version":3}')
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 3))
    expect(clientModuleHost.rebuiltCalls).toEqual([])

    writeFileSync(bundle, 'v3-even-longer')
    await vi.waitFor(() => { expect(clientModuleHost.rebuiltCalls).toContain('pkg-a') }, { timeout: 3_000 })

    await fiber.dispose()
    expect(routes).toHaveLength(0)
    // Watcher gone: further file changes report nothing.
    clientModuleHost.rebuiltCalls.length = 0
    writeFileSync(bundle, 'v4-after-dispose')
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 4))
    expect(clientModuleHost.rebuiltCalls).toHaveLength(0)
  })

  it('follows graph changes: rows added after activation get watched', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `early` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const early = join(dir, 'early.js')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `late` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const late = join(dir, 'late.js')
    writeFileSync(early, 'v1')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rows` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const rows = new Map([['pkg-early', early]])
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientModuleHost` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientModuleHost = fakeClientModuleHost(rows)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = await mount(clientModuleHost, fakeHttpServer([]))
    clientModuleHost.rebuiltCalls.length = 0

    writeFileSync(late, 'v1')
    rows.set('pkg-late', late)
    clientModuleHost.fireGraphChanged()
    expect(clientModuleHost.rebuiltCalls).toEqual([])

    await new Promise(resolve => setTimeout(resolve, POLL_MS * 2))
    writeFileSync(late, 'v2-longer')
    await vi.waitFor(() => { expect(clientModuleHost.rebuiltCalls).toContain('pkg-late') }, { timeout: 3_000 })

    rows.delete('pkg-late')
    clientModuleHost.fireGraphChanged()
    clientModuleHost.rebuiltCalls.length = 0
    writeFileSync(late, 'v3-even-longer')
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 3))
    expect(clientModuleHost.rebuiltCalls).toHaveLength(0)
    await fiber.dispose()
  })

  it('rehashes only a row changed between its startup snapshot and watch installation', async () => {
    const bundle = join(dir, 'construction.js')
    writeFileSync(bundle, 'v1')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `rewrite` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let rewrite = true
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientModuleHost` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientModuleHost = fakeClientModuleHost(new Map([['pkg-a', bundle]]), {
      beforeGraphRead: () => {
        if (!rewrite) return
        rewrite = false
        writeFileSync(bundle, 'v2-written-during-watch-construction')
      },
    })

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = await mount(clientModuleHost, fakeHttpServer([]))

    expect(clientModuleHost.rebuiltCalls).toEqual(['pkg-a'])
    clientModuleHost.rebuiltCalls.length = 0
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 3))
    expect(clientModuleHost.rebuiltCalls).toHaveLength(0)
    await fiber.dispose()
  })

  it('marks a vanished bundle dirty so identical metadata still re-hashes after it reappears', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bundle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const bundle = join(dir, 'replace.js')
    writeFileSync(bundle, 'seed')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fixedTime` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fixedTime = new Date(1_600_000_000_000)
    utimesSync(bundle, fixedTime, fixedTime)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `baseline` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const baseline = statSync(bundle)
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientModuleHost` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientModuleHost = fakeClientModuleHost(new Map([['pkg-a', bundle]]))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = await mount(clientModuleHost, fakeHttpServer([]))
    clientModuleHost.rebuiltCalls.length = 0

    unlinkSync(bundle)
    await new Promise(resolve => setTimeout(resolve, POLL_MS * 2))
    writeFileSync(bundle, 'x'.repeat(baseline.size))
    utimesSync(bundle, fixedTime, fixedTime)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `restored` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const restored = statSync(bundle)
    expect({ mtimeMs: restored.mtimeMs, size: restored.size }).toEqual({
      mtimeMs: baseline.mtimeMs,
      size: baseline.size,
    })
    await vi.waitFor(() => { expect(clientModuleHost.rebuiltCalls).toEqual(['pkg-a']) }, { timeout: 3_000 })
    await fiber.dispose()
  })

  it('retains a dirty baseline when a catch-up re-hash races a rename', async () => {
    const bundle = join(dir, 'rename.js')
    writeFileSync(bundle, 'v1')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `first` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let first = true
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientModuleHost` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientModuleHost = fakeClientModuleHost(new Map([['pkg-a', bundle]]), {
      beforeGraphRead: () => {
        if (!first) return
        writeFileSync(bundle, 'v2-written-during-watch-construction')
      },
      rebuilt: () => {
        if (!first) return 'r2'
        first = false
        throw Object.assign(new Error('bundle renamed'), { code: 'ENOENT' })
      },
    })

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = await mount(clientModuleHost, fakeHttpServer([]))

    await vi.waitFor(() => { expect(clientModuleHost.rebuiltCalls).toEqual(['pkg-a', 'pkg-a']) }, { timeout: 3_000 })
    await fiber.dispose()
  })
})
