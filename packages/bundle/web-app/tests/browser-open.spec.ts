/** Default-browser startup over a real Loader tree and listening Web server. */
/**
 * 文件职责：验证Web应用仅在真实Loader树稳定且页面可访问后才把规范URL交给默认浏览器。
 * 技术维度：使用Vitest、真实WebServer/Loader/Include、临时dist和可控浏览器钩子执行端到端启动测试。
 * 产品维度：避免用户看到未就绪或已失败的页面，并确保自动打开地址使用实际操作系统分配端口。
 * 逻辑维度：建立临时前端与桥接模块，加载两行配置，等待浏览器钩子内fetch成功后断言URL和状态码。
 * 关键边界：所有上下文和临时目录在afterEach释放；不调用真实操作系统浏览器。
 * 新手阅读建议：先看临时cordis.yml两行，再跟随Loader await，最后看openBrowser钩子如何证明页面已就绪。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, internals } from '../src/index.ts'

// 当前测试创建并在结束时释放的Cordis上下文。
const contexts: Context[] = []
// 当前测试创建并在结束时删除的临时根目录。
const tempRoots: string[] = []
// 原始前端dist解析钩子。
const originalResolveDistIndex = internals.resolveDistIndex
// 原始默认浏览器交接钩子。
const originalOpenBrowser = internals.openBrowser

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  internals.resolveDistIndex = originalResolveDistIndex
  internals.openBrowser = originalOpenBrowser
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, '__dshWebAppApply')
  Reflect.deleteProperty(globalThis, '__dshWebServer')
})

describe('web app browser startup', () => {
  it('opens the canonical URL only after the complete page is reachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-'))
    tempRoots.push(root)
    const dist = join(root, 'dist')
    mkdirSync(dist)
    const index = join(dist, 'index.html')
    writeFileSync(index, '<!doctype html><title>ready</title>')
    internals.resolveDistIndex = () => index

    const webserverModule = join(root, 'webserver.mjs')
    const webAppModule = join(root, 'web-app.mjs')
    writeFileSync(webserverModule, 'export default globalThis.__dshWebServer\n')
    writeFileSync(webAppModule, [
      "export const name = 'fixture-web-app'",
      "export const inject = ['webServer']",
      'export const apply = (ctx, config) => globalThis.__dshWebAppApply(ctx, config)',
      '',
    ].join('\n'))
    const config = join(root, 'cordis.yml')
    writeFileSync(config, [
      '- id: webserver',
      `  name: ${pathToFileURL(webserverModule).href}`,
      '  config:',
      '    host: 127.0.0.1',
      '    port: 0',
      '- id: web-app',
      `  name: ${pathToFileURL(webAppModule).href}`,
      '  config:',
      '    openBrowser: true',
      '    printUrl: false',
      '    surfaceContext: false',
      '    trustedHosts: []',
      '',
    ].join('\n'))

    const globals = globalThis as unknown as {
      __dshWebAppApply: typeof apply
      __dshWebServer: typeof WebServer
    }
    globals.__dshWebAppApply = apply
    globals.__dshWebServer = WebServer

    let openedUrl: string | undefined
    let openedStatus: number | undefined
    let resolveOpened!: () => void
    const opened = new Promise<void>((resolve) => { resolveOpened = resolve })
    internals.openBrowser = async (url) => {
      openedUrl = url
      openedStatus = (await fetch(url)).status
      resolveOpened()
    }

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(config).href },
    })
    await ctx.loader.await()
    await opened

    expect(openedUrl).toBe(`http://127.0.0.1:${String(ctx.webServer.port)}`)
    expect(openedStatus).toBe(200)
  })
})
