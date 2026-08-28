/**
 * Browser wire client. The plugin selects fixture or HTTP transport, provides
 * the shared API client, and lets API Gateway own the connection loop.
 */
/*
 * 文件职责：选择fixture、页面HTTP/WebSocket或宿主注入传输，并向浏览器Cordis树提供统一connection服务。
 * 技术维度：组合ApiClient、通用RPC调用器、ConnectionController和订阅式Host描述快照，支持全局传输钩子。
 * 产品维度：让Web应用与测试/Worker预览共用业务层，同时发布连接状态、宿主能力和可停止的事件流循环。
 * 逻辑维度：根据URL与全局钩子选择载体，创建RPC与描述订阅源，限制唯一流消费者，再包装连接/重连回调。
 * 关键边界：流控制器只能启动一次；重连时立即撤回Host描述；监听器异常仅记录，不影响其他订阅者。
 * 新手阅读建议：先看ClientTransportHooks与ConnectionHandle，再读apply中的传输选择，最后跟踪start如何包装回调。
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  ConnectionController,
  type ConnectionConfig,
  type ConnectionGeneration,
  type ConnectionGenerationSource,
  type ConnectionSinks,
} from './connection.ts'
import { createFixtureConnectionRpc } from './fixture.ts'
import { createWebConnectionRpc, type RpcFetch, type RpcStreamOpen } from './rpc.ts'
import { isLoopbackHostname } from '../loopback-hostname.ts'
import type { ClientConnectionRpc } from '../rpc.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A connection generation was established. Wire-derived caches must
     * repull; long-lived streams own their own resume and baseline lifecycle.
     * @mode emit
     */
    'connection/reset'(): void
  }
}

// ---- Browser-safe protocol and shared value re-exports ----
export type {
  MessageId,
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, RpcMessage,
  SessionId, SessionEvent, ContentBlock, StreamChunk,
} from './api.ts'
export {
  RpcId,
  transportError,
} from './api.ts'

// Connection loop types are public through ConnectionHandle.start; the
// controller remains package-internal.
export type {
  ConnectionConfig,
  ConnectionGeneration,
  ConnectionGenerationSource,
  ConnectionHostInfo,
  ConnectionSinks,
  ConnectionState,
} from './connection.ts'
export type {
  ClientConnectionRpc, ConnectionRpcFailure, ConnectionRpcResult,
} from '../rpc.ts'
export type { RpcFetch } from './rpc.ts'

/** Observable identity and Host facts for the active connection generation. */
export interface ConnectionGenerationState {
  /** Active generation, or undefined before readiness and while reconnecting. */
  getSnapshot(): ConnectionGeneration | undefined
  /** Subscribe to generation establishment, replacement, and loss. */
  subscribe(listener: () => void): () => void
}

/** Required services (none — this is the wire root). */
/* 连接插件是线协议根，不要求其他Cordis服务。 */
export const inject: string[] = []

/**
 * Carrier override installed on the page global before plugin boot. The served
 * web app leaves it unset and gets HTTP + WebSocket; a shell that owns a
 * different physical transport (the worker preview's postMessage tunnel)
 * provides both halves here instead of forking this plugin.
 */
export interface ClientTransportHooks {
  /** Transport for generic unary RPC channels (the Typert gateway). */
  /* Typert网关等通用一元RPC频道使用的fetch式传输。 */
  fetch: RpcFetch
  /** Worker-local Gateway stream carrier; absent when the page uses the Gateway WebSocket. */
  openStream?: RpcStreamOpen
  /**
   * Bundle transport for the module system, present when the carrier also owns
   * bundle bytes (the worker tunnel). Absent in the served web app, whose
   * bundles load over HTTP.
   */
  /* 可选Bundle字节加载器；Worker隧道提供，普通页面通过HTTP加载时省略。 */
  loadBundle?(url: string): Promise<void>
  /**
   * The transport owner declares the page owns the Host outright: the Host
   * runs inside a worker this page spawned, so no other party can reach it and
   * the loopback stand-in for "the operator's own machine" is vacuous.
   * `ctx.connection.isLoopback` then reports the privileged surface reachable
   * regardless of the page authority. Only a shell that assembles its own
   * transport can set this; served pages never carry the global at all.
   */
  ownsHost?: boolean
}

/** Page global carrying {@link ClientTransportHooks}; absent in the served web app. */
/* 页面可选全局传输钩子的结构。 */
interface ClientTransportGlobal {
  /** 由拥有物理传输的宿主在插件启动前设置。 */
  __DSH_TRANSPORT__?: ClientTransportHooks
}

/**
 * The ctx.connection service API: the API client plus a one-shot controller
 * starter. API Gateway supplies generation readiness and reset callbacks;
 * Connection stays independent of downstream domain state.
 */
export interface ConnectionHandle {
  /**
   * Whether the privileged surface is reachable: the page authority is
   * loopback, the transport declares the page owns the Host
   * ({@link ClientTransportHooks.ownsHost}), or the context is not a browser.
   */
  readonly isLoopback: boolean
  /** Current Remote event generation and the Host facts carried by its opening frame. */
  readonly generation: ConnectionGenerationState
  /** Generic logical RPC channels over the same Connection transport. */
  /* 复用同一Connection载体的通用逻辑RPC频道。 */
  readonly rpc: ClientConnectionRpc
  /**
   * Register the sole source defining Host generations. The source reports
   * ready only after its incremental listeners are attached.
   * @param source - long-lived generation source owned by the push carrier.
   * @returns disposer withdrawing the source and stopping an active loop.
   */
  registerGenerationSource(source: ConnectionGenerationSource): () => void
  /**
   * Start the connect/reconnect loop with the consumer's state callbacks.
   * API Gateway owns the loop; a second call throws.
   * @param sinks - connection-state callbacks.
   * @param config - reconnect/backoff tunables.
   * @returns stop handle for the loop.
   */
  start(sinks: ConnectionSinks, config?: ConnectionConfig): { stop(): void }
}

interface ConnectionOwner {
  readonly token: object
  readonly source: ConnectionGenerationSource
  readonly controller: ConnectionController
}

/**
 * Client plugin body: pick the api by page mode and provide ctx.connection.
 * @param ctx - client cordis context.
 */
export function apply(ctx: Context): void {
  // 浏览器页面location；非浏览器执行环境中为空。
  const pageLocation = typeof location === 'undefined' ? undefined : location
  // URL查询参数是否要求使用确定性fixture客户端。
  const fixture = pageLocation !== undefined && new URLSearchParams(pageLocation.search).has('fixture')
  const fixtureRpc = fixture ? createFixtureConnectionRpc() : undefined
  const transport = (globalThis as ClientTransportGlobal).__DSH_TRANSPORT__
  const rpc = fixtureRpc ?? createWebConnectionRpc(transport?.fetch, transport?.openStream)
  let generationSource: ConnectionGenerationSource | undefined
  let owner: ConnectionOwner | undefined
  let generationId = 0
  let generation: ConnectionGeneration | undefined
  const generationListeners = new Set<() => void>()
  const publishGeneration = (next: ConnectionGeneration | undefined): void => {
    if (Object.is(generation, next)) return
    generation = next
    for (const listener of [...generationListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[connection] generation listener threw:', error)
      }
    }
  }
  const releaseOwner = (current: ConnectionOwner): void => {
    if (owner !== current) return
    owner = undefined
    current.controller.stop()
    publishGeneration(undefined)
  }
  const handle: ConnectionHandle = {
    isLoopback: transport?.ownsHost === true || pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
    generation: {
      getSnapshot: () => generation,
      subscribe: (listener) => {
        generationListeners.add(listener)
        return () => { generationListeners.delete(listener) }
      },
    },
    rpc,
    registerGenerationSource(source) {
      if (generationSource !== undefined) {
        throw new Error('connection: a generation source is already registered')
      }
      generationSource = source
      return () => {
        if (generationSource !== source) return
        generationSource = undefined
        const current = owner
        if (current?.source === source) releaseOwner(current)
      }
    },
    start(sinks, config) {
      if (owner !== undefined) throw new Error('connection: the stream loop is already owned by another consumer')
      const source = generationSource
      if (source === undefined) throw new Error('connection: no generation source is registered')
      const token = {}
      const ownsGeneration = (): boolean => owner?.token === token
      const controller = new ConnectionController(source, {
        ...sinks,
        onConnected: (host) => {
          const nextGeneration = { id: ++generationId, host }
          publishGeneration(nextGeneration)
          if (!ownsGeneration() || !Object.is(generation, nextGeneration)) return
          sinks.onConnected?.(host)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') {
            publishGeneration(undefined)
          }
          if (!ownsGeneration()) return
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      const current = { token, source, controller }
      owner = current
      controller.start()
      return {
        stop: () => { releaseOwner(current) },
      }
    },
  }
  ctx.provide('connection', handle)
}
