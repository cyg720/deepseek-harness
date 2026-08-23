/**
 * ================================ 文件注释 ================================
 * 【文件职责】Web 路由注册插件：一个 node:http 服务器加上 webServer 服务——
 * HTTP 与 upgrade 路由注册表、结构化 index 注入表（其后有原始转换钩子）、
 * 以及为一切无路由认领的请求准备的唯一兜底席位。
 * 【技术维度】Cordis Service 插件；不感知任何 harness 概念、不提供文件服务——
 * 组合应用的 frontend 插件经兜底钩子负责 dist 服务；长连接（SSE）由路由 handler
 * 自持响应生命周期；upgrade 路由独占协议协商与升级后的 socket。
 * 【产品维度】浏览器形态宿主（Web）的本地 HTTP 网关：承载 apiproxy 的 fetch
 * 载体、前端静态资源服务与 WebSocket/SSE 通道。Electron 形态走 file:// + IPC
 * 桥，不经此包。
 * 【逻辑维度】类型与事件声明（index-inject 收集）→ Config（监听地址）→
 * WebServer 服务：注册表/兜底/注入表成员 → register/registerUpgrade/
 * registerFallback/tapIndex → init（监听、请求处理、upgrade 处理、清理）→
 * match/renderIndex 等内部能力。
 * 【关键边界】命名路由 (kind, path) 必须互异（重复即组合级错误）；兜底座只有
 * 一个属主；单个畸形请求绝不让进程退出（400 应答）；升级 socket 被显式跟踪并
 * 在关停时销毁（Node 的 closeAllConnections 不含升级 socket）；本包从不打印
 * ——URL 行属于 shell。
 * 【新手阅读建议】先读 WebRoute/WebUpgradeRoute/Config 类型，再看 WebServer
 * 类的注册 API，最后读 init 里的请求分发与 upgrade 处理。
 * ==========================================================================
 */
/**
 * @deepseek-ai/dsh-host-webserver — Web route-registration plugin: a node:http
 * server plus the `webServer` service (HTTP and upgrade route registries, the
 * structured index injection table with raw transform taps behind it, and the
 * single fallback seat for everything no route claims). Knows no harness concepts and serves no files; the composing
 * application's frontend plugin owns dist serving through the fallback hook.
 * Web shape only — Electron loads dist over file:// and carries fetch over an
 * IPC bridge. This package never prints: the URL line belongs to the shell.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { renderIndexInjections, type IndexInjection } from './injections.ts'

export { renderIndexInjections } from './injections.ts'
export type { IndexInjection, IndexInjectionPlacement } from './injections.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
  interface Events {
    /**
     * Collect the structured index injection table. Emitted on every index
     * render and every worker boot-payload request; listeners push their
     * current rows, so a row's data is read fresh at emit time.
     * @param table - Mutable row table; listeners append in activation order.
     * @mode emit
     */
    'webserver/index-inject'(table: IndexInjection[]): void
  }
}

/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
// 路由匹配类型：exact 精确匹配路径名；prefix 前缀 p 匹配 p 与 p/<任意>。
export type WebRouteKind = 'exact' | 'prefix'

/** One named route registration. */
// 一条命名路由注册。
export interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  // 绝对路径名（无尾斜杠）。
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  // 拥有完整响应生命周期（可保持响应打开，如 SSE）。
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP upgrade registration. */
// 一条精确路径的 HTTP upgrade 注册。
export interface WebUpgradeRoute {
  /** Absolute pathname, no trailing slash. */
  // 绝对路径名（无尾斜杠）。
  path: string
  /** Owns protocol negotiation and the upgraded socket after dispatch. */
  // 分发后拥有协议协商与升级后的 socket。
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** Gateway config: the listen address. */
// 网关配置：监听地址。
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  // 监听主机：仅支持回环与全接口两个值。
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  // 监听端口；0 表示请求操作系统分配端口。
  port: number
}

/**
 * The browser HTTP carrier service. Activation listens immediately. Route
 * registration order does not affect requests because configured named routes
 * must be distinct, and the fallback handler answers anything not yet claimed
 * during startup with 404 until its owner registers. A listen failure rejects
 * initialization, and the boot process reports the failed fiber.
 */
export class WebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).required(),
    port: z.natural().max(65535).required(),
  })

  /** 精确匹配路由表：路径 → 路由。 */
  private readonly exact = new Map<string, WebRoute>()
  /** 前缀匹配路由表：路径 → 路由（匹配 p 与 p/<任意>）。 */
  private readonly prefixes = new Map<string, WebRoute>()
  /** upgrade 路由表：路径 → 升级路由。 */
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  /** 当前存活且被本服务跟踪的升级 socket 集合（关停时显式销毁）。 */
  private readonly upgradedSockets = new Set<Duplex>()
  /** 原始 HTML 转换钩子列表（index 兜底渲染时按注册顺序应用）。 */
  private readonly indexTaps: ((html: string) => string)[] = []
  /** 兜底处理器：一切无命名路由匹配的请求的唯一属主。 */
  private fallback: WebRoute['handler'] | undefined
  /** node:http 服务器实例（init 时创建）。 */
  private server!: Server
  /** 实际监听的端口（config.port 为 0 时取操作系统分配值）。 */
  private listenedPort!: number

  constructor(ctx: Context, private config: Config) {
    super(ctx, 'webServer')
  }

  /** The listening port (the OS-assigned value when config.port is 0). */
  get port(): number {
    return this.listenedPort
  }

  /** The configured bind host (the loopback or all-interfaces literal). */
  get host(): Config['host'] {
    return this.config.host
  }

  /**
   * Register a named route. Duplicate (kind, path) throws — route patterns are
   * a composition-level contract, so a collision is a misconfiguration.
   * @param route - kind, path, and the owning handler.
   * @returns the disposer removing the route.
   */
  // 注册命名路由：同 (kind, path) 重复注册抛错（路由模式是组合级契约，冲突即
  // 配置错误）；返回的释放函数从对应表删除该路由。
  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /**
   * Register an exact-path HTTP upgrade route. Duplicate paths throw because
   * one socket can have only one protocol owner.
   * @param route - pathname and handler owning negotiation plus socket use.
   * @returns the disposer removing the route.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * Claim the fallback seat: the handler answering every request no named
   * route matches (the SPA dist server in the shipped Web composition). One
   * owner only — a second registration throws, because two fallbacks cannot
   * compose.
   * @param handler - owns the full response lifecycle of unmatched requests.
   * @returns the disposer releasing the seat.
   */
  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  /**
   * Register a raw-HTML index transform, the escape hatch for markup no
   * {@link IndexInjection} row expresses: {@link renderIndex} applies taps in
   * registration order after rendering the structured rows.
   * @param transform - pure html-to-html function.
   * @returns the disposer removing the transform.
   */
  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const at = this.indexTaps.indexOf(transform)
      if (at !== -1) this.indexTaps.splice(at, 1)
    }
  }

  /** Listen; resolves once the socket is bound (rejection = FAILED fiber). */
  // 激活入口：监听指定地址。请求先按命名路由分发（含前缀最长匹配），无路由则
  // 交给兜底（未注册时 404）；单请求失败只记日志并 400 应答，绝不退出进程。
  // upgrade 请求按路径查表、独占协议协商；关停时先关服务器、销毁全部连接（含
  // 被显式跟踪的升级 socket）。
  async [Service.init](): Promise<void> {
    const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      /* v8 ignore next -- `?? '/'` arm: node:http always sets url on server
      requests; the field is only optional on the client-side IncomingMessage type */
      const rawPath = new URL(req.url ?? '/', 'http://x').pathname
      const route = this.match(rawPath)
      if (route !== undefined) {
        await route.handler(req, res)
        return
      }
      const fallback = this.fallback
      if (fallback === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      await fallback(req, res)
    }
    // Last-resort guard: handle() rejecting would otherwise be an unhandled
    // rejection killing the process on one malformed request (bad %-escape,
    // client dropping mid-body). Per-request failures log and answer 400 —
    // never a process exit.
    this.server = createServer((req, res) => {
      handle(req, res).catch((err: unknown) => {
        this.ctx.logger.warn(err instanceof Error ? err : new Error(String(err)))
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.writeHead(400)
        res.end()
      })
    })
    this.server.on('upgrade', (req, socket, head) => {
      const onError = (error: Error): void => {
        this.ctx.logger.warn(error)
        socket.destroy()
      }
      socket.on('error', onError)
      socket.once('close', () => {
        socket.off('error', onError)
        this.upgradedSockets.delete(socket)
      })
      let route: WebUpgradeRoute | undefined
      try {
        /* v8 ignore next -- node:http always sets url on server requests. */
        route = this.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
        return
      }
      if (route === undefined) {
        socket.destroy()
        return
      }
      this.upgradedSockets.add(socket)
      try {
        Promise.resolve(route.handler(req, socket, head)).catch((error: unknown) => {
          this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
          socket.destroy()
        })
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.off('error', reject)
        this.server.on('error', (err) => { this.ctx.logger.error(err) })
        this.listenedPort = (this.server.address() as AddressInfo).port
        resolve()
      })
    })

    // Node does not include upgraded sockets in closeAllConnections(). The service
    // owns them with the other connections, so it tracks and destroys them explicitly.
    this.ctx.effect(() => async () => {
      const serverClosed = new Promise<void>((resolve) => {
        this.server.close(() => { resolve() })
      })
      this.server.closeAllConnections()
      const upgradedClosed = [...this.upgradedSockets].map(socket => new Promise<void>((resolve) => {
        socket.once('close', () => { resolve() })
        socket.destroy()
      }))
      await Promise.all([serverClosed, ...upgradedClosed])
    }, 'webServer.listen')
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  // 精确表未命中后在前缀表上做最长前缀匹配。
  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }

  /**
   * Run an index.html body through the registered taps in registration order
   * — called by the fallback owner on every index response it renders.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  applyIndexTaps(html: string): string {
    let out = html
    for (const transform of this.indexTaps) out = transform(out)
    return out
  }

  /**
   * Gather the structured injection table: one `webserver/index-inject` emit,
   * every subscriber pushes its current rows. Fresh per call, so subscribers
   * read live state (module graph, theme preference) at emit time.
   * @returns rows in subscriber activation order.
   */
  collectIndexInjections(): IndexInjection[] {
    const table: IndexInjection[] = []
    this.ctx.emit('webserver/index-inject', table)
    return table
  }

  /**
   * Render one index.html body: the structured injection table first, then
   * the raw `tapIndex` transforms over the result.
   * @param html - the raw index.html body.
   * @returns the transformed body.
   */
  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))
  }
}

export default WebServer
