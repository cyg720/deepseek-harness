/** Worker-owned HTTP discovery, DevTools CDP, and Client-ingest endpoints.
 * @remarks 文件说明：文件职责：实现 experimental/inspector 中 endpoint 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/inspector 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import type { InspectorWorkerConfig } from '../../shared/bridge/messages/control.ts'
import type { WorkerToSourceFrame } from '../../shared/bridge/messages/observation.ts'
import { CdpSession } from '../cdp/session.ts'
import type { CdpTransport } from '../cdp/protocol.ts'
import type { NetworkDomain } from '../cdp/domains/network/session.ts'
import type { CordisDomBackend } from '../cdp/domains/dom/index.ts'
import type { CordisRuntimeTreeReader } from '../../shared/cordis/reader.ts'
import type { InspectorQueryRouter } from '../inspection/query-router.ts'
import type { InspectorRealmRegistry } from '../inspection/realm-store.ts'
import type { InspectorSourceRegistry, SourceConnection } from './hub.ts'

/** Bound endpoint information returned to the Host controller. */
export interface InspectorEndpointInfo {
  readonly host: string
  readonly port: number
  readonly targetId: string
}

/** Worker-owned network endpoint.
 * @remarks 中文说明：类说明：InspectorEndpoint 用于集中封装 处理 InspectorEndpoint 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 experimental/inspector
 * 在对应插件或业务生命周期内创建和调用。 */
export class InspectorEndpoint {
  /**
   * 变量说明：server 用于处理 server 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private server: Server | undefined
  /**
   * 常量说明：cdpServer 用于处理 cdpServer 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly cdpServer: WebSocketServer
  /**
   * 常量说明：ingestServer 用于处理 ingestServer 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly ingestServer: WebSocketServer
  /**
   * 常量说明：cdpSessions 用于处理 cdpSessions 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly cdpSessions = new Map<WebSocket, CdpSession>()
  /**
   * 常量说明：ingestConnections 用于处理 ingestConnections 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly ingestConnections = new Map<WebSocket, SourceConnection>()

  /**
   * 功能说明：处理 InspectorEndpoint 相关流程；使用场景由所在模块及调用位置决定。
   * @param config （InspectorWorkerConfig）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。
   * @param sources （InspectorSourceRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param network （NetworkDomain）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param realms （InspectorRealmRegistry）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param cordisDom （CordisDomBackend）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param cordisTrees （CordisRuntimeTreeReader）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param queries （InspectorQueryRouter）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new InspectorEndpoint(config, sources, network, realms,
   * cordisDom, cordisTrees, queries) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly config: InspectorWorkerConfig,
    private readonly sources: InspectorSourceRegistry,
    private readonly network: NetworkDomain,
    private readonly realms: InspectorRealmRegistry,
    private readonly cordisDom: CordisDomBackend,
    private readonly cordisTrees: CordisRuntimeTreeReader,
    private readonly queries: InspectorQueryRouter,
  ) {
    this.cdpServer = new WebSocketServer({ noServer: true, maxPayload: config.maxSourceFrameBytes })
    this.ingestServer = new WebSocketServer({ noServer: true, maxPayload: config.maxSourceFrameBytes })
  }

  /**
   * Bind the loopback endpoint.
   * @returns The actual bound address and target id.
   * @remarks 中文说明：功能说明：启动 start 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<InspectorEndpointInfo>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 start()，并按返回类型处理结果。
   */
  async start(): Promise<InspectorEndpointInfo> {
    /**
     * 变量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let candidate = this.config.startPort
    while (true) {
      /**
       * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const server = this.createServer()
      this.server = server
      /**
       * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        /**
         * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const address = await listen(server, candidate, this.config.host)
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        server.on('error', () => {
          // An established server error is connection-local or reported by
          // the operating system; active sockets retain their own handlers.
        })
        return { host: this.config.host, port: address.port, targetId: this.config.targetId }
      } catch (error) {
        this.server = undefined
        if (!isAddressInUse(error) || candidate === 0) throw error
        if (candidate === 65_535) {
          throw new Error(`inspector: no available port from ${String(this.config.startPort)} through 65535`, {
            cause: error,
          })
        }
        candidate += 1
      }
    }
  }

  /** Stop admission, dispose CDP sessions, terminate sockets, and await server close.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close()，并按返回类型处理结果。 */
  async close(): Promise<void> {
    /**
     * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const server = this.requireServer()
    /**
     * 变量说明：socket、session 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [socket, session] of this.cdpSessions) {
      session.close()
      socket.terminate()
    }
    this.cdpSessions.clear()
    /**
     * 变量说明：socket、connection 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (const [socket, connection] of this.ingestConnections) {
      this.sources.disconnect(connection, 'Client ingest endpoint stopped')
      socket.terminate()
    }
    this.ingestConnections.clear()
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
     */
    await Promise.all([
      closeWebSocketServer(this.cdpServer),
      closeWebSocketServer(this.ingestServer),
      new Promise<void>((resolve) => {
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
         */
        server.close(() => { resolve() })
        server.closeAllConnections()
      }),
    ])
  }

  /**
   * 功能说明：处理 Http 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （IncomingMessage）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param response （import('node:http').ServerResponse）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 handleHttp(request, response)，并按返回类型处理结果。
   */
  private handleHttp(request: IncomingMessage, response: import('node:http').ServerResponse): void {
    /**
     * 常量说明：pathname 用于处理 pathname 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const pathname = new URL(request.url ?? '/', 'http://inspector.invalid').pathname
    if (pathname === '/json' || pathname === '/json/list') {
      this.json(response, [this.target()])
      return
    }
    if (pathname === '/json/version') {
      this.json(response, {
        Browser: 'dsh-experimental-inspector/0',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: this.cdpUrl(),
      })
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  }

  /**
   * 功能说明：处理 Upgrade 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （IncomingMessage）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param socket （Duplex）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param head （Buffer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 handleUpgrade(request, socket, head)，并按返回类型处理结果。
   */
  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    /**
     * 变量说明：pathname 用于处理 pathname 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let pathname: string
    try {
      pathname = new URL(request.url ?? '/', 'http://inspector.invalid').pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname === `/devtools/page/${this.config.targetId}`) {
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ws（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ws)，并按返回类型处理结果。
       */
      this.cdpServer.handleUpgrade(request, socket, head, (ws) => { this.acceptCdp(ws) })
      return
    }
    if (pathname === '/ingest') {
      if (!this.authorizedClient(request)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：ws（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(ws)，并按返回类型处理结果。
       */
      this.ingestServer.handleUpgrade(request, socket, head, (ws) => { this.acceptIngest(ws) })
      return
    }
    socket.destroy()
  }

  /**
   * 功能说明：处理 acceptCdp 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acceptCdp(socket)，并按返回类型处理结果。
   */
  private acceptCdp(socket: WebSocket): void {
    /**
     * 常量说明：transport 用于处理 transport 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：payload（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(payload)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const transport: CdpTransport = {
      send: (payload) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
      },
      close: () => { socket.close(1008, 'invalid CDP request') },
    }
    /**
     * 常量说明：session 用于处理 session 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const session = new CdpSession(
      transport,
      { targetId: this.config.targetId, title: 'DeepSeek Harness Host' },
      this.sources,
      this.network,
      this.realms,
      this.cordisDom,
      this.cordisTrees,
    )
    this.cdpSessions.set(socket, session)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => {
      try {
        session.receive(JSON.parse(rawText(data)) as unknown)
      } catch {
        socket.close(1008, 'CDP frame must be JSON')
      }
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.once('close', () => {
      this.cdpSessions.delete(socket)
      session.close()
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.on('error', () => {
      // The close event performs connection-owned cleanup.
    })
  }

  /**
   * 功能说明：处理 acceptIngest 相关流程；使用场景由所在模块及调用位置决定。
   * @param socket （WebSocket）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 acceptIngest(socket)，并按返回类型处理结果。
   */
  private acceptIngest(socket: WebSocket): void {
    /**
     * 常量说明：queryPeer 用于处理 queryPeer 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reason（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code, reason)，并按返回类型处理结果。
     */
    const queryPeer = this.queries.open({
      send: (frame) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame))
      },
      close: (code, reason) => { socket.close(code, reason) },
    })
    /**
     * 常量说明：connection 用于处理 connection 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：frame（WorkerToSourceFrame）：提供本次调用
     * 所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，
     * 不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(frame)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：code（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reason（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(code, reason)，并按返回类型处理结果。
     */
    const connection: SourceConnection = {
      kind: 'client',
      send: (frame: WorkerToSourceFrame) => {
        if (socket.readyState !== socket.OPEN) return
        socket.send(JSON.stringify(frame))
        if (frame.t === 'source/accepted') queryPeer.accept(frame.sourceId, frame.generation)
      },
      close: (code, reason) => { socket.close(code, reason.slice(0, 123)) },
    }
    this.ingestConnections.set(socket, connection)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：data（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(data)，并按返回类型处理结果。
     */
    socket.on('message', (data) => {
      try {
        /**
         * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const value = JSON.parse(rawText(data)) as unknown
        if (!queryPeer.receive(value)) this.sources.receive(connection, value)
      } catch {
        connection.close(1008, 'source frame must be JSON')
      }
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.once('close', () => {
      this.ingestConnections.delete(socket)
      queryPeer.close()
      this.sources.disconnect(connection, 'Client source disconnected')
    })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    socket.on('error', () => {
      // The close event performs connection-owned cleanup.
    })
  }

  /**
   * 功能说明：处理 authorizedClient 相关流程；使用场景由所在模块及调用位置决定。
   * @param request （IncomingMessage）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 authorizedClient(request)，并按返回类型处理结果。
   */
  private authorizedClient(request: IncomingMessage): boolean {
    /**
     * 常量说明：protocols 用于处理 protocols 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：value（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(value)，并按返回类型处理结果。
     */
    const protocols = (request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(value => value.trim())
    if (!protocols.includes(this.config.clientToken)) return false
    /**
     * 常量说明：origin 用于处理 origin 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const origin = request.headers.origin
    if (origin === undefined) return true
    if (this.config.clientOrigins.includes(origin)) return true
    try {
      /**
       * 常量说明：hostname 用于处理 hostname 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const hostname = new URL(origin).hostname
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
    } catch {
      return false
    }
  }

  /**
   * 功能说明：处理 target 相关流程；使用场景由所在模块及调用位置决定。
   * @returns object；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 target()，并按返回类型处理结果。
   */
  private target(): object {
    return {
      id: this.config.targetId,
      type: 'page',
      title: 'DeepSeek Harness Host',
      description: 'Experimental cross-realm Inspector target',
      url: 'dsh://host',
      webSocketDebuggerUrl: this.cdpUrl(),
      devtoolsFrontendUrl: `devtools://devtools/bundled/devtools_app.html?ws=${this.config.host}:${this.boundPort()}/devtools/page/${this.config.targetId}&panel=elements&noJavaScriptCompletion=true`,
    }
  }

  /**
   * 功能说明：处理 cdpUrl 相关流程；使用场景由所在模块及调用位置决定。
   * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cdpUrl()，并按返回类型处理结果。
   */
  private cdpUrl(): string {
    return `ws://${this.config.host}:${String(this.boundPort())}/devtools/page/${this.config.targetId}`
  }

  /**
   * 功能说明：处理 boundPort 相关流程；使用场景由所在模块及调用位置决定。
   * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 boundPort()，并按返回类型处理结果。
   */
  private boundPort(): number {
    /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const address = this.requireServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('inspector: endpoint is not bound to a TCP port')
    }
    return address.port
  }

  /**
   * 功能说明：创建 Server 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Server；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createServer()，并按返回类型处理结果。
   */
  private createServer(): Server {
    /**
     * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, response)，
     * 并按返回类型处理结果。
     */
    const server = createServer((request, response) => { this.handleHttp(request, response) })
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：request（由 TypeScript
     * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：socket（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：head（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(request, socket, head)，
     * 并按返回类型处理结果。
     */
    server.on('upgrade', (request, socket, head) => { this.handleUpgrade(request, socket, head) })
    return server
  }

  /**
   * 功能说明：处理 requireServer 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Server；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 requireServer()，并按返回类型处理结果。
   */
  private requireServer(): Server {
    if (this.server === undefined) throw new Error('inspector: endpoint is not started')
    return this.server
  }

  /**
   * 功能说明：处理 json 相关流程；使用场景由所在模块及调用位置决定。
   * @param response （import('node:http').ServerResponse）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。
   * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 json(response, value)，并按返回类型处理结果。
   */
  private json(response: import('node:http').ServerResponse, value: unknown): void {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(value))
  }
}

/**
 * 功能说明：处理 listen 相关流程；使用场景由所在模块及调用位置决定。
 * @param server （Server）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param port （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param host （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<AddressInfo>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 listen(server, port, host)，并按返回类型处理结果。
 */
function listen(server: Server, port: number, host: string): Promise<AddressInfo> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  return new Promise((resolve, reject) => {
    /**
     * 常量说明：finish 用于处理 finish 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 finish 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 finish()，并按返回类型处理结果。
     */
    const finish = (): void => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    /**
     * 常量说明：onError 用于响应 Error 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Error 相关流程；使用场景由所在模块及调用位置决定。
     * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onError(error)，并按返回类型处理结果。
     */
    const onError = (error: Error): void => {
      finish()
      reject(error)
    }
    /**
     * 常量说明：onListening 用于响应 Listening 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Listening 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onListening()，并按返回类型处理结果。
     */
    const onListening = (): void => {
      finish()
      /**
       * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('inspector: endpoint did not bind a TCP port'))
        return
      }
      resolve(address)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

/**
 * 功能说明：判断是否为 Address In Use 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isAddressInUse(error)，并按返回类型处理结果。
 */
function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}

/**
 * 功能说明：处理 rawText 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （RawData）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rawText(data)，并按返回类型处理结果。
 */
function rawText(data: RawData): string {
  /**
   * 常量说明：bytes 用于处理 bytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const bytes = data instanceof ArrayBuffer
    ? Buffer.from(new Uint8Array(data))
    : Array.isArray(data) ? Buffer.concat(data) : data
  return bytes.toString('utf8')
}

/**
 * 功能说明：关闭 Web Socket Server 相关流程；使用场景由所在模块及调用位置决定。
 * @param server （WebSocketServer）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 closeWebSocketServer(server)，并按返回类型处理结果。
 */
function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve)，并按返回类型处理结果。
   */
  return new Promise((resolve) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    server.close(() => { resolve() })
  })
}
