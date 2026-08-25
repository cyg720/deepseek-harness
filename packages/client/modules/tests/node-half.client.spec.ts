/** Node-half composition diagnostics for package metadata and built client bundles. */
/*
 * 文件职责：验证客户端模块节点与宿主描述、连接状态和加载器之间的组装行为。
 * 技术维度：Cordis、Vitest、连接服务替身、响应式状态和模块加载器。
 * 产品维度：确保浏览器连接宿主后加载正确扩展模块，断线或配置变化时及时清理。
 * 逻辑维度：装载节点，发布宿主描述或连接状态，观察模块列表和生命周期调用。
 * 关键边界：描述版本与模块地址必须来自当前连接；重连不能保留旧宿主的模块实例。
 * 新手阅读建议：先看连接与加载器替身，再按首次连接、重连、错误和卸载场景阅读。
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { renderIndexInjections, type WebServer, type WebRoute } from '@deepseek-ai/dsh-host-webserver'
import * as modulesClient from '../src/client/index.ts'
import { ClientModuleRegistry, bootInjections, orderByModuleGraph } from '../src/index.ts'
import type { ClientModuleLoaderTarget, WebBootEntry, WebBootGraph } from '../src/client/index.ts'

/** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `MODULES_ID` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const MODULES_ID = '@deepseek-ai/dsh-client-modules'
/** 中文说明：标识对象、顺序或版本的标量值；变量 `RUNTIME_ID` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
const RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `root: string | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable package whose client export points at the returned path. */
/* 中文说明：测试辅助函数 `writePackage`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function writePackage(
  packageName: string,
  metadata: Record<string, unknown> = { dsh: { client: { platform: 'web' } } },
): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `pkgRoot` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    ...metadata,
  }))
  return clientPath
}

/** Create a built package with the supplied client declaration. */
/* 中文说明：测试辅助函数 `writeBuiltPackage`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function writeBuiltPackage(packageName: string, client: Record<string, unknown>): void {
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const clientPath = writePackage(packageName, { dsh: { client: { platform: 'web', ...client } } })
  mkdirSync(dirname(clientPath), { recursive: true })
  writeFileSync(clientPath, 'module.exports = {}\n')
}

/** Construct the node-half service and capture its plugin-bundle route. */
/* 中文说明：测试辅助函数 `constructWithRoute`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function constructWithRoute(packageNames: string[]): { service: ClientModuleRegistry; route: WebRoute } {
  /** 中文说明：当前操作所属的 Cordis 上下文；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const packageName of packageNames) {
        yield { options: { name: packageName }, fiber: {}, disabled: false }
      }
    },
  })
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `route: WebRoute | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  let route: WebRoute | undefined
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `webServer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: () => () => {},
  }
  ctx.provide('webServer', webServer as WebServer)
  /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `service` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const service = new ClientModuleRegistry(ctx)
  if (route === undefined) throw new Error('client bundle route was not registered')
  return { service, route }
}

/** Construct the node-half service over the enabled fixture entries. */
/* 中文说明：测试辅助函数 `construct`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function construct(packageNames: string[]): ClientModuleRegistry {
  return constructWithRoute(packageNames).service
}

/** Execute the exact first inline script emitted by the Host boot rows. */
/* 中文说明：测试辅助函数 `injectedFacade`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function injectedFacade(graph: WebBootGraph): { html: string; target: ClientModuleLoaderTarget } {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `html` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const html = renderIndexInjections(
    '<html><head></head><body><script type="module" src="/index.js"></script></body></html>',
    bootInjections(graph),
  )
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `source` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const source = /<head><script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (source === undefined) throw new Error('missing injected ModuleLoader facade script')
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `window` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const window: { __ModuleLoader__?: ClientModuleLoaderTarget } = {}
  runInNewContext(source, { window })
  if (window.__ModuleLoader__ === undefined) throw new Error('facade script did not install __ModuleLoader__')
  return { html, target: window.__ModuleLoader__ }
}

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `bootGraph` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const bootGraph = (): WebBootGraph => ({
  rev: 'graph',
  entries: [
    { id: MODULES_ID, url: '/plugins/modules.js?rev=m', rev: 'm' },
    { id: RUNTIME_ID, url: '/plugins/runtime.js?rev=r', rev: 'r' },
  ],
})

describe('HTML bootstrap facade', () => {
  it('precedes blocking preloads and the boot graph, then becomes the live registration target', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `graph` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const graph = bootGraph()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ html, target }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { html, target } = injectedFacade(graph)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `facadeAt` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const facadeAt = html.indexOf('window.__ModuleLoader__=')
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `modulesAt` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const modulesAt = html.indexOf('<script src="/plugins/modules.js?rev=m"></script>')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `runtimeAt` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const runtimeAt = html.indexOf('<script src="/plugins/runtime.js?rev=r"></script>')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `graphAt` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const graphAt = html.indexOf('globalThis["__DSH_BOOT__"] = ')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `entryAt` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const entryAt = html.indexOf('<script type="module" src="/index.js"></script>')
    expect([facadeAt, modulesAt, runtimeAt, graphAt, entryAt]).toEqual([...new Set([
      facadeAt, modulesAt, runtimeAt, graphAt, entryAt,
    ])].sort((a, b) => a - b))

    target.load({ id: MODULES_ID, factory: () => modulesClient })
    target.load({ id: RUNTIME_ID, factory: () => ({ marker: 'runtime' }) })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `system` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const system = target.create({ boot: graph, staticModules: {} })

    expect(target.mode).toBe('live')
    expect(target.pendingQueue).toEqual([])
    expect(system.manifest.rev).toBe('graph')
    expect(await system.import(MODULES_ID)).toBe(modulesClient)
    expect(await system.import(`${RUNTIME_ID}/client`)).toEqual({ marker: 'runtime' })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow('create called after module-system boot')
  })

  it('rejects a page that did not preload the modules bundle', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `graph` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const graph = bootGraph()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ target }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { target } = injectedFacade(graph)
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`HTML did not preload ${MODULES_ID}/client.js`)
  })

  it('rejects a bootstrap bundle with a runtime external', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `graph` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const graph = bootGraph()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ target }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { target } = injectedFacade(graph)
    target.load({
      id: MODULES_ID,
      factory: (require) => {
        require('react')
        return modulesClient
      },
    })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js requested external "react"`)
  })

  it.each([
    null,
    { ...modulesClient, createClientModuleSystem: undefined },
    { ...modulesClient, apply: undefined },
  ])('rejects a bootstrap bundle without the complete module face', (exports) => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `graph` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const graph = bootGraph()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ target }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { target } = injectedFacade(graph)
    target.load({ id: MODULES_ID, factory: () => exports as unknown as Record<string, unknown> })
    expect(() => target.create({ boot: graph, staticModules: {} }))
      .toThrow(`${MODULES_ID}/client.js did not export the bootstrap module face`)
  })
})

describe('client bundle activation', () => {
  it('allows sibling dsh roles', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `currentName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const currentName = '@fixture/current-client-field'
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientPath = writePackage(currentName, {
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    })
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    expect(construct([currentName]).graph().entries.map(entry => entry.id)).toEqual([currentName])
  })

  it('groups missing bundles under one source-build instruction with a package/path list', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `firstName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const firstName = '@fixture/missing-first'
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `secondName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const secondName = '@fixture/missing-second'
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `firstPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const firstPath = writePackage(firstName)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `secondPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const secondPath = writePackage(secondName)
    expect(() => construct([firstName, secondName])).toThrow([
      'client-modules: 2 client packages failed to compose:',
      '  client bundles not found; run `pnpm run build` before launch:',
      `    - package: ${firstName}`,
      `      path: ${firstPath}`,
      `    - package: ${secondName}`,
      `      path: ${secondPath}`,
    ].join('\n'))
  })

  it('does not report other bundle read failures as missing builds', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const packageName = '@fixture/unreadable-client'
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientPath = writePackage(packageName)
    mkdirSync(clientPath, { recursive: true })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `thrown: unknown` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let thrown: unknown
    try {
      construct([packageName])
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain('client-modules: 1 client package failed to compose:')
    expect(String(thrown)).toContain('  other failures:')
    expect(String(thrown)).toContain('EISDIR')
    expect(String(thrown)).not.toContain('pnpm run build')
  })

  it('serves the source map beside a registered client bundle', async () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const packageName = '@fixture/source-map'
    /** 中文说明：当前流程调用的客户端服务或测试替身；变量 `clientPath` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `map` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const map = '{"version":3,"sources":["src/client/index.tsx"]}\n'
    writeFileSync(`${clientPath}.map`, map)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `{ route }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { route } = constructWithRoute([packageName])
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `status` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let status = 0
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `headers: Record<string, string> | undefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let headers: Record<string, string> | undefined
    /** 中文说明：当前处理、发送或断言的事件及其数据；变量 `body` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    let body = ''
    /** 中文说明：当前异步操作的请求或结果；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const response = {
      writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
        status = nextStatus
        headers = nextHeaders
        return response
      },
      end(chunk?: Uint8Array) {
        body = chunk === undefined ? '' : Buffer.from(chunk).toString('utf8')
        return response
      },
    } as unknown as ServerResponse

    await route.handler({
      method: 'GET',
      url: `/plugins/${packageName}/client.js.map`,
    } as IncomingMessage, response)

    expect(status).toBe(200)
    expect(headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    })
    expect(body).toBe(map)
  })
})

describe('shared module declarations', () => {
  it('accepts external requests and carries them onto the graph row', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const packageName = '@fixture/shared-declared'
    writeBuiltPackage(packageName, { external: ['react'] })
    expect(construct([packageName]).graph().entries).toEqual([{
      id: packageName,
      url: expect.stringContaining(`/plugins/${packageName}/client.js?rev=`) as unknown as string,
      rev: expect.any(String) as unknown as string,
      external: ['react'],
    }])
  })

  it('omits external when the package declares no requests', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const packageName = '@fixture/shared-absent'
    writeBuiltPackage(packageName, {})
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `[row]` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const [row] = construct([packageName]).graph().entries
    expect(row).not.toHaveProperty('external')
  })

  it('rejects a non-array external', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `packageName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const packageName = '@fixture/external-not-array'
    writeBuiltPackage(packageName, { external: 'react' })
    expect(() => construct([packageName]))
      .toThrow(`client-modules: ${packageName} dsh.client.external must be a string array`)
  })
})

describe('module graph order', () => {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `entry` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const entry = (id: string, fields: Partial<WebBootEntry> = {}): WebBootEntry =>
    ({ id, url: `/plugins/${id}/client.js?rev=0`, rev: '0', ...fields })
  /** 中文说明：标识对象、顺序或版本的标量值；变量 `ids` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
  const ids = (entries: readonly WebBootEntry[]): string[] => entries.map(row => row.id)

  it('places every requested package row before its consumers along a chain', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['slots'] }),
      entry('slots', { external: ['render'] }),
      entry('render'),
    ]))).toEqual(['render', 'slots', 'ui'])
  })

  it('places a shared package row before both arms of a diamond', () => {
    expect(ids(orderByModuleGraph([
      entry('app', { external: ['left', 'right'] }),
      entry('left', { external: ['vendor'] }),
      entry('right', { external: ['vendor'] }),
      entry('vendor'),
    ]))).toEqual(['vendor', 'left', 'right', 'app'])
  })

  it('resolves a /client request onto the requested package row', () => {
    expect(ids(orderByModuleGraph([
      entry('ui', { external: ['runtime/client'] }),
      entry('runtime'),
    ]))).toEqual(['runtime', 'ui'])
  })

  it('leaves a request no row answers to the static assembly channel', () => {
    expect(ids(orderByModuleGraph([
      entry('consumer', { external: ['@deepseek-ai/cordis'] }),
      entry('other'),
    ]))).toEqual(['consumer', 'other'])
  })

  it('rejects a cycle and names the packages on it', () => {
    expect(() => orderByModuleGraph([
      entry('a', { external: ['b'] }),
      entry('b', { external: ['a'] }),
    ])).toThrow('client-modules: module graph cycle a -> b -> a')
  })

  it('rejects a row requesting its own package name', () => {
    expect(() => orderByModuleGraph([entry('solo', { external: ['solo'] })]))
      .toThrow('client-modules: "solo" requests module "solo" that it answers itself')
  })

  it('composes the served graph in module-graph order', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumerName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumerName = '@fixture/order-consumer'
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `dependencyName` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const dependencyName = '@fixture/order-dependency'
    writeBuiltPackage(consumerName, { external: [dependencyName] })
    writeBuiltPackage(dependencyName, {})
    expect(ids(construct([consumerName, dependencyName]).graph().entries))
      .toEqual([dependencyName, consumerName])
  })

  it('fails activation loud when scanned packages form a module cycle', () => {
    writeBuiltPackage('@fixture/cycle-a', { external: ['@fixture/cycle-b'] })
    writeBuiltPackage('@fixture/cycle-b', { external: ['@fixture/cycle-a'] })
    expect(() => construct(['@fixture/cycle-a', '@fixture/cycle-b']))
      .toThrow('module graph cycle @fixture/cycle-a -> @fixture/cycle-b -> @fixture/cycle-a')
  })
})
