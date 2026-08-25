/** Generic unary RPC contracts shared by the Host and Client Connection halves. */
/*
 * 文件职责：声明宿主端和客户端连接层共用的单次 RPC 类型与注册接口。
 * 技术维度：使用 TypeScript 类型别名、只读接口、AbortSignal 和泛型 RPC 结果约束调用双方。
 * 产品维度：为独立功能模块提供统一的远程调用入口，并明确不同通道的访问范围。
 * 逻辑维度：先定义信任策略和处理函数，再分别声明宿主注册表与客户端调用器。
 * 关键边界：本文件只定义类型，不负责传输或校验；通道必须由宿主注册后才能调用。
 * 新手阅读建议：按 Authority、Options、Handler、HostConnectionRpc、ClientConnectionRpc 的顺序理解一次调用的两端。
 */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Trust fence applied before a Host RPC channel reaches its handler. */
/* 中文说明：RPC 通道的访问级别；可信宿主允许配置的地址，回环级别仅允许本机访问。 */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
/* 中文说明：单个逻辑 RPC 通道的注册策略，目前只包含统一的访问级别。 */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  /* 中文说明：该通道所有端点共同采用的浏览器来源访问级别。 */
  readonly authority: ConnectionRpcAuthority
}

/** Handler invoked after Connection has decoded the transport envelope. */
/* 中文说明：连接层解码信封后调用的业务函数；参数依次是端点、待校验载荷和取消信号；返回 RPC 结果，例如异步返回 `{ ok: true, value }`。 */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
/* 中文说明：同步判断共享通道中的端点是否属于某个拦截器；返回布尔值，例如 `endpoint => endpoint.startsWith('goals/')`。 */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
/* 中文说明：宿主端逻辑 RPC 注册表；注册的生命周期由返回的异步清理函数管理。 */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  /* 中文说明：注册绝对通道；参数为通道、处理器和访问策略；返回清理函数，例如 `rpc.handle('/rpc', handler, { authority: 'loopback' })`。 */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  /* 中文说明：拦截共享 `/api` 中匹配的端点；参数为通道、匹配器、处理器和策略；返回移除拦截器的函数。 */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
/* 中文说明：暴露在宿主 Context 上的连接服务接口，供不依赖具体传输的适配器使用。 */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  /* 中文说明：用于注册普通通道或共享通道拦截器的 RPC 注册表。 */
  readonly rpc: HostConnectionRpc
}

/** Client caller for logical RPC channels carried by the current transport. */
/* 中文说明：客户端逻辑 RPC 调用器；负责把通道、端点和载荷交给当前传输实现。 */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  /* 中文说明：调用已注册端点；参数是通道、端点、载荷和可选取消信号；返回成功或错误结果，例如 `rpc.call('/api', 'goals/create', payload)`。 */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}
