/**
 * 文件职责：验证宿主连接插件的路由注册、来源防护、RPC 通道、共享拦截和真实 HTTP 服务行为。
 * 技术维度：Cordis Context、Node HTTP/流测试替身、Vitest、Fetch 信封和 Web 路由接口。
 * 产品维度：保证宿主只向允许的浏览器来源提供 API，并让插件 RPC 随生命周期正确挂载和撤销。
 * 逻辑维度：用辅助函数装载插件并构造请求响应，逐类测试路由、信任策略、协议错误和网络监听。
 * 关键边界：高权限与可信宿主规则属于安全行为；物理路由清理和异步服务关闭必须完成。
 * 新手阅读建议：先读 fakeHttpServer、fakeRequest、fakeResponse、mounted，再按路由安全和 RPC 注册分组阅读。
 */
/** Node half: registers the /api prefix route bridging to the api gateway. */
/* 文件职责：验证宿主路由与 RPC 注册。技术维度：Cordis、Node HTTP 和 Fetch。产品维度：安全提供浏览器 API。逻辑维度：装载路由后驱动请求。关键边界：信任规则和清理属于安全不变量。新手阅读建议：先读四个测试辅助函数。 */
import { EventEmitter, once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { RpcId, type ClientRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH, apply, HOST_EVENTS_PATH, inject, MUX_EVENTS_PATH, type HostConnectionHandle } from '../src/index.ts'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from '../src/http-bridge.ts'

/** Structural webServer fake recording both route registries. */
/* 中文说明：测试辅助函数 `fakeHttpServer`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      if (routes.some(candidate => candidate.kind === route.kind && candidate.path === route.path)) {
        throw new Error(`duplicate route ${route.path}`)
      }
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

/** Bodyless GET carrying the given headers (enough for the trust fence + bridge). */
/* 中文说明：测试辅助函数 `fakeRequest`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function fakeRequest(headers: Record<string, string>, url = `${API_PATH}/session.list`): IncomingMessage {
  /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'GET', headers })
  return request
}

/** JSON POST carrying a complete client-request envelope. */
/* 中文说明：测试辅助函数 `fakePost`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function fakePost(headers: Record<string, string>, url: string, body: unknown): IncomingMessage {
  /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers: { 'content-type': 'application/json', ...headers } })
  return request
}

/** Raw POST for malformed-body and media-type boundary cases. */
/* 中文说明：测试辅助函数 `fakeRawPost`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function fakeRawPost(headers: Record<string, string>, url: string, body: string): IncomingMessage {
  /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'POST', headers })
  return request
}

/** Response recorder compatible with both the fence's short-circuit and the bridge. */
/* 中文说明：测试辅助函数 `fakeResponse`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
function fakeResponse(): { response: ServerResponse; state: { status?: number; body?: unknown } } {
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `state` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const state: { status?: number; body?: unknown } = {}
  /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `chunks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const chunks: Buffer[] = []
  /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(value: number) { state.status = value; return this },
    write(value: string | Uint8Array) { chunks.push(Buffer.from(value)); return true },
    end(this: { writableEnded: boolean }, value?: unknown) {
      if (typeof value === 'string' || value instanceof Uint8Array) chunks.push(Buffer.from(value))
      else if (value !== undefined) throw new TypeError('fake response only accepts string or Uint8Array bodies')
      if (chunks.length > 0) state.body = Buffer.concat(chunks).toString()
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return { response, state }
}

/** 中文说明：测试辅助函数 `mounted`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
async function mounted(config?: { trustedHosts?: string[] }): Promise<{
  routes: WebRoute[]
  upgrades: WebUpgradeRoute[]
  dispose: () => Promise<void>
}> {
  /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const ctx = new Context()
  /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const routes: WebRoute[] = []
  /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `upgrades` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const upgrades: WebUpgradeRoute[] = []
  ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
  ctx.provide('apiProxy', {} as unknown as ApiProxy)
  /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { routes, upgrades, dispose: () => fiber.dispose() }
}

describe('connection node half', () => {
  it('reserves enough default carrier capacity for the 200 MiB image batch', () => {
    expect(DEFAULT_MAX_REQUEST_BODY_BYTES).toBe(300 * 1024 * 1024)
    expect(DEFAULT_MAX_REQUEST_BODY_BYTES).toBeGreaterThan(Math.ceil(200 * 1024 * 1024 * 4 / 3) + 1024 * 1024)
  })

  it('fails loud when the carrier cap cannot hold the configured image batch', () => {
    /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    ctx.provide('attachments', {
      imageLimits: { maxMessageImageBytes: 20 * 1024 * 1024 },
    } as AttachmentStore)
    ctx.provide('apiProxy', {} as ApiProxy)
    expect(() => { apply(ctx, { maxRequestBodyBytes: 1024 }) })
      .toThrow(/must be at least .* aggregate image limit/)
    expect(routes).toHaveLength(0)
  })

  it('fails the load on a trustedHosts entry that is not a bare authority', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `upgrades` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const upgrades: WebUpgradeRoute[] = []
    /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer(routes, upgrades) as WebServer)
    ctx.provide('apiProxy', {} as unknown as ApiProxy)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.internal/path'] })
    await expect(fiber).rejects.toThrow(/not a bare host\[:port\] authority/)
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('registers one HTTP route plus one upgrade route per downlink and removes all three with the fiber', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, upgrades, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, upgrades, dispose } = await mounted()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })
    expect(upgrades.map(route => route.path)).toEqual([MUX_EVENTS_PATH, HOST_EVENTS_PATH])
    await dispose()
    expect(routes).toHaveLength(0)
    expect(upgrades).toHaveLength(0)
  })

  it('requires WebSocket upgrade for network GETs to either event path', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, dispose } = await mounted()
    /** 中文说明：当前请求或临时服务使用的地址信息；变量 `path` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const path of [MUX_EVENTS_PATH, HOST_EVENTS_PATH]) {
      /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `{ response, state }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const { response, state } = fakeResponse()
      await routes[0]!.handler(fakeRequest({ host: '127.0.0.1:3080' }, path), response)
      expect(state.status).toBe(426)
      expect(state.body).toBe('upgrade required')
    }
    await dispose()
  })

  it('rejects an untrusted WebSocket upgrade before protocol negotiation', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ upgrades, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { upgrades, dispose } = await mounted()
    /** 中文说明：当前场景使用或观察的 WebSocket 或流套接字；变量 `socket` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const socket = new PassThrough()
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `chunks` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    /** 中文说明：固定异步执行顺序或等待生命周期事件的 Promise 或门控值；变量 `ended` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ended = once(socket, 'end')
    await upgrades[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }, MUX_EVENTS_PATH), socket, Buffer.alloc(0))
    await ended
    expect(Buffer.concat(chunks).toString()).toContain('HTTP/1.1 403 Forbidden')
    await dispose()
  })

  it('refuses an untrusted Host on any /api path before the bridge runs', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, dispose } = await mounted()
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `{ response, state }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { response, state } = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example', origin: 'http://harness.example', 'sec-fetch-site': 'same-origin',
    }), response)
    expect(state.status).toBe(403)
    expect(state.body).toBe('forbidden')
    await dispose()
  })

  it('pins privileged methods to loopback even for a declared trusted authority', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    // The privileged set: native dialogs plus the whole settings/credential
    // configuration plane, reads included, plus the one method that makes the
    // host fetch a caller-chosen URL. The same declared authority reaches
    // ordinary reads (carrier-level 404 from the empty proxy proves the fence
    // passed), but each privileged method stays loopback-only and 403s.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `method` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const method of [
      'host.pickDirectory', 'host.openPath',
      'settings.describe', 'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
      'credentials.describe', 'credentials.set', 'credentials.unset',
      'llm.discoverModels',
      // A composition names the plugins a session runs: reading one is
      // reconnaissance, and copy/remove/openDocument manage the roster and
      // drive the host desktop.
      'agentPreset.read', 'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
    ]) {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `denied` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const denied = fakeResponse()
      await routes[0]!.handler(
        fakeRequest({ host: 'harness.example' }, `${API_PATH}/${method}`),
        denied.response,
      )
      expect(denied.state.status).toBe(403)
      expect(denied.state.body).toBe('forbidden')
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `read` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const read = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: 'harness.example' }), read.response)
    expect(read.state.status).not.toBe(403)
    await dispose()
  })

  it('passes loopback and declared-authority requests through to the bridge', async () => {
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, dispose } = await mounted({ trustedHosts: ['harness.example:3080', '192.168.1.5'] })
    // Loopback, no browser markers (curl shape): the fence passes; the carrier
    // answers 404 for a GET unary path — proof the bridge ran.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loopback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loopback = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: '127.0.0.1:3080' }), loopback.response)
    expect(loopback.state.status).toBe(404)
    // An all-interfaces composition derives port-less LAN IP literals, which
    // pass markerless curl on any port.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `lan` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const lan = fakeResponse()
    await routes[0]!.handler(fakeRequest({ host: '192.168.1.5:3080' }), lan.response)
    expect(lan.state.status).toBe(404)
    // Declared public authority, same-origin browser shape.
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `declared` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const declared = fakeResponse()
    await routes[0]!.handler(fakeRequest({
      host: 'harness.example:3080', origin: 'http://harness.example:3080', 'sec-fetch-site': 'same-origin',
    }), declared.response)
    expect(declared.state.status).toBe(404)
    await dispose()
  })

  it('provides a disposable dedicated RPC channel without requiring apiProxy', async () => {
    /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: API_PATH })

    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `connection` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const connection = ctx.get('connection') as HostConnectionHandle
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `calls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const calls: unknown[] = []
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `remove` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const remove = connection.rpc.handle('/rpc', async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { accepted: true } }
    }, { authority: 'trusted-host' })
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `route` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const route = routes.find(candidate => candidate.path === '/rpc')
    expect(route).toBeDefined()

    /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-dedicated'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `result` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const result = fakeResponse()
    await route!.handler(fakePost({ host: '127.0.0.1:3080' }, '/rpc/goals/create', request), result.response)
    expect(result.state.status).toBe(200)
    expect(JSON.parse(String(result.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-dedicated',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    expect(() => connection.rpc.handle('/rpc', async () => ({ ok: true, value: null }), {
      authority: 'trusted-host',
    })).toThrow(/duplicate route/)
    await remove()
    expect(routes.map(candidate => candidate.path)).toEqual([API_PATH])
    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })

  it('dispatches claimed /api endpoints before the API Proxy fallback and withdraws the claim', async () => {
    /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    ctx.provide('apiProxy', {} as unknown as ApiProxy)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `connection` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const connection = ctx.get('connection') as HostConnectionHandle
    /** 中文说明：按发生顺序收集观测值的数组或记录集合；变量 `calls` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const calls: unknown[] = []
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `remove` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const remove = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { accepted: true } }
      },
      { authority: 'trusted-host' },
    )
    expect(() => connection.rpc.intercept(
      '/api',
      () => true,
      async () => ({ ok: true, value: null }),
      { authority: 'trusted-host' },
    )).toThrow('already has an interceptor')
    expect(() => connection.rpc.intercept(
      '/rpc' as '/api',
      () => true,
      async () => ({ ok: true, value: null }),
      { authority: 'trusted-host' },
    )).toThrow('invalid shared RPC channel')
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `route` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const route = routes.find(candidate => candidate.path === API_PATH)!
    /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const request: ClientRequest = {
      type: 'client-request',
      rpcId: RpcId('rpc-shared'),
      method: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `claimed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const claimed = fakeResponse()
    await route.handler(fakePost({ host: '127.0.0.1:3080' }, '/api/goals/create', request), claimed.response)
    expect(JSON.parse(String(claimed.state.body))).toEqual({
      type: 'server-response',
      rpcId: 'rpc-shared',
      result: { ok: true, value: { accepted: true } },
    })
    expect(calls).toEqual([{
      endpoint: 'goals/create',
      payload: { args: { agentId: 'agent-1' } },
    }])

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `denied` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/api/goals/create', request), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })
    expect(calls).toHaveLength(1)

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `unclaimed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const unclaimed = fakeResponse()
    await route.handler(fakeRequest({ host: '127.0.0.1:3080' }, '/api/session.list'), unclaimed.response)
    expect(unclaimed.state.status).toBe(404)

    await remove()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `withdrawn` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const withdrawn = fakeResponse()
    await route.handler(fakePost({ host: '127.0.0.1:3080' }, '/api/goals/create', request), withdrawn.response)
    expect(withdrawn.state.status).toBe(404)
    expect(calls).toHaveLength(1)

    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `removeLoopback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const removeLoopback = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async () => ({ ok: true, value: null }),
      { authority: 'loopback' },
    )
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `loopbackOnly` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loopbackOnly = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/api/goals/create', request), loopbackOnly.response)
    expect(loopbackOnly.state.status).toBe(403)
    await removeLoopback()
    await fiber.dispose()
  })

  it('applies the configured trust fence and JSON envelope checks to generic channels', async () => {
    /** 中文说明：当前测试使用的 Cordis 上下文或所属运行环境；变量 `ctx` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const ctx = new Context()
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `routes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const routes: WebRoute[] = []
    ctx.provide('webServer', fakeHttpServer(routes, []) as WebServer)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fiber` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const fiber = ctx.plugin({ inject: [...inject], apply }, { trustedHosts: ['harness.example'] })
    await fiber.await()
    /** 中文说明：当前场景驱动的连接或 API 测试对象；变量 `connection` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const connection = ctx.get('connection') as HostConnectionHandle
    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `remove` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const remove = connection.rpc.handle('/rpc', async (endpoint) => {
      if (endpoint === 'fail') throw new Error('handler broke')
      return { ok: true, value: null }
    }, {
      authority: 'trusted-host',
    })
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `route` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const route = routes.find(candidate => candidate.path === '/rpc')!

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `denied` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const denied = fakeResponse()
    await route.handler(fakePost({ host: 'other.example' }, '/rpc/goals/create', {}), denied.response)
    expect(denied.state).toMatchObject({ status: 403, body: 'forbidden' })

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `methodMismatch` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const methodMismatch = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/rpc/goals/create', {
      type: 'client-request', rpcId: 'rpc-bad', method: 'other', payload: {},
    }), methodMismatch.response)
    expect(JSON.parse(String(methodMismatch.state.body))).toMatchObject({
      rpcId: 'rpc-bad',
      result: { ok: false, error: { code: 'bad-request' } },
    })

    /** 中文说明：当前场景构造或发出的请求对象；变量 `[request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [request, status] of [
      [fakeRequest({ host: 'harness.example' }, '/rpc/goals/create'), 404],
      [fakePost({ host: 'harness.example' }, '/outside/goals/create', {}), 404],
      [fakePost({ host: 'harness.example' }, '/rpc/goals//create', {}), 404],
      [fakeRawPost({ host: 'harness.example' }, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ host: 'harness.example', 'content-type': 'text/plain' }, '/rpc/goals/create', '{}'), 415],
      [fakeRawPost({ host: 'harness.example', 'content-type': 'application/json; charset=utf-8' }, '/rpc/goals/create', '{'), 400],
    ] as const) {
      /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const response = fakeResponse()
      await route.handler(request, response.response)
      expect(response.state.status).toBe(status)
    }

    /** 中文说明：当前场景输入、传输或校验的数据；变量 `[body` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (const [body, rpcId] of [
      [{ rpcId: 'retained-id' }, 'retained-id'],
      [{ rpcId: 42 }, 'invalid-request'],
      [null, 'invalid-request'],
    ] as const) {
      /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `response` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const response = fakeResponse()
      await route.handler(fakePost({ host: 'harness.example' }, '/rpc/goals/create', body), response.response)
      expect(JSON.parse(String(response.state.body))).toMatchObject({
        rpcId,
        result: { ok: false, error: { code: 'bad-request' } },
      })
    }

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `failed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const failed = fakeResponse()
    await route.handler(fakePost({ host: 'harness.example' }, '/rpc/fail', {
      type: 'client-request', rpcId: 'rpc-fail', method: 'fail', payload: {},
    }), failed.response)
    expect(failed.state).toMatchObject({ status: 500, body: 'handler failure: Error: handler broke' })

    expect(() => connection.rpc.handle('/api', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })).toThrow('invalid or reserved RPC channel')
    expect(() => connection.rpc.handle('api3', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })).toThrow('invalid or reserved RPC channel')

    /** 中文说明：结束注册、订阅或异步等待的清理函数；变量 `removeLoopback` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const removeLoopback = connection.rpc.handle('/loopback', async () => ({ ok: true, value: null }), {
      authority: 'loopback',
    })
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `loopbackRoute` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const loopbackRoute = routes.find(candidate => candidate.path === '/loopback')!
    /** 中文说明：当前操作得到的响应或结果，供后续断言；变量 `publicResponse` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const publicResponse = fakeResponse()
    await loopbackRoute.handler(fakePost({ host: 'harness.example' }, '/loopback/read', {
      type: 'client-request', rpcId: 'rpc-public', method: 'read', payload: {},
    }), publicResponse.response)
    expect(publicResponse.state.status).toBe(403)
    await removeLoopback()
    await remove()
    await fiber.dispose()
  })
})

describe('connection node half over a real HTTP server', () => {
  /** Serve the registered prefix route from a real server and return its port. */
  /* 中文说明：测试辅助函数 `serve`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
  async function serve(routes: WebRoute[]): Promise<{ port: number; close: () => Promise<void> }> {
    /** 中文说明：当前场景使用的临时宿主或服务器对象；变量 `server` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const server = createServer((request, response) => {
      void routes[0]!.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `address` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const address = server.address() as AddressInfo
    return {
      port: address.port,
      close: () => new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      }),
    }
  }

  /** One real request; `host` spoofs the authority the way a LAN client's browser would send it. */
  /* 中文说明：测试辅助函数 `call`；参数含义见签名，返回值供当前场景驱动或断言；例如按下方测试调用方式使用。 */
  function call(port: number, method: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      /** 中文说明：当前场景构造或发出的请求对象；变量 `request` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      const request = httpRequest(
        { host: '127.0.0.1', port, path: `${API_PATH}/${method}`, method: 'GET', headers: { host } },
        (response) => {
          response.resume()
          response.on('end', () => { resolve(response.statusCode ?? 0) })
        },
      )
      request.on('error', reject)
      request.end()
    })
  }

  it('answers a declared LAN authority with 403 on every configuration method, over real HTTP', async () => {
    // The fence's input is a real IncomingMessage parsed by Node from the
    // wire, not a hand-assembled object: the Host header a LAN browser sends
    // is exactly what decides loopback-only here, so the boundary is asserted
    // against the parse the server actually performs.
    /** 中文说明：当前装载过程收集或选中的 Web 路由；变量 `{ routes, dispose }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { routes, dispose } = await mounted({ trustedHosts: ['harness.example'] })
    /** 中文说明：当前请求或临时服务使用的地址信息；变量 `{ port, close }` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const { port, close } = await serve(routes)
    try {
      // Reads are as privileged as writes: describe returns the exposed
      // configuration, and credentials.describe probes arbitrary env-var names.
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `method` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const method of [
        'settings.describe', 'settings.openDocument', 'settings.update', 'settings.replace', 'settings.mutate',
        'credentials.describe', 'credentials.set', 'credentials.unset',
        'host.pickDirectory', 'host.openPath',
        // Carries a draft credential and turns the host into a fetcher for a
        // URL the caller picked: an anonymous LAN caller must not reach it.
        'llm.discoverModels',
        'agentPreset.read', 'agentPreset.copy', 'agentPreset.openDocument', 'agentPreset.remove',
      ]) {
        expect([method, await call(port, method, 'harness.example')]).toEqual([method, 403])
      }
      // The model catalog stays reachable for the same authority: a LAN
      // client's model picker needs it, and it carries no key or endpoint
      // state (404 is the empty proxy's carrier answer — the fence passed).
      // `agentPreset.list` joins the model catalog for the same reason: ids and
      // trust only, and a LAN client's preset picker needs it. `select` is
      // reachable too: `session.create` already takes an `agentPreset`, and the
      // deployment's own default already carries bash, so pinning the switch
      // would be a fence beside an open gate.
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `method` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      for (const method of ['llm.providers', 'llm.models', 'agentPreset.list', 'agentPreset.select']) {
        expect([method, await call(port, method, 'harness.example')]).toEqual([method, 404])
      }
      // Loopback reaches everything, configuration included.
      expect(await call(port, 'settings.describe', `127.0.0.1:${String(port)}`)).toBe(404)
    } finally {
      await close()
      await dispose()
    }
  })
})
