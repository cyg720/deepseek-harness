/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver row, and every assertion observes the
 * user-visible HTTP surface of the running server (routing precedence, index
 * taps, fallback-seat semantics, per-request error containment, teardown).
 */
/**
 * 文件职责：验证宿主服务的 webserver.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证宿主服务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer, { renderIndexInjections } from '../src/index.ts'

/** 中文说明：测试局部值 root: string | undefined，由紧邻初始化决定。 */
let root: string | undefined
/** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a cordis.yml with one webserver row, then boot it through the real Loader. */
/** 中文说明：函数 loadComposition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function loadComposition(port = 0): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-webserver-loader-'))
  /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    `    port: ${String(port)}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** GET (by default) one path against the running server; returns status plus a body prefix. */
/** 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return { status: response.status, body: (await response.text()).slice(0, 80) }
}

/** Open one raw upgrade request and return after the handler writes its response. */
/** 中文说明：函数 upgrade 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function upgrade(port: number, path: string): Promise<ReturnType<typeof connect>> {
  /** 中文说明：测试局部值 socket，由紧邻初始化决定。 */
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    'Connection: Upgrade',
    'Upgrade: dsh-test',
    '',
    '',
  ].join('\r\n'))
  /** 中文说明：测试局部值 [data]，由紧邻初始化决定。 */
  const [data] = await response as [Buffer]
  expect(String(data)).toContain('101 Switching Protocols')
  return socket
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; first resolution after the host/client program split is slow enough
  // to trip the default 5s budget on cold caches.
  it('serves registered routes, index taps, and the fallback-seat semantics', { timeout: 60_000 }, async () => {
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定。 */
    const loaded = await loadComposition()
    /** 中文说明：测试局部值 unloaded，由紧邻初始化决定。 */
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = loaded.webServer
    expect(server).toBeInstanceOf(HttpServer)
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = server.port
    expect(port).toBeGreaterThan(0)

    // Routing precedence: exact beats prefix, longest prefix wins, a prefix
    // route answers its own path, and routes own their method handling
    // (POST reaches a registered prefix; 405 is fallback-only semantics).
    server.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('EXACT') } })
    server.register({ kind: 'prefix', path: '/api', handler: (_req, res) => { res.writeHead(200); res.end('API') } })
    server.register({ kind: 'prefix', path: '/api/deep', handler: (_req, res) => { res.writeHead(200); res.end('DEEP') } })
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })
    expect(await request(port, '/api/anything')).toMatchObject({ status: 200, body: 'API' })
    expect(await request(port, '/api/deep/leaf')).toMatchObject({ status: 200, body: 'DEEP' })
    expect(await request(port, '/api')).toMatchObject({ status: 200, body: 'API' })
    expect(await request(port, '/api/anything', { method: 'POST' })).toMatchObject({ status: 200, body: 'API' })

    // Fallback seat: 404 while unclaimed; the owner answers everything no
    // named route matches; index taps are the owner's to apply; the seat
    // admits exactly one owner and the disposer releases it.
    expect((await request(port, '/no/such/route')).status).toBe(404)
    /** 中文说明：测试局部值 untap，由紧邻初始化决定。 */
    const untap = server.tapIndex(html => html.replace('<head>', '<head><script>window.__T__=1</script>'))
    expect(server.applyIndexTaps('<head></head>')).toContain('__T__')
    /** 中文说明：测试局部值 releaseFallback，由紧邻初始化决定。 */
    const releaseFallback = server.registerFallback((req, res) => {
      // Decode like a real static server would — a malformed %-escape throws
      // here, probing the webserver's per-request error containment.
      decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(server.applyIndexTaps('<head></head><body>shell</body>'))
    })
    expect(() => server.registerFallback(() => {})).toThrow(/fallback already registered/)
    expect((await request(port, '/no/such/route')).body).toContain('__T__')
    untap()
    expect((await request(port, '/no/such/route')).body).not.toContain('__T__')
    expect((await request(port, '/no/such/route')).body).toContain('shell')

    // Per-request error containment: a malformed %-escape answers 400 and the
    // server keeps serving afterwards (no process-level failure path).
    expect((await request(port, '/%zz')).status).toBe(400)
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })

    // Duplicate (kind, path) is a misconfiguration and throws; the disposer
    // restores registrability (register/disposer symmetry).
    expect(() => server.register({ kind: 'exact', path: '/probe', handler: () => {} }))
      .toThrow(/duplicate exact route/)
    /** 中文说明：测试局部值 disposeOnce，由紧邻初始化决定。 */
    const disposeOnce = server.register({ kind: 'exact', path: '/once', handler: (_req, res) => { res.writeHead(200); res.end('ONCE') } })
    expect(await request(port, '/once')).toMatchObject({ status: 200, body: 'ONCE' })
    disposeOnce()
    expect((await request(port, '/once')).body).toContain('shell') // back to the fallback owner
    expect(() => server.register({ kind: 'exact', path: '/once', handler: () => {} })).not.toThrow()

    // Releasing the seat restores the unclaimed 404 and registrability.
    releaseFallback()
    expect((await request(port, '/no/such/route')).status).toBe(404)
    expect(() => server.registerFallback(() => {})).not.toThrow()

    // Upgrade routes match exact pathnames, reject duplicate ownership, and
    // become registrable again after disposal. The accepted socket stays open
    // so the teardown assertion also covers upgraded-connection ownership.
    /** 中文说明：测试局部值 upgradedServerClosed，由紧邻初始化决定。 */
    let upgradedServerClosed = false
    /** 中文说明：测试局部值 disposeUpgrade，由紧邻初始化决定。 */
    const disposeUpgrade = server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => {
        socket.once('close', () => { upgradedServerClosed = true })
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
      },
    })
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} }))
      .toThrow(/duplicate upgrade route/)
    /** 中文说明：测试局部值 upgraded，由紧邻初始化决定。 */
    const upgraded = await upgrade(port, '/events?stream=mux')
    disposeUpgrade()
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} })).not.toThrow()

    // The webserver contains raw-socket errors even before an upgrade handler
    // has installed its protocol implementation.
    server.registerUpgrade({
      path: '/upgrade-error',
      handler: async (_req, socket) => {
        await Promise.resolve()
        socket.destroy(new Error('test upgrade transport failure'))
      },
    })
    /** 中文说明：测试局部值 failedUpgrade，由紧邻初始化决定。 */
    const failedUpgrade = connect(port, '127.0.0.1')
    failedUpgrade.on('error', () => { /* The server-side reset is the fixture outcome. */ })
    await once(failedUpgrade, 'connect')
    /** 中文说明：测试局部值 failedUpgradeClosed，由紧邻初始化决定。 */
    const failedUpgradeClosed = once(failedUpgrade, 'close')
    failedUpgrade.write([
      'GET /upgrade-error HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Connection: Upgrade',
      'Upgrade: dsh-test',
      '',
      '',
    ].join('\r\n'))
    await failedUpgradeClosed
    expect(await request(port, '/probe')).toMatchObject({ status: 200, body: 'EXACT' })

    // Teardown closes both ordinary and upgraded sockets before it resolves.
    await loaded.fiber.dispose()
    expect(upgradedServerClosed).toBe(true)
    upgraded.destroy()
    await expect(request(port, '/probe')).rejects.toThrow()
  })

  it('collects injection rows fresh per render and layers taps over the rendered rows', { timeout: 60_000 }, async () => {
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定。 */
    const loaded = await loadComposition()
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = loaded.webServer
    /** 中文说明：测试局部值 flag，由紧邻初始化决定。 */
    let flag = 'dark'
    loaded.on('webserver/index-inject', (table) => {
      table.push(
        { kind: 'script', placement: 'head', text: 'window.__Q__=1' },
        { kind: 'script-src', placement: 'head', src: '/plugins/a.js?rev="1"&x=<y>' },
        { kind: 'global', name: '__DSH_BOOT__', value: { rev: '</script><b>' } },
        { kind: 'style', text: 'body{margin:0}' },
        { kind: 'html', placement: 'head', html: '<meta name="probe">' },
        { kind: 'script', placement: 'body', text: `window.__P__=${JSON.stringify(flag)}` },
      )
    })

    /** 中文说明：测试局部值 html，由紧邻初始化决定。 */
    const html = server.renderIndex('<html><head></head><body>shell</body></html>')
    // Head rows land right after the opening head tag in table order; the body
    // row lands right after the opening body tag.
    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order = [
      '<head>',
      '<script>window.__Q__=1</script>',
      '<script src="/plugins/a.js?rev=&quot;1&quot;&amp;x=&lt;y&gt;"></script>',
      'globalThis["__DSH_BOOT__"] = {"rev":"\\u003c/script>\\u003cb>"}',
      '<style>body{margin:0}</style>',
      '<meta name="probe">',
      '<body>',
      '<script>window.__P__="dark"</script>',
      'shell',
    ].map(part => html.indexOf(part))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every(at => at !== -1)).toBe(true)

    // Fresh collection per render: the listener reads live state at emit time.
    flag = 'light'
    expect(server.renderIndex('<head></head><body></body>')).toContain('window.__P__="light"')

    // Raw taps still run, over the already-rendered rows.
    /** 中文说明：测试局部值 untap，由紧邻初始化决定。 */
    const untap = server.tapIndex(h => h.replace('window.__Q__=1', 'window.__Q__=2'))
    expect(server.renderIndex('<head></head><body></body>')).toContain('window.__Q__=2')
    untap()

    // Tag-less fragments: head rows prepend, body rows append.
    expect(renderIndexInjections('<main>x</main>', [
      { kind: 'script', placement: 'head', text: 'H' },
      { kind: 'script', placement: 'body', text: 'B' },
    ])).toBe('<script>H</script><main>x</main><script>B</script>')
  })

  it('fails the fiber when the port is already taken (fail-loud at activation)', { timeout: 60_000 }, async () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await loadComposition()
    /** 中文说明：测试局部值 takenPort，由紧邻初始化决定。 */
    const takenPort = first.webServer.port
    /** 中文说明：测试局部值 firstRoot，由紧邻初始化决定。 */
    const firstRoot = root
    root = undefined // keep the first composition's files until the end

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let second: Context | undefined
    try {
      /** 中文说明：测试局部值 failure: unknown，由紧邻初始化决定。 */
      let failure: unknown
      try {
        await loadComposition(takenPort)
      } catch (error) {
        failure = error
      }
      second = context
      expect(String(failure)).toMatch(/failed to apply loader entry.*EADDRINUSE/)
    } finally {
      await second?.fiber.dispose()
      context = first
      if (root !== undefined) await rm(root, { recursive: true, force: true })
      root = firstRoot
    }
  })
})
