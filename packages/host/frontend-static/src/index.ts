/*
 * ================================ 文件注释 ================================
 * 【文件职责】SPA dist 静态服务器：占用 webserver 的兜底席位，服务构建好的
 * 前端目录并支持显式 index 入口。
 * 【技术维度】node:http 直写响应；可读 index 在 dist 根与配置的 index 路径处
 * 渲染（每条 index 响应都走 webserver 的 index 渲染：先结构化注入行、后原始
 * taps）；路径穿越检测用 sep 而非 '/'（Windows 下 resolve() 输出反斜杠路径）。
 * 【产品维度】浏览器形态宿主的本地前端托管：加载 GUI 应用与静态资源；错误
 * 语义明确——缺失 404、越界 403、未知扩展按 octet-stream、非 GET/HEAD 405。
 * 【逻辑维度】常量（MIME 表、静态缺失码）→ serveStatic（路径校验/渲染或读
 * 文件/错误映射）→ apply（占用兜底席位、渲染 index）。
 * 【关键边界】dist 位置是组合应用的"工作区知识"，distIndex 通常经 !!js 表达式
 * 提供，部署绝不应硬编码；兜底语义下命名路由自有其方法处理，未匹配的非
 * GET/HEAD 一律 405。
 * 【新手阅读建议】先读 serveStatic 的路径校验与 MIME 分发，再看 apply 如何
 * 与 webserver 兜底席位衔接。
 * ==========================================================================
 */
/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root and configured index
 * path; missing paths return 404, traversal outside the dist root is 403,
 * unknown extensions ship as octet-stream, and non-GET/HEAD is 405. Every
 * index response first passes Connection's browser authentication, then the
 * webserver's index render (structured injection rows, then raw taps).
 * Non-index assets stay public. The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
// 稳定的 Cordis 插件名。
export const name = 'frontend-static'

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor. */
// 插件配置：dist 锚点。
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  // dist 根内 index.html 的绝对路径。
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const HTML_MIME = 'text/html; charset=utf-8'

// 已知扩展名的 MIME 表：未知扩展一律按 application/octet-stream 下发。
const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

// 视为"静态缺失"（404）的文件系统错误码集合；其余错误上抛给 webserver 的
// 请求失败处理。
const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - authenticates an index response before its bytes are read.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 */
// 从 dist 根服务一个 GET/HEAD 静态请求：先做路径穿越校验（目标必须是 dist 根
// 本身或其下），再对 dist 根/索引路径渲染 index、其余路径读文件并按扩展名定
// MIME；缺失/非文件目标 404，其余文件系统错误上抛。
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  authorizeIndex: () => boolean,
  renderIndex: () => Promise<string>,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  try {
    if (target === distRoot || target === distIndex) {
      if (!authorizeIndex()) return
      body = await renderIndex()
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
// 插件入口：占用 webserver 兜底席位并服务 dist。非 GET/HEAD（且无命名路由匹配）
// 一律 405——兜底语义下命名路由自有其方法处理；index 渲染走 webServer.renderIndex
//（结构化注入行 + 原始 taps）。
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  // The dist is built with a relative base so the same files mount under any
  // static directory; served pages also answer deep SPA-fallback paths, where
  // relative asset URLs would resolve under the request directory, so the
  // served form anchors them at the site root ahead of every URL-bearing tag.
  const renderIndex = async (): Promise<string> => {
    const body = ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
    return body.replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="/">`)
  }
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(
      decodeURIComponent(rawPath),
      res,
      distRoot,
      distIndex,
      () => ctx.connection.authorizeIndex(req, res),
      renderIndex,
    )
  }), 'frontend-static: fallback seat')
}
