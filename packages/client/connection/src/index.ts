/** Host HTTP bridge for browser-client RPC. */
/*
 * 文件职责：组装客户端连接插件，在宿主 Web 服务器上挂载 HTTP API、共享 RPC 和两条 WebSocket 下行路由。
 * 技术维度：使用 Cordis 插件生命周期、Schemastery 配置、Node HTTP 桥、Fetch 处理器及 WebSocket 升级路由。
 * 产品维度：为 Web 客户端提供统一连接入口，同时保护设置、凭据和宿主桌面等高权限能力。
 * 逻辑维度：解析配置并校验容量，创建连接服务，组合共享处理器，注册 HTTP 路由，再在 API Proxy 可用时注册下行流。
 * 关键边界：可信宿主列表只防 DNS 重绑定而非身份认证；高权限方法必须保持回环同源；图片上限必须装得进请求体。
 * 新手阅读建议：先看 Config 和 apply 主流程，再读 PRIVILEGED_METHODS 的安全原因，最后跟进 HTTP 与 WebSocket 两类路由。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-attachment'
// Activates the webServer Context merge used below.
// 中文说明：仅导入类型即可启用下方使用的 webServer Context 声明合并。
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
/* 中文说明：Cordis 中稳定的插件名称，用于识别和诊断该连接插件。 */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
/* 中文说明：图片 Base64 数据之外为 RPC JSON 字段预留的 1 MiB 空间。 */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

/** 中文说明：校验请求体上限能容纳配置的图片总量；参数是 Context 和字节上限；满足时无返回值，否则抛错，例如插件加载时调用。 */
function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  /** 中文说明：可选的附件服务；未安装时没有图片容量需要校验。 */
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  /** 中文说明：图片总量经过 Base64 膨胀并加上信封余量后的最低请求体字节数。 */
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
/* 中文说明：插件启动前必须具备 Web 服务器；API Proxy 通过后续动态注入作为可选回退。 */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
/* 中文说明：连接插件配置，声明非回环服务地址和请求体内存上限。 */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  /* 中文说明：允许的非回环规范 authority 列表；省略时只接受回环地址，每项必须是裸 `host` 或 `host:port`。 */
  trustedHosts?: string[]
  /* 中文说明：允许的非回环规范 authority 列表；省略时只接受回环地址。 */
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  /* 中文说明：每个 `/api` 请求最多缓冲的 JSON 字节数，默认 300 MiB。 */
  maxRequestBodyBytes?: number
}

/** 中文说明：连接配置的运行时模式，负责默认值、自然数约束和数组解析。 */
export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Methods gated to loopback even on a trusted-host deployment. Native dialogs
 * act on the host machine; the settings and credential domains mutate the
 * user's configuration and secret store, and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, explicitly not authentication, so the whole
 * configuration plane stays loopback-same-origin until a real authentication
 * layer exists. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
/* 中文说明：即使部署允许可信局域网宿主，也仍强制只在回环同源调用的方法集合。 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  // 中文说明：预设管理可改变宿主提供的组成；仅选择预设并不比创建会话新增权限，因此不在此集合中。
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
/*
 * 中文说明：加载连接插件并注册 HTTP、共享 RPC 和 WebSocket 路由。
 * @param ctx 宿主插件 Context。
 * @param config 已应用模式默认值的可选连接配置。
 * @returns 无返回值；所有注册均由 Cordis effect 管理生命周期。
 * @example `apply(ctx, { trustedHosts: ['192.0.2.1'] })`。
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  // 中文说明：正式 Loader 会补默认值，手工构造的测试 Context 可能不传配置。
  /** 中文说明：最终采用的可信宿主列表；缺省时为空，只允许回环来源。 */
  const trustedHosts = config?.trustedHosts ?? []
  /** 中文说明：最终采用的请求体字节上限；缺省时为 300 MiB。 */
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  // 中文说明：配置项在加载时逐个严格校验，避免请求阶段按错误前缀放行。
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  /** 中文说明：向 Context 提供 RPC 注册能力并保存可信宿主策略的宿主连接服务。 */
  const connection = new HostConnectionService(ctx, trustedHosts)
  /** 中文说明：共享 `/api` 的 Fetch 处理器；先尝试连接拦截器，再执行 API Proxy 回退。 */
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      /** 中文说明：当前请求 URL 的规范路径，用于识别方法和事件流端点。 */
      const pathname = new URL(request.url).pathname
      /** 中文说明：位于 `/api/` 后的 RPC 方法名；请求根路径时为 undefined。 */
      const method = pathname.startsWith(`${API_PATH}/`)
        ? pathname.slice(API_PATH.length + 1)
        : undefined
      if (method !== undefined
        && PRIVILEGED_METHODS.has(method)
        && !isTrustedApiRequest(request, [])) {
        return new Response('forbidden', { status: 403 })
      }
      if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
        return new Response('upgrade required', {
          status: 426,
          headers: { connection: 'Upgrade', upgrade: 'websocket' },
        })
      }
      /** 中文说明：可选的 API Proxy 服务；未安装时共享回退返回 404。 */
      const apiProxy = ctx.get('apiProxy')
      if (apiProxy === undefined) return new Response('not found', { status: 404 })
      return toFetchHandler(apiProxy).fetch(request)
    },
  })
  /** 中文说明：挂载在 `/api` 前缀的 HTTP 路由，先执行来源信任检查再桥接到 Fetch。 */
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    /** 中文说明：管理复用事件和主机事件两条 WebSocket 下行连接的宿主对象。 */
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    /** 中文说明：注册一条受信任来源保护的升级路由；参数是路径和处理器；无返回值，例如用于两条事件路径。 */
    const registerDownlink = (
      path: string,
      handle: WebUpgradeRoute['handler'],
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          return handle(req, socket, head)
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head) => { downlinks.handleMux(req, socket, head) })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head) => { downlinks.handleHost(req, socket, head) })
  })
}
