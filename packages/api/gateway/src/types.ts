/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义 dsh-api-gateway（Typert RPC 网关）包对外暴露的类型契约：
 * 一次远程调用的请求结构（InvokeRemoteRequest）、网关错误码分类
 * （TypertGatewayErrorCode）与网关服务接口（TypertGateway），并把网关服务
 * 挂到 Cordis 的 Context 类型上供全包使用。
 * 【技术维度】纯类型文件：只含 interface / type / declare module，无运行时代码；
 * 用 Cordis 的声明合并（declaration merging）机制为 Context 增加
 * typertGateway 成员，让插件在编译期就能拿到网关服务的类型。
 * 【产品维度】远程 BFF 架构的"接口契约层"：Host（服务端）按此契约暴露
 * 能力，远程客户端按同一签名调用，两端共用一份类型定义保证一致。
 * 【逻辑维度】按出现顺序：请求结构 InvokeRemoteRequest → 错误码
 * TypertGatewayErrorCode → 网关接口 TypertGateway（invoke 方法）→
 * Cordis Context 类型增强（declare module 块）。
 * 【关键边界】args 是"命名 wire 值"，字段必须与生成描述符精确匹配；
 * 错误码只覆盖基础设施与边界失败（如参数校验、服务不可用），业务错误
 * 保留其原始类型与身份，不在此枚举内。
 * 【新手阅读建议】先看 InvokeRemoteRequest（调用长什么样）与
 * TypertGatewayErrorCode（失败怎么分类），再看 TypertGateway.invoke 的
 * 契约（@throws 说明），最后看 declare module 理解 Cordis 类型扩展的写法。
 * ==========================================================================
 */
/**
 * Carrier-independent Typert Gateway request, service, and error contracts.
 * @module @deepseek-ai/dsh-api-gateway/types
 */
// 英文模块注释的中文解释：本文件是与传输载体无关（carrier-independent）
// 的 Typert 网关类型契约模块，集中放置请求、服务与错误三组类型定义。

/** One Remote method request after a carrier has decoded its envelope. */
// 中文：一条"远程方法调用请求"——传输载体（carrier）解码信封后，把端点
// 信息与命名参数整理成这个结构交给网关分发。
export interface InvokeRemoteRequest {
  /** Remote namespace selected by the generated descriptor. */
  // 中文：远程命名空间名，由生成描述符选定，用来定位挂在哪个 remote.<ns> 服务上。
  readonly namespace: string
  /** Exported Service method name. */
  // 中文：要调用的 Service 导出方法名。
  readonly method: string
  /** Named wire values; fields must exactly match the descriptor. */
  // 中文：命名形式的线上传输值（wire values），即按参数名组织的实参对象；
  // 字段集合必须与描述符声明的参数精确一致，多了或少了都会被网关拒绝。
  readonly args: Readonly<Record<string, unknown>>
  /** Carrier or direct-caller cancellation injected only into cancellation-aware methods. */
  // 中文：取消信号（AbortSignal），由载体或直接调用方注入；只传给声明了
  // 支持取消的方法，不支持取消的方法不会收到它。
  readonly signal?: AbortSignal
}

/** Stable infrastructure and boundary failures emitted before or after business execution. */
// 中文：网关错误码联合类型，只覆盖"业务执行前后"发生的基础设施与边界类
// 失败（例如端点歧义、参数无效、上下文或查找服务不可用），是稳定、可被
// 机器判别的失败分类，不会因业务代码改动而漂移。
export type TypertGatewayErrorCode =
  | 'ambiguous-endpoint'
  | 'arguments-invalid'
  | 'binding-invalid'
  | 'context-failed'
  | 'context-not-found'
  | 'context-unavailable'
  | 'definition-unavailable'
  | 'input-invalid'
  | 'invocation-unavailable'
  | 'lookup-failed'
  | 'lookup-not-found'
  | 'lookup-unavailable'
  | 'method-unavailable'
  | 'provider-mismatch'
  | 'result-invalid'
  | 'service-unavailable'
  | 'signature-invalid'

/** Host dispatcher consumed by Connection adapters. */
// 中文：网关接口——被 Connection 适配器消费的 Host 端分发器（dispatcher），
// 是远程调用到达 Host 后的统一入口；本文件只给签名，实现在 index.ts 中。
export interface TypertGateway {
  /**
   * Invoke one live Remote method without assuming a carrier or response envelope.
   * @param request - decoded endpoint and named wire arguments.
   * @returns the validated business result.
   * @throws {@link TypertGatewayError} for dispatch, provider, or boundary failures; lookup-policy and business errors retain identity.
   */
  // 中文：调用一个存活的 Remote 方法；本接口不假设任何具体载体或响应信封，
  // 由具体实现（TypertGatewayService）负责分发、参数解析与结果校验。
  invoke(request: InvokeRemoteRequest): Promise<unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host dispatcher for Typert Remote calls. */
    // 中文：Cordis 上下文上新增的网关服务成员，供 Typert 远程调用分发使用；
    // 该声明是类型层面的（声明合并），运行时实例由 TypertGatewayService 注册。
    typertGateway: TypertGateway
  }
}
