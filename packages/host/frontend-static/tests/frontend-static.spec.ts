/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver and frontend-static rows, and every
 * assertion observes the served HTTP surface — asset serving, explicit index
 * entry points with index taps, 404 misses, traversal rejection, 405 on non-
 * GET/HEAD, and seat release on fiber disposal (HMR safety).
 */
/*
 * 文件职责：验证宿主服务的 frontend-static.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis 服务、会话事件、持久状态、Node 宿主接口和 Vitest。
 * 产品维度：保证宿主服务在授权、等待、失败和清理场景中可靠。
 * 逻辑维度：构造服务和状态，驱动操作并断言事件与结果。
 * 关键边界：匿名标识不是认证；模型可见审批、提问和任务信息必须写入会话日志。
 * 新手阅读建议：先读类型与事件，再按注册、请求、状态变化和清理流程阅读。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as FrontendStatic from '../src/index.ts'

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

/** Write a dist fixture and a two-row cordis.yml, then boot it through the real Loader. */
/* 中文说明：函数 loadComposition 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function loadComposition(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-frontend-static-'))
  /** 中文说明：测试局部值 dist，由紧邻初始化决定。 */
  const dist = join(root, 'dist')
  await mkdir(dist)
  /** 中文说明：测试局部值 distIndex，由紧邻初始化决定。 */
  const distIndex = join(dist, 'index.html')
  await writeFile(distIndex, '<head></head><body>shell</body>')
  await writeFile(join(dist, 'app.js'), 'export {}')
  await writeFile(join(dist, 'blob.bin'), 'BLOB')
  await writeFile(join(dist, 'manifest.webmanifest'), '{}')
  await mkdir(join(dist, 'empty'))
  /** 中文说明：测试局部值 configPath，由紧邻初始化决定。 */
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: frontend',
    "  name: '@deepseek-ai/dsh-host-frontend-static'",
    '  config:',
    `    distIndex: '${distIndex}'`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  /** 中文说明：测试局部值 modules，由紧邻初始化决定。 */
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-host-frontend-static', FrontendStatic],
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

/** GET (by default) one path against the running server; returns status, content-type, and a body prefix. */
/* 中文说明：函数 request 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function request(port: number, path: string, init?: RequestInit): Promise<{ status: number; type: string | null; body: string }> {
  /** 中文说明：测试局部值 response，由紧邻初始化决定。 */
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, init)
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body: (await response.text()).slice(0, 80),
  }
}

describe('real Loader composition', () => {
  it('serves explicit index entries and files while preserving HTTP error semantics', { timeout: 60_000 }, async () => {
    /** 中文说明：测试局部值 loaded，由紧邻初始化决定。 */
    const loaded = await loadComposition()
    /** 中文说明：测试局部值 unloaded，由紧邻初始化决定。 */
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    /** 中文说明：测试局部值 server，由紧邻初始化决定。 */
    const server = loaded.webServer
    /** 中文说明：测试局部值 port，由紧邻初始化决定。 */
    const port = server.port

    // Real assets with their MIME types; a live rebuild is served on the next read.
    expect(await request(port, '/app.js')).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8', body: 'export {}' })
    expect(await request(port, '/manifest.webmanifest')).toMatchObject({
      status: 200,
      type: 'application/manifest+json',
      body: '{}',
    })
    expect(await request(port, '/app.js', { method: 'HEAD' })).toEqual({
      status: 200,
      type: 'text/javascript; charset=utf-8',
      body: '',
    })
    await writeFile(join(root!, 'dist', 'app.js'), 'export const rebuilt = true')
    expect(await request(port, '/app.js')).toMatchObject({ status: 200, body: 'export const rebuilt = true' })

    // Unknown extension ships as octet-stream.
    expect(await request(port, '/blob.bin')).toMatchObject({ status: 200, type: 'application/octet-stream', body: 'BLOB' })

    // Only the root and index path render index.html through registered taps.
    /** 中文说明：测试局部值 untap，由紧邻初始化决定。 */
    const untap = server.tapIndex(html => html.replace('<head>', '<head><script>window.__T__=1</script>'))
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    for (const path of ['/', '/index.html', '/?fixture']) {
      /** 中文说明：测试局部值 got，由紧邻初始化决定。 */
      const got = await request(port, path)
      expect(got.status).toBe(200)
      expect(got.type).toBe('text/html; charset=utf-8')
      expect(got.body).toContain('__T__')
      expect(got.body).toContain('shell')
    }
    expect(await request(port, '/', { method: 'HEAD' })).toEqual({
      status: 200,
      type: 'text/html; charset=utf-8',
      body: '',
    })
    untap()
    expect((await request(port, '/')).body).not.toContain('__T__')

    // A missing configured index follows the same empty-404 contract for both
    // of its public entry paths and for both supported methods.
    await rm(join(root!, 'dist', 'index.html'))
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    for (const path of ['/', '/index.html']) {
      /** 中文说明：测试局部值 get，由紧邻初始化决定。 */
      const get = await request(port, path)
      /** 中文说明：测试局部值 head，由紧邻初始化决定。 */
      const head = await request(port, path, { method: 'HEAD' })
      expect(get).toEqual({ status: 404, type: null, body: '' })
      expect(head).toEqual(get)
    }

    // Ordinary unknown paths and static-resource misses are empty 404s for
    // both GET and HEAD; neither class can be mistaken for the HTML shell.
    /** 中文说明：测试局部值 ordinaryMisses，由紧邻初始化决定。 */
    const ordinaryMisses = ['/no/such/route', '/api/no/such/route', '/empty', '/app.js/child']
    /** 中文说明：测试局部值 assetMisses，由紧邻初始化决定。 */
    const assetMisses = [
      '/missing.js',
      '/missing.css',
      '/missing.mjs',
      '/missing.js.map',
      '/missing.webmanifest',
      '/missing.manifest',
    ]
    /** 中文说明：测试局部值 path，由紧邻初始化决定。 */
    for (const path of [...ordinaryMisses, ...assetMisses]) {
      /** 中文说明：测试局部值 get，由紧邻初始化决定。 */
      const get = await request(port, path)
      /** 中文说明：测试局部值 head，由紧邻初始化决定。 */
      const head = await request(port, path, { method: 'HEAD' })
      expect(get).toEqual({ status: 404, type: null, body: '' })
      expect(head).toEqual(get)
    }

    // Traversal outside the dist root is 403, non-GET/HEAD is 405, and a
    // malformed filesystem target still reaches the webserver's 400 guard.
    expect((await request(port, '/..%2f..%2fetc%2fpasswd')).status).toBe(403)
    expect((await request(port, '/app.js', { method: 'POST' })).status).toBe(405)
    expect((await request(port, '/bad%00path')).status).toBe(400)

    // HMR safety: disposing the frontend row releases the fallback seat (the
    // unclaimed webserver answers 404) and the seat is claimable again.
    /** 中文说明：测试局部值 frontendEntry，由紧邻初始化决定。 */
    const frontendEntry = [...loaded.loader.entries()].find(e => e.options.id === 'frontend')
    expect(frontendEntry).toBeDefined()
    await frontendEntry!.fiber?.dispose()
    expect((await request(port, '/no/such/route')).status).toBe(404)
    expect(() => server.registerFallback(() => {})).not.toThrow()
  })
})
