/**
 * ================================ 文件注释 ================================
 * 【文件职责】PendingWait：待处理 Host 交互的载体协议半边——运行时只负责
 *   信封知识（把 rpcId 回填进 client-response）；域结果编码属于消费方包。
 * 【技术维度】类 + 类型运算：PendingPayloads 按键控负载、PendingKind 是
 *   判别键、PendingInteraction 是判别联合；#settled/#rpcId 用私有字段封装。
 * 【产品维度】Host 在审批（approval）或提问（question）时阻塞，客户端需要
 *   一个不可变的渲染面（kind/key/sessionId/payload）来展示等待态，
 *   并携带把用户选择发回 Host 的响应载体。
 * 【逻辑维度】构造时生成不透明渲染键（前缀:rpcId）；respond() 回填 rpcId
 *   发送响应；markSettled() 标记已结算。
 * 【关键边界】结算只由 pending 列表成员关系表达；settled 标志是 fail-loud
 *   守卫而非渲染输入；respond 在已结算后同步抛错。
 * 【新手阅读建议】先理解 MuxFrame 的 approval/requested 与 question/requested。
 * ==========================================================================
 */
// PendingWait: the carrier-protocol half of a pending host interaction. The runtime owns only
// envelope knowledge (rpcId backfill into a client-response); domain result encoding belongs to
// the interaction's consumer package.
// PendingWait：待处理 Host 交互的载体协议半边。运行时只拥有信封知识
// （把 rpcId 回填进 client-response）；域结果编码属于该交互的消费方包。

import type {
  ClientResponse, MuxFrame, RpcId, RpcReceipt, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Kind-keyed payload map: the requested frame's domain fields (envelope fields stripped). */
/** 按键控的负载映射：被请求帧的域字段（去掉 type/sessionId 信封字段）。 */
export interface PendingPayloads {
  approval: Omit<Extract<MuxFrame, { type: 'approval/requested' }>, 'type' | 'sessionId'>
  question: Omit<Extract<MuxFrame, { type: 'question/requested' }>, 'type' | 'sessionId'>
}

/** Pending-interaction discriminant (the keys of PendingPayloads). */
/** 待处理交互的判别键（即 PendingPayloads 的键）。 */
export type PendingKind = keyof PendingPayloads

/** Session-list summary of the user action currently blocking progress. */
/** 会话列表中"当前阻塞进展的用户动作"概要。 */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Kind-discriminated union of concrete waits: narrowing on `kind` types `payload`. */
/** 具体等待的按 kind 判别联合：对 kind 收窄即可让 payload 类型随之收窄。 */
export type PendingInteraction = { [K in PendingKind]: PendingWait<K> }[PendingKind]

/** Key prefixes, one per kind (the key doubles as the Session pending-map key). */
/** 每种 kind 的键前缀（该键同时用作会话 pending 映射的键）。 */
const KEY_PREFIX: Record<PendingKind, string> = { approval: 'a', question: 'q' }

/**
 * One pending host-owned interaction wait: an immutable render face
 * (kind/key/sessionId/payload) plus the response carrier. respond() backfills
 * the requested frame's rpcId into a client-response envelope — no consumer
 * ever sees the raw rpcId. Settlement is expressed only by pending-list
 * membership (the settled flag is a fail-loud guard, not a render input).
 */
/**
 * 一次待处理的 Host 所属交互等待：不可变渲染面（kind/key/sessionId/payload）
 * 加响应载体。respond() 把被请求帧的 rpcId 回填进 client-response 信封——
 * 任何消费方都看不到原始 rpcId。结算只通过 pending 列表成员关系表达
 * （settled 标志是 fail-loud 守卫，不是渲染输入）。
 */
export class PendingWait<K extends PendingKind = PendingKind> {
  /** Interaction kind (union discriminant). */
  /** 交互类型（联合判别键）。 */
  readonly kind: K
  /** Opaque render identity, `<prefix>:<rpcId>` — stable across baseline replay, usable as a React key. */
  /** 不透明渲染身份 `<前缀>:<rpcId>`——跨基线重放稳定，可直接用作 React key。 */
  readonly key: string
  /** Owning session. */
  /** 属主会话。 */
  readonly sessionId: SessionId
  /** The requested frame's domain fields, verbatim. */
  /** 被请求帧的域字段原样保留。 */
  readonly payload: PendingPayloads[K]
  #settled = false
  readonly #rpcId: RpcId
  readonly #respond: (message: ClientResponse) => Promise<RpcReceipt>

  /**
   * Minted by Session on a requested frame (public construction is the test-fixture path).
   * @param kind - interaction kind.
   * @param rpcId - the requested frame's stable envelope id (kept private; respond echoes it).
   * @param sessionId - owning session.
   * @param payload - the requested frame's domain fields.
   * @param respond - the client-response carrier (api.respond).
   */
  /**
   * 由 Session 在被请求帧上铸造（公开构造是测试夹具路径）。
   * @param kind 交互类型。
   * @param rpcId 被请求帧的稳定信封 id（保持私有；respond 回显它）。
   * @param sessionId 属主会话。
   * @param payload 被请求帧的域字段。
   * @param respond client-response 载体（api.respond）。
   */
  constructor(
    kind: K, rpcId: RpcId, sessionId: SessionId, payload: PendingPayloads[K],
    respond: (message: ClientResponse) => Promise<RpcReceipt>,
  ) {
    this.kind = kind
    this.key = `${KEY_PREFIX[kind]}:${rpcId}`
    this.sessionId = sessionId
    this.payload = payload
    this.#rpcId = rpcId
    this.#respond = respond
  }

  /**
   * Send a result for this wait: wraps it into the client-response envelope
   * with the rpcId backfilled. Throws synchronously once settled.
   * @param result - the result shell (ok value / error envelope), domain-encoded by the caller.
   * @returns the carrier receipt.
   */
  /**
   * 发送本等待的结果：把它包进回填了 rpcId 的 client-response 信封。
   * 已结算后再调用会同步抛错。
   * @param result 结果外壳（ok 值 / 错误信封），由调用方做域编码。
   * @returns 载体回执。
   */
  respond(result: ClientResponse['result']): Promise<RpcReceipt> {
    if (this.#settled) throw new Error(`pending wait ${this.key} is already settled`)
    return this.#respond({ type: 'client-response', rpcId: this.#rpcId, result })
  }

  /** Session-only settlement mark (the authoritative resolved frame arrived); respond() throws afterwards. */
  /** 仅供 Session 调用的结算标记（权威的已解析帧已到达）；此后 respond() 会抛错。 */
  markSettled(): void {
    this.#settled = true
  }
}
