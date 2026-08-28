/**
 * Deterministic HTTP provider for the web-fetch snapshot scenario: a small
 * HTML page (headings, named entities, a GFM table, nested formatting) on a
 * fixed loopback port behind the real address-pinned transport. Recording and
 * replay therefore exercise fetch and markdown rendering without
 * external network. The port is fixed because the fetched URL is recorded.
 */
/*
 * 中文说明：
 * - 文件职责：为 web-fetch 快照场景提供固定端口、确定内容的本地 HTTP 服务器。
 * - 技术维度：使用 Node HTTP Server、Cordis effect 生命周期、HTML 实体和异步监听/关闭。
 * - 产品维度：无需外网即可验证真实网页抓取传输与 HTML 转 Markdown 行为。
 * - 逻辑维度：固定页面与端口，按 /menu.html 返回 HTML，其他路径 404，并随插件纤程关闭。
 * - 关键边界：端口必须固定以匹配录制 transcript；服务器只绑定 127.0.0.1 且不能阻止进程退出。
 * - 新手阅读建议：先看 PAGE 覆盖的 HTML 元素，再沿 createServer、listen、ctx.effect 阅读生命周期。
 */
import { createServer } from 'node:http'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'

/** Fixed loopback port the scenario prompt points `web_fetch` at. */
/* 中文：快照提示中 web_fetch 指向的固定回环端口。 */
const PORT = 43117

/** 包含标题、实体、嵌套格式、列表、表格和链接的固定 HTML 页面。 */
const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Caf&eacute; menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>&euro;2</td></tr><tr><td>Flat white</td><td>&euro;3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

/** Cordis plugin name. */
/* 中文：夹具服务器的稳定 Cordis 插件名。 */
export const name = 'web-fetch-fixture-server'

/** Service used by the fixture provider. */
export const inject = ['web']

const LIMITS = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: 'deepseek-harness-snapshot/1.0',
}

/**
 * Register the deterministic provider and start its loopback server.
 * @param ctx - Cordis context; the effect disposes the server with the fiber.
 */
export function apply(ctx) {
  const server = createServer((req, res) => {
    if (req.url === '/menu.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(undefined))
  })
  void listening.catch(() => undefined)
  // The fixture must never hold the process open past protocol shutdown.
  // 中文：解除引用，确保协议关闭后夹具服务器不会单独保持 Node 进程存活。
  server.unref()

  const resolveAddresses = async (hostname) => {
    await listening
    if (hostname !== 'public.test') throw new Error(`unexpected snapshot hostname: ${hostname}`)
    return [{ address: '127.0.0.1', family: 4 }]
  }

  ctx.effect(() => async () => {
    /** 等待服务器停止接受连接并完成关闭的 Promise。 */
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined))
      // Stop accepting first so a connection cannot arrive after the forced close.
      // 中文：先发起关闭监听，再强制断开现有连接，避免之后又接入新连接。
      server.closeAllConnections()
    })
  }, 'web-fetch-fixture-server')
  ctx.web.registerFetchProvider(new HttpFetchProvider(LIMITS, resolveAddresses))
}
