/**
 * Integration: the real fetch backend (`dsh-web-fetch-http`) + a real search provider
 * (`dsh-web-search-exa`) + the real seam (`dsh-web`) + the model tool (`dsh-tool-web`) + the
 * tool-call timeout policy (`dsh-tool-call-timeout-policy`), exercised through `ctx.tools.execute()` —
 * nothing bypasses the tool registry. Fetch verifies world effects against loopback HTTP; search
 * uses the real Exa provider with only its network boundary stubbed.
 */
/*
 * 文件职责：验证 integration.spec.ts 覆盖的Web 搜索与抓取行为与边界场景。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、HTTP、类型投影或异步资源控制。
 * 产品维度：保障 Agent 的Web 搜索与抓取能力稳定、可复现且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再转换并核对结果、错误与清理。
 * 关键边界：网络和生成数据不可信；超时与取消必须传播；临时资源必须可靠释放。
 * 新手阅读建议：先看公开类型和夹具，再读主流程，最后关注校验、超时与失败路径。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as WebFetchLocal from '@deepseek-ai/dsh-web-fetch-http'
import * as WebSearchExa from '@deepseek-ai/dsh-web-search-exa'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'

/** 中文说明：变量 testToolSignal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：type Handler 定义本测试所需的数据或行为，用于表达Web 搜索与抓取场景。 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void

/** 中文说明：变量 server 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let server: Server
/** 中文说明：变量 base 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let base: string
/** 中文说明：变量 handler 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let handler: Handler
/** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let ctx: Context
/** 中文说明：变量 fiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>Hello</h1><p>World</p>') }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProvider: WebSearchExa.EXA_PROVIDER_ID, fetchProvider: WebFetchLocal.LOCAL_FETCH_PROVIDER_ID })
  await ctx.plugin(WebFetchLocal, {})
  await ctx.plugin(WebSearchExa, { apiKey: 'exa-key', baseURL: 'https://api.exa.test' })
  // The shipped deployment shape: the tool-call budget is declared by tool-web
  // config (default 30s, attached as ToolDefinition.timeoutMs) and enforced by
  // the zero-config timeout-policy plugin, set above the provider backstop so the
  // policy normally wins.
  await ctx.plugin(TimeoutPolicy)
  fiber = await ctx.plugin(ToolWeb)
})

afterEach(async () => {
  await fiber.dispose()
  vi.unstubAllGlobals()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

/** 中文说明：变量 counter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
let counter = 0
/** 中文说明：函数 call 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function call(name: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(`call-${++counter}`), name, arguments: args })
}

describe('web_fetch integration over the real backend', () => {
  it('fetches an html page and renders it to markdown', async () => {
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await call('web_fetch', { url: base })
    expect(out.isError).toBe(false)
    /** 中文说明：函数值 text 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const text = out.content.map(b => b.type === 'text' ? b.text : '').join('')
    expect(text).toContain(`Fetched ${base}`)
    expect(text).toContain('# Hello')
    expect(text).toContain('World')
  })

  it('reports a 404 as a result, not an error', async () => {
    handler = (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('missing') }
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await call('web_fetch', { url: base })
    expect(out.isError).toBe(false)
    expect(out.content.map(b => b.type === 'text' ? b.text : '').join('')).toContain('HTTP 404')
  })

  it('surfaces WEB_INVALID_URL as a structured tool error', async () => {
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await call('web_fetch', { url: 'ftp://example.com' })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('WEB_INVALID_URL')
  })

  it('surfaces a blocked cross-origin redirect as WEB_REDIRECT_BLOCKED', async () => {
    handler = (_req, res) => { res.writeHead(302, { location: 'https://example.com/' }); res.end() }
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await call('web_fetch', { url: base })
    expect(out.isError).toBe(true)
    expect(out.error?.info?.code).toBe('WEB_REDIRECT_BLOCKED')
  })
})

describe('web_search integration over the real Exa provider', () => {
  it('runs web_search end-to-end and formats the provider result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ results: [{ url: 'https://result.test', title: 'Result', highlights: ['a highlight'] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await call('web_search', { queries: ['deepseek-official'] })
    expect(out.isError).toBe(false)
    expect(out.content.map(b => b.type === 'text' ? b.text : '').join('')).toContain('[Result](https://result.test)')
  })
})

describe('tool-call timeout policy over the migrated web tools', () => {
  it('neither model schema exposes a timeout parameter after the migration', () => {
    /** 中文说明：函数值 byName 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const byName = new Map(ctx.tools.schemas().map(s => [s.name, s]))
    /** 中文说明：变量 fetchParams 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const fetchParams = byName.get('web_fetch')!.parameters as { properties: Record<string, unknown> }
    /** 中文说明：变量 searchParams 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const searchParams = byName.get('web_search')!.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(fetchParams.properties)).toEqual(['url'])
    expect('timeout_ms' in fetchParams.properties).toBe(false)
    expect(Object.keys(searchParams.properties)).toEqual(['queries'])
    expect(searchParams.required).toEqual(['queries'])
  })
})

describe('tool-call timeout returns TOOL_TIMEOUT (deadline wins over a slow fetch)', () => {
  /** 中文说明：变量 slowServer 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let slowServer: Server
  /** 中文说明：变量 slowBase 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let slowBase: string
  /** 中文说明：变量 openSockets 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let openSockets: ServerResponse[]
  /** 中文说明：变量 tctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let tctx: Context
  /** 中文说明：变量 tfiber 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let tfiber: Awaited<ReturnType<Context['plugin']>>

  beforeEach(async () => {
    // A server that never responds: it holds the connection open until the
    // client aborts. The cooperative deadline (via exec.signal → the fetch
    // provider → undici) is what ends the call.
    openSockets = []
    slowServer = createServer((_req, res) => { openSockets.push(res) })
    await new Promise<void>(resolve => slowServer.listen(0, '127.0.0.1', resolve))
    slowBase = `http://127.0.0.1:${(slowServer.address() as AddressInfo).port}`

    tctx = new Context()
    await tctx.plugin(SystemPrompt)
    await tctx.plugin(ToolRuntime)
    await tctx.plugin(WebRuntime, { fetchProvider: WebFetchLocal.LOCAL_FETCH_PROVIDER_ID })
    // Provider backstop well ABOVE the tool-call budget, so the policy wins.
    await tctx.plugin(WebFetchLocal, { timeoutMs: 30_000 })
    await tctx.plugin(TimeoutPolicy)
    // The tool-call budget is declared by tool-web config, enforced by the policy.
    tfiber = await tctx.plugin(ToolWeb, { fetchTimeoutMs: 50 })
  })

  afterEach(async () => {
    /** 中文说明：该循环依次处理输入或结果；循环变量仅在当前循环中有效。 */
    for (const res of openSockets) res.destroy()
    await tfiber.dispose()
    await new Promise<void>(resolve => slowServer.close(() => { resolve() }))
  })

  it('returns a structured TOOL_TIMEOUT (not the provider WEB_FETCH_TIMEOUT) when the tool-call budget wins', async () => {
    /** 中文说明：变量 out 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const out = await tctx.tools.execute({ signal: testToolSignal, callId: CallId('slow-1'), name: 'web_fetch', arguments: { url: slowBase } })
    expect(out.isError).toBe(true)
    // The outer tool-call deadline won: TOOL_TIMEOUT, owned by dsh-tool-call-timeout-policy,
    // NOT the provider's own WEB_FETCH_TIMEOUT (its 30s backstop never fired).
    expect(out.error?.info?.code).toBe('TOOL_TIMEOUT')
    /** 中文说明：函数值 text 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const text = out.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(text).toContain('timed out after 50ms')
  })

  it('the provider backstop still protects a direct provider call (no tool-call policy in that path)', async () => {
    // A direct provider caller bypasses tools/execute, so a short configured backstop
    // must produce provider-owned WEB_FETCH_TIMEOUT rather than TOOL_TIMEOUT.
    /** 中文说明：变量 direct 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const direct = new WebFetchLocal.HttpFetchProvider({
      maxUrlLength: 2048,
      maxResponseBytes: 5_000_000,
      maxBodyChars: 100_000,
      timeoutMs: 50,
      maxRedirects: 5,
      userAgent: 'integration-test',
    })
    /** 中文说明：变量 err 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const err = await direct.fetch({ url: slowBase }).then(
      () => undefined,
      (e: unknown) => e as { code?: string },
    )
    expect(err?.code).toBe('WEB_FETCH_TIMEOUT')
  })
})
