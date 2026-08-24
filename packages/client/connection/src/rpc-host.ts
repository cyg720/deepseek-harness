/** Host registry and HTTP adapter for generic Connection RPC channels. */
/**
 * 文件职责：实现宿主端 RPC 通道注册、共享通道拦截以及 HTTP 请求到业务处理器的适配。
 * 技术维度：使用 Cordis Service/effect、Fetch API、Schemastery 信封校验、正则路径约束和结构化 RPC 错误。
 * 产品维度：让插件在统一连接服务上安全暴露自己的远程能力，并随插件生命周期自动注销。
 * 逻辑维度：注册路由或拦截器，校验请求方法、媒体类型、JSON 信封和端点一致性，再调用业务处理器并封装响应。
 * 关键边界：普通通道不能占用 `/api`；共享通道只允许一个拦截器；端点路径禁止空段和目录跳转片段。
 * 新手阅读建议：先看 HostConnectionService.rpc 的公开入口，再看 register 两条注册路径，最后顺读 rpcFetchHandler 的校验链。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  clientRequestSchema,
  RpcId,
  type ClientRequest,
  type RpcError,
  type RpcErrorDetailsMap,
  type RpcId as RpcIdType,
  type ServerResponse as RpcServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { bridge, type FetchHandler } from './http-bridge.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type {
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

/** 中文说明：无合法关联编号的坏请求使用的固定 RPC 编号，便于生成格式完整的错误响应。 */
const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
/** 中文说明：合法自定义通道格式；只允许一个以斜杠开头的安全字符段。 */
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
/** 中文说明：合法端点路径段格式；排除斜杠和可能造成路径歧义的字符。 */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** 中文说明：共享通道拦截器记录，集中保存归属判断、Fetch 处理器和访问策略。 */
interface ConnectionRpcInterceptor {
  /** 中文说明：同步判断端点是否由此拦截器处理。 */
  readonly matches: ConnectionRpcEndpointMatcher
  /** 中文说明：已经包装好信封校验与响应编码的 Fetch 处理器。 */
  readonly fetchHandler: FetchHandler
  /** 中文说明：拦截端点统一采用的访问策略。 */
  readonly options: ConnectionRpcHandlerOptions
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    /** 中文说明：宿主连接服务，用于注册当前插件拥有的 RPC 通道。 */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
/** 中文说明：宿主连接服务；将 RPC 注册归属到调用者 Context，以便插件卸载时自动清理。 */
export class HostConnectionService extends Service implements HostConnectionHandle {
  /** 中文说明：按共享通道保存当前拦截器；同一通道最多一个。 */
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by trusted-host channels.
   */
  /** 中文说明：创建宿主连接服务；`ctx` 是所属插件上下文，`trustedHosts` 是可信宿主通道允许的地址；例如 `new HostConnectionService(ctx, [])`。 */
  constructor(ctx: Context, private readonly trustedHosts: readonly string[]) {
    super(ctx, 'connection')
  }

  /** Generic channel registry scoped to the Context reading this service. */
  /** 中文说明：返回绑定当前读取者 Context 的注册表；返回值可注册普通通道和共享通道拦截器，例如 `ctx.connection.rpc.handle(...)`。 */
  get rpc(): HostConnectionRpc {
    /** 中文说明：读取服务时的调用者 Context，后续 effect 和路由都归它所有。 */
    const owner = this.ctx
    return {
      handle: (channel, handler, options) => this.register(owner, channel, handler, options),
      intercept: (channel, matches, handler, options) =>
        this.registerInterceptor(owner, channel, matches, handler, options),
    }
  }

  /**
   * Compose one shared-channel Fetch handler from its interceptor and fallback.
   * @param channel - shared channel mounted by Connection.
   * @param fallback - handler for endpoints not claimed by the interceptor.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  /** 中文说明：组合共享通道拦截器和回退处理器；参数为 `/api` 及回退处理器；返回每次只选择一个目标的 Fetch 处理器。 */
  createSharedFetchHandler(
    channel: '/api',
    fallback: FetchHandler,
  ): FetchHandler {
    return {
      fetch: (request) => {
        /** 中文说明：从请求路径提取出的相对端点；非法路径得到 undefined。 */
        const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
        /** 中文说明：当前共享通道已注册的拦截器；可能不存在。 */
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return fallback.fetch(request)
        }
        if (interceptor.options.authority === 'loopback' && !isTrustedApiRequest(request, [])) {
          return Promise.resolve(new Response('forbidden', { status: 403 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  /** 中文说明：注册独占 HTTP 通道；参数含所有者、通道、处理器和策略；返回路由清理函数，例如由 `rpc.handle` 间接调用。 */
  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    assertChannel(channel)
    /** 中文说明：本通道实际接受的宿主列表；回环策略用空列表强制仅本机。 */
    const trustedHosts = options.authority === 'loopback' ? [] : this.trustedHosts
    /** 中文说明：把业务处理器包装为负责协议校验和响应编码的 Fetch 处理器。 */
    const fetchHandler = rpcFetchHandler(channel, handler)
    /** 中文说明：向 Web 服务器注册的前缀路由，负责访问检查和 HTTP 桥接。 */
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        if (!isTrustedApiRequest(req, trustedHosts)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, fetchHandler)
      },
    }
    return owner.effect(
      () => owner.webServer.register(route),
      `client-connection: ${channel} rpc channel`,
    )
  }

  /** 中文说明：在共享 `/api` 通道注册一个拦截器；返回随 owner 生命周期执行的异步清理函数。 */
  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    /** 中文说明：即将写入共享注册表的完整拦截器记录。 */
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
      options,
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

/** 中文说明：把通道业务处理器包装为 Fetch 处理器；参数是通道与处理器；返回负责校验信封的处理器，例如 `rpcFetchHandler('/rpc', handler)`。 */
function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): FetchHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      /** 中文说明：请求 URL 中属于当前通道的相对端点；不合法时为 undefined。 */
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      /** 中文说明：去除参数并规范为小写的媒体类型；只接受 application/json。 */
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      /** 中文说明：从网络边界解析出的未知 JSON 值，随后必须通过客户端信封模式校验。 */
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      /** 中文说明：客户端请求信封的安全解析结果，失败时包含可返回的字段问题。 */
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      /** 中文说明：已经通过结构校验的客户端 RPC 请求。 */
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

/** 中文说明：为非法信封生成坏请求响应；参数是原始正文和校验问题；返回结构完整的 Response，例如解析失败分支直接返回它。 */
function invalidEnvelopeResponse(body: unknown, issues: RpcErrorDetailsMap['bad-request']['issues']): Response {
  /** 中文说明：尝试从未校验正文中读取的原始 RPC 编号。 */
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  /** 中文说明：字符串编号会保留，否则使用固定的 invalid-request 编号。 */
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

/** 中文说明：从路径中提取并校验通道内端点；参数是通道和路径；返回端点或 undefined，例如 `endpointFromPath('/rpc', '/rpc/a')` 返回 `a`。 */
function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  /** 中文说明：去掉通道前缀和分隔斜杠后的原始端点。 */
  const endpoint = pathname.slice(channel.length + 1)
  /** 中文说明：用于逐段排除空段、点段和非法字符的端点片段数组。 */
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

/** 中文说明：把 RPC 错误包装为完整响应；参数是关联编号和错误；返回 JSON Response。 */
function errorResponse(rpcId: RpcIdType, error: RpcError): Response {
  return fullResponse(rpcId, { ok: false, error })
}

/** 中文说明：编码完整服务端响应；参数是关联编号与结果；返回 JSON Response，例如 `fullResponse(id, result)`。 */
function fullResponse(rpcId: RpcIdType, result: RpcServerResponse['result']): Response {
  /** 中文说明：符合 API Proxy 协议的服务端响应正文。 */
  const body: RpcServerResponse = { type: 'server-response', rpcId, result }
  return Response.json(body)
}

/** 中文说明：断言自定义通道格式合法且未占用 `/api`；参数是通道；合法时无返回值，非法时抛错，例如 `assertChannel('/rpc')`。 */
function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}
