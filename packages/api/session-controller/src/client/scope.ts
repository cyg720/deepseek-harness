/**
 * ================================ 文件注释 ================================
 * 【文件职责】客户端 Agent 作用域（scope）原语：铸造一个携带"所属 Agent
 *   身份"标签的 Cordis 上下文，用于按 Agent 路由事件与隔离注册。
 * 【技术维度】镜像 Host 侧 dsh-scope 架构（no-op 插件 fiber + 上下文标签 +
 *   Context.filter 路由谓词）；但过滤器直接放在 actx 上下文上而非独立
 *   载体对象，使作用域分发就是纯 cordis 的 bail/emit 调用。
 * 【产品维度】一个客户端会话对应一个 Agent 身份（1:1，同一 id 轴）；
 *   会话冷启动后 Host Agent 可能已销毁，客户端 actx 仍存活以支撑历史浏览。
 * 【逻辑维度】kScope 是上下文标签符号；createScope 铸造作用域（挂载
 *   no-op 插件、扩展上下文写入标签与过滤谓词）；scopeOf 读取最近标签。
 * 【关键边界】作用域键是品牌化 SessionId（按值比较）而非对象身份；
 *   未带标签的监听器全局接收事件，带标签的只接收匹配 agent 的事件。
 * 【新手阅读建议】先理解 Cordis 的 Context.extend 与 filter 谓词语义。
 * ==========================================================================
 */
/**
 * Client Agent-scope primitive: mint a Cordis context tagged with the owning
 * Agent's identity. The mechanism mirrors the host `dsh-scope` architecture
 * (no-op plugin fiber + context tag + `Context.filter` routing predicate);
 * the shape deliberately diverges: the filter lives on the actx itself
 * instead of a separate carrier object, so scoped dispatch is plain cordis —
 * `actx.bail(actx, event, payload)` / `actx.emit(actx, ...)` — with no
 * wrapper. The host needs a detached carrier because its dispatch subject is
 * the business Agent object; client scope events carry only ids, so the
 * actx is the natural subject. The second divergence stands: the scope key
 * is the branded `SessionId` (value compared), not an object identity — the
 * agent and its session share one id (1:1, same axis; no separate AgentId
 * brand), and a client scope's identity IS that wire id. Third divergence,
 * deliberate: the client scopes the Agent IDENTITY, not a live Agent object
 * — a cold session's host Agent is already disposed while its client actx
 * stays alive for history viewing.
 */
/*
 * 客户端 Agent 作用域原语：铸造一个带"所属 Agent 身份"标签的 Cordis 上下文。
 * 机制镜像 Host 侧 dsh-scope 架构（no-op 插件 fiber + 上下文标签 +
 * Context.filter 路由谓词）；形态上刻意分歧：过滤器放在 actx 上下文本身
 * 而不是独立载体对象，使作用域分发就是纯 cordis 的 bail/emit，无包装。
 * Host 需要分离载体因为它的分发主体是业务 Agent 对象；客户端作用域事件只
 * 携带 id，actx 天然就是分发主体。第二个刻意分歧：作用域键是品牌化
 * SessionId（按值比较）而非对象身份——agent 与其会话共享一个 id（1:1，
 * 同一轴，无独立 AgentId 品牌），客户端作用域的身份就是这个线上 id。
 * 第三个刻意分歧：客户端作用域的是 Agent 身份而非活跃 Agent 对象——
 * 冷会话的 Host Agent 可能已销毁，而客户端 actx 仍存活以支持历史浏览。
 */
import { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TypertRemoteScopeApi } from '@deepseek-ai/dsh-typert-protocol'

/** Client Cordis Context carrying one Agent identity and its scoped Remote namespaces. */
/* 携带一个 Agent 身份及其作用域化 Remote 命名空间的客户端 Cordis 上下文。 */
export type AgentContext = Omit<Context, 'remote'> & {
  readonly remote: ClientRemote & TypertRemoteScopeApi<'agent'>
}

/** Context tag written by {@link createScope}. */
/* createScope 写入上下文中的标签（用 Symbol 作键，避免与普通属性冲突）。 */
const kScope = Symbol('dsh.client.scope')

/** A minted Agent scope and its disposal boundary. */
/* 一个已铸造的 Agent 作用域及其销毁边界。 */
export interface AgentScopeHandle {
  /**
   * Tagged context: scope-owned registrations and scoped dispatch both go
   * through it (passing it as the dispatch subject routes to this agent's
   * tagged listeners plus every untagged one).
   */
  /*
   * 带标签的上下文：作用域内的注册与作用域化分发都经过它（把它作为分发
   * 主体会把事件路由到该 agent 的带标签监听器以及所有未带标签的监听器）。
   */
  ctx: AgentContext
  /** Backing fiber (dispose tears down every scope-owned registration). */
  /* 底层 fiber（销毁它会拆除所有作用域内的注册）。 */
  fiber: Fiber
}

/** Shared no-op plugin backing each Agent scope fiber. */
/* 支撑每个 Agent 作用域 fiber 的共享 no-op 插件（本身不做任何事，只提供生命周期）。 */
function agentScope(): void {}

/**
 * Mint an Agent scope under `ctx`: a no-op plugin fiber whose context
 * carries the agent tag and the dispatch filter — untagged listeners are
 * admitted globally, tagged listeners only for a matching agent.
 * Registrations through the returned ctx dispose with the fiber.
 * @param ctx - client root context the scope fiber mounts under.
 * @param key - owning agent identity (the routing tag; agent id === session id).
 * @returns the tagged context and its backing fiber.
 */
/*
 * 在 ctx 下铸造一个 Agent 作用域：no-op 插件 fiber，其上下文携带 agent
 * 标签与分发过滤器——未带标签的监听器全局放行，带标签的只对匹配的
 * agent 放行。通过返回 ctx 做的注册随 fiber 一起销毁。
 * @param ctx 作用域 fiber 挂载其下的客户端根上下文。
 * @param key 所属 agent 身份（路由标签；agent id === session id）。
 * @returns 带标签的上下文及其底层 fiber。
 */
export function createScope(ctx: Context, key: SessionId): AgentScopeHandle {
  const fiber = ctx.plugin(agentScope) // 挂载共享 no-op 插件，获得独立生命周期边界
  const scoped = fiber.ctx.extend({
    [kScope]: key,
    [CordisContext.filter](listenerCtx: Context): boolean {
      const tag = scopeOf(listenerCtx)
      return tag === undefined || tag === key
    },
  }) as AgentContext
  return {
    fiber,
    ctx: scoped,
  }
}

/**
 * Read the nearest agent tag inherited by a context.
 * @param ctx - any client context.
 * @returns its agent identity (the session id), or undefined for root contexts.
 */
/*
 * 读取上下文继承到的最近一个 agent 标签。
 * @param ctx 任意客户端上下文。
 * @returns 其 agent 身份（即会话 id），根上下文返回 undefined。
 */
export function scopeOf(ctx: Context): SessionId | undefined {
  return (ctx as Context & { [kScope]?: SessionId })[kScope]
}
