/**
 * Browser wire client. The plugin selects fixture or HTTP transport, provides
 * the shared API client, and lets the runtime object layer start the stream
 * controller with its sinks.
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
import type { HostDescription, IApiClient } from './api.ts'
import { ConnectionController, type ConnectionConfig, type ConnectionSinks, type ConnectionState } from './connection.ts'
import { FixtureApiClient } from './fixture.ts'
import { WebApiClient } from './web-api-client.ts'
import { createWebConnectionRpc, type RpcFetch } from './rpc.ts'
import { isLoopbackHostname } from '../loopback-hostname.ts'
import type { ClientConnectionRpc } from '../rpc.ts'

// ---- Contract re-exports (browser-safe apiproxy channels + core types) ----
export type {
  ApiProxy, SessionsApi, SessionSearchItem, SessionSummary, PromptContentPart, HostApi, EventsApi, MuxFrame, HostFrame,
  ApprovalResponsePayload, QuestionResponsePayload, HistoryEntry, ToolEventView,
  DirectoryEntry, DirectoryListing,
  ToolCallView, ToolResultView, WorkspaceApi, WorkspaceId, WorkspaceView,
  SkillsApi, SkillEntry,
  ModelCatalogFailure, ModelCatalogModel, ModelProviderGroup, ModelReasoning,
  MessageId, ModelReasoningEffort, ModelSelection, QueueAction, QueuedInboxItem, SessionModels,
  SubagentsApi, SubagentAddress, SubagentCatalog, SubagentListEntry, SubagentPromptReceipt,
  JobView,
  RpcRequest, RpcResponse, RpcResult, RpcError, RpcErrorCode,
  ClientRequest, ServerResponse, ServerRequest, ClientResponse, RpcMessage, RpcReceipt,
  HostDescription, IApiClient, SessionId, SessionEvent, ContentBlock, StreamChunk,
  GoalsApi, GoalRef,
  SettingsApi, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
  CredentialsApi, CredentialView, ConfigurableProviderView, DiscoveredModelView, LlmApi,
} from './api.ts'
export {
  RpcId,
  AbstractApiClient,
  transportError,
} from './api.ts'

// Connection loop types are public through ConnectionHandle.start; the
// controller remains package-internal.
export type { ConnectionConfig, ConnectionSinks, ConnectionState }
export type { ClientConnectionRpc } from '../rpc.ts'
export type { RpcFetch } from './rpc.ts'

/** Observable Host description published by each completed connection handshake. */
/* 每次完整连接握手发布的可订阅Host描述源。 */
export interface HostDescriptionSource {
  /** Latest connected-generation description; absent before connect and while reconnecting. */
  /* 读取最近已连接代际描述；初次连接前和重连中为空。 */
  getSnapshot(): HostDescription | undefined
  /** Subscribe to description replacement and connection loss. */
  /* 订阅描述替换和连接丢失，并返回注销器。 */
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
  /** Build the API carrier: unary calls plus the two downstream event streams. */
  /* 创建同时承载一元调用和两条下行事件流的API客户端。 */
  createApiClient(): IApiClient
  /** Transport for generic unary RPC channels (the Typert gateway). */
  /* Typert网关等通用一元RPC频道使用的fetch式传输。 */
  fetch: RpcFetch
  /**
   * Bundle transport for the module system, present when the carrier also owns
   * bundle bytes (the worker tunnel). Absent in the served web app, whose
   * bundles load over HTTP.
   */
  /* 可选Bundle字节加载器；Worker隧道提供，普通页面通过HTTP加载时省略。 */
  loadBundle?(url: string): Promise<void>
}

/** Page global carrying {@link ClientTransportHooks}; absent in the served web app. */
/* 页面可选全局传输钩子的结构。 */
interface ClientTransportGlobal {
  /** 由拥有物理传输的宿主在插件启动前设置。 */
  __DSH_TRANSPORT__?: ClientTransportHooks
}

/**
 * The ctx.connection service API: the API client plus a one-shot
 * controller starter (the runtime plugin supplies sinks when its object layer
 * is ready — connection stays consumer-agnostic).
 */
export interface ConnectionHandle {
  /** Shared api client (fixture or real, decided at boot from the page URL). */
  /* 启动时由页面模式选定并共享的API客户端。 */
  readonly api: IApiClient
  /** Whether the current page authority is loopback; non-browser contexts default to true. */
  /* 当前页面authority是否为回环；无浏览器location时默认为true。 */
  readonly isLoopback: boolean
  /** Generation-scoped Host facts, including the account home and native path-open capability. */
  /* 代际范围内的Host事实订阅源，包括账户主目录和本地打开能力。 */
  readonly hostDescription: HostDescriptionSource
  /** Generic logical RPC channels over the same Connection transport. */
  /* 复用同一Connection载体的通用逻辑RPC频道。 */
  readonly rpc: ClientConnectionRpc
  /**
   * Start the connect/pump/reconnect loop with the consumer's frame sinks.
   * One consumer owns the streams (the runtime object layer); a second call
   * throws.
   * @param sinks - frame/state callbacks.
   * @param config - reconnect/backoff tunables.
   * @returns stop handle for the loop.
   */
  start(sinks: ConnectionSinks, config?: ConnectionConfig): { stop(): void }
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
  // fixture模式下创建的内存API客户端。
  const fixtureClient = fixture ? new FixtureApiClient() : undefined
  // Worker预览等宿主在全局注入的可选物理传输钩子。
  const transport = (globalThis as ClientTransportGlobal).__DSH_TRANSPORT__
  // 按fixture、宿主传输、普通Web顺序选择的一元与流API客户端。
  const api: IApiClient = fixtureClient ?? transport?.createApiClient() ?? new WebApiClient()
  // 与所选载体一致的通用RPC调用器。
  const rpc = fixtureClient?.rpc ?? createWebConnectionRpc(transport?.fetch)
  // 是否已经把唯一事件流所有权交给消费者。
  let started = false
  // 当前已连接代际公布的Host描述。
  let description: HostDescription | undefined
  // Host描述变化的订阅监听器集合。
  const descriptionListeners = new Set<() => void>()
  /** 发布或撤回Host描述，并隔离每个监听器异常。 */
  const publishDescription = (next: HostDescription | undefined): void => {
    if (Object.is(description, next)) return
    description = next
    for (const listener of [...descriptionListeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[web-runtime] host-description listener threw:', error)
      }
    }
  }
  // 最终提供给浏览器Cordis树的connection服务对象。
  const handle: ConnectionHandle = {
    api,
    isLoopback: pageLocation === undefined || isLoopbackHostname(pageLocation.hostname),
    hostDescription: {
      getSnapshot: () => description,
      subscribe: (listener) => {
        descriptionListeners.add(listener)
        return () => { descriptionListeners.delete(listener) }
      },
    },
    rpc,
    start(sinks, config) {
      if (started) throw new Error('connection: the stream loop is already owned by another consumer')
      started = true
      // 当前唯一消费者拥有的物理流控制器。
      const controller = new ConnectionController(api, {
        ...sinks,
        onConnected: (next) => {
          publishDescription(next)
          // A description subscriber may synchronously stop the loop. In that
          // case publishDescription(undefined) has already retracted this
          // generation, so do not leak its stale connected notification to
          // the consumer sink afterward.
          if (!Object.is(description, next)) return
          sinks.onConnected?.(next)
        },
        onStateChange: (state) => {
          if (state === 'reconnecting') publishDescription(undefined)
          sinks.onStateChange?.(state)
        },
      }, config ?? {})
      controller.start()
      return {
        stop: () => {
          controller.stop()
          publishDescription(undefined)
        },
      }
    },
  }
  ctx.provide('connection', handle)
}
