/*
 * ================================ 文件注释 ================================
 * 【文件职责】实现 Host BFF 的"远程 Agent / Session 身份解析策略"：给定一个
 * 会话标识（sessionId），解析出对应的"活 Agent"（在线复用）或为其冷启动
 * 恢复（resume），并区分哪些会话归属 subagent 路由（不可被通用远程调用
 * 触碰）；同时把这些解析能力注册为 Typert 的 lookup / context 提供者。
 * 【技术维度】基于 dsh-agent（agents 注册表 / resume）与 dsh-session
 * （sessions 会话表 / sessionPersistence 持久化后端）的协作：用
 * ctx.inject 挂接 typert 注册表，通过 lookups.configure 与 contexts.configureHost
 * 注册 'agent' / 'session' 两种查找与一个上下文；冷启动并发去重用 Map 缓存
 * 进行中的 resume Promise。
 * 【产品维度】远程客户端（IDE 扩展 / ACP）常以"会话 ID"为句柄调用 Host
 * 能力；本文件把"会话 ID → 可用 Agent"的解析规则集中为一处策略，并保证
 * 子代理（subagent）会话不被通用路由误用（维持 legacy agent-busy 语义）。
 * 【逻辑维度】按出现顺序：错误与结果类型 → 选项接口 ApiRemoteAgentOptions
 * → 异常类 → 判断函数 hasApiRemoteSubagentOwner / 错误构造
 * apiRemoteSubagentOwnershipError → 检查函数 inspectApiRemoteSession →
 * 解析器工厂 createApiRemoteAgentResolver（在线优先 → 冷恢复去重 → 错误映射
 * → Typert 提供者注册）。
 * 【关键边界】冷恢复"每个身份只执行一次"（resumes 缓存，finally 中清除）；
 * 恢复前后各做一次 subagent 归属复检以收窄并发碰撞窗口；持久化后端缺失时
 * 明确报错而不是静默跳过。
 * 【新手阅读建议】先读类型与 ApiRemoteAgentOptions 理解输入输出，再顺着
 * createApiRemoteAgentResolver 的 agentFor 读"在线 → 冷恢复 → 错误映射"的
 * 完整分支，最后看末尾的 typert 注册理解它与网关的接线。
 * ==========================================================================
 */
/** Host BFF policy for resolving Remote Agent and Session identities. */
// 英文模块注释的中文解释：本文件是 Host BFF 的"远程 Agent / Session 身份
// 解析策略"，集中定义如何把会话标识解析成活 Agent。

// 中文：导入所需类型：Cordis Context、Agent 相关（Agent / AgentOptions /
// AgentSetup）、Session 相关（Session / SessionEvent / SessionHeader /
// SessionId），以及 Typert 协议层用于向上抛"调用方可见失败"的
// TypertLookupFailure；两个空导入分别引入持久化与注册表的类型副作用。
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'

/** Caller-facing failures preserved by the Gateway's RPC adapter. */
// 中文：面向调用方的失败形状（被网关 RPC 适配器原样保留）：agent-busy
// （子代理归属拒绝）、session-not-found（会话不存在）、internal（其余内部
// 失败）；都是可被远程客户端机器识别的判别联合。
export type ApiRemoteLookupError =
  | { readonly code: 'agent-busy'; readonly message: string; readonly details: { readonly reason: string } }
  | { readonly code: 'session-not-found'; readonly message: string; readonly details: { readonly sessionId: SessionId } }
  | { readonly code: 'internal'; readonly message: string; readonly details: Record<never, never> }

/** Result of resolving one session identity to its live Agent. */
// 中文：一次身份解析的结果：要么得到活 Agent，要么得到上述可透传的错误。
export type ApiRemoteAgentResult =
  | { readonly agent: Agent }
  | { readonly error: ApiRemoteLookupError }

/** Resume configuration supplied by the owning Host composition. */
// 中文：冷启动恢复（resume）时由宿主装配提供的配置：默认 Agent 选项与
// Agent 作用域组合的构建函数。
export interface ApiRemoteAgentOptions {
  /** Read the per-Agent defaults when a cold identity must resume. */
  // 中文：冷身份需要恢复时读取"每个 Agent 的默认选项"；返回 undefined 表示
  // 没有默认项，不传给 resume。
  readonly agentOptions?: () => AgentOptions
  /**
   * Build the Host-specific Agent-scope composition completed before
   * publication. Keyed by the resumed session itself because what a Host
   * installs may depend on what that session recorded: an agent preset fixes
   * the tools its history was produced under, so rebuilding it under another
   * composition would replay tool calls the agent can no longer make. The
   * events come along because a session's own record of such a choice may be
   * an event rather than a header field.
   * @param session - the resumed session's persisted header and event log.
   * @returns the Agent-scope setup to run before publication.
   */
  // 中文：构建"发布（publication）前需完成的 Host 特定 Agent 作用域组合"。
  // 之所以以"被恢复的会话本身"为键：Host 装什么可能取决于该会话记录了什么——
  // agent 预设固定了其历史产生时所依赖的工具，若换一种组合重建，就会重放
  // 该 Agent 已无法执行的工具调用。附带事件是因为会话对这类选择的记录可能
  // 是事件而非头部字段。
  readonly setup?: (
    session: { meta: SessionHeader; events: readonly SessionEvent[] },
  ) => AgentSetup | Promise<AgentSetup>
}

/** Cold identity absent from the durable session store. */
// 中文：冷身份在持久化会话库中不存在时抛出的异常（映射为 session-not-found）。
export class ApiRemoteSessionNotFound extends Error {}

/** Session identity whose lifecycle belongs to subagent routing. */
// 中文：会话身份的生命周期属于 subagent 路由时抛出的异常——通用远程与
// legacy API 调用必须拒绝这类身份（映射为 agent-busy）。
export class ApiRemoteSubagentSessionOwnership extends Error {
  /**
   * Construct the ownership fence.
   * @param sessionId - identity reserved to subagent routing.
   */
  // 中文：构造归属围栏：记录被保留给 subagent 路由的会话 ID。
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is a subagent session; use subagent delivery`)
  }
}

/**
 * Test whether generic Host routing must leave an identity to subagent routing.
 * @param ctx - Host Context carrying the live Agent registry.
 * @param session - attached or live Session metadata.
 * @param agent - live Agent when one is registered.
 * @returns whether generic Remote and legacy API calls must reject the identity.
 */
// 中文：判断通用 Host 路由是否必须把某身份让给 subagent 路由：会话起源是
// subagent，或（有活 Agent 时）其父会话在 Agents 注册表中存在且本 Agent 被
// 判定归属该父会话；命中任一即返回 true，通用 Remote / legacy API 必须拒绝。
export function hasApiRemoteSubagentOwner(
  ctx: Context,
  session: Pick<Session, 'header'>,
  agent: Agent | undefined,
): boolean {
  if (session.header.origin === 'subagent') return true
  const parentId = session.header.parentSession // 中文：父会话 ID（无父会话或没有活 Agent 时直接放行）
  if (parentId === undefined || agent === undefined) return false
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent)
}

/**
 * Build the stable caller-facing ownership rejection.
 * @param sessionId - identity reserved to subagent routing.
 * @returns the existing `agent-busy` RPC shape.
 */
// 中文：构造稳定的、面向调用方的归属拒绝：沿用既有的 agent-busy RPC 形状，
// 提示调用方改用 subagent 投递通道处理该子会话。
export function apiRemoteSubagentOwnershipError(sessionId: SessionId): ApiRemoteLookupError {
  return {
    code: 'agent-busy',
    message: `session "${sessionId}" is owned by subagent routing`,
    details: { reason: 'use subagent delivery for this child session' },
  }
}

/**
 * Inspect one cold served session without repairing, resuming, or publishing it.
 * @param ctx - Host Context carrying the optional persistence provider.
 * @param sessionId - durable identity to inspect.
 * @returns detached metadata and events for a servable session.
 * @throws {@link ApiRemoteSessionNotFound} when the identity has no project-backed session.
 */
// 中文：只读检查一个"冷"会话（不修复、不恢复、不发布）：从持久化后端取出
// 其元数据与事件日志并原样返回；身份没有项目支撑的会话则抛
// ApiRemoteSessionNotFound。cwd 缺失视为不可服务。
export async function inspectApiRemoteSession(
  ctx: Context,
  sessionId: SessionId,
): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
  // 中文：取持久化服务；后端未装配（如未加载 dsh-session-persistence 后端）
  // 时明确报错，而不是静默让后续调用落空。
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new Error('session persistence is not configured (load a dsh-session-persistence backend)')
  }
  // 中文：先粗查列表确认身份存在且有 cwd，再进入 inspect 取详细内容。
  const meta = (await persistence.list()).find(candidate => candidate.id === sessionId)
  if (meta === undefined || meta.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  const inspected = await persistence.inspect(sessionId)
  if (inspected.meta.cwd === undefined) {
    throw new ApiRemoteSessionNotFound(`session "${sessionId}" not found`)
  }
  // 中文：事件日志复制成新数组返回，避免调用方改动内部存储。
  return { meta: inspected.meta, events: [...inspected.events] }
}

/**
 * Create the Host's shared Agent resolver and configure Agent/Session Typert lookups.
 * Live Agents are reused, ordinary cold sessions resume once per identity, and
 * subagent-owned identities retain the legacy `agent-busy` fence.
 * @param ctx - owning Host Context.
 * @param options - defaults and Agent-scope setup used only for cold resume.
 * @returns resolver shared by legacy API Proxy methods and Typert lookups.
 */
// 中文：创建 Host 共享的 Agent 解析器，并配置 Agent / Session 的 Typert
// 查找与上下文提供者。策略：在线 Agent 直接复用；普通冷会话每个身份只
// 恢复一次；subagent 归属的身份保留 legacy 的 agent-busy 围栏。返回的
// 解析函数同时供 legacy API Proxy 方法与 Typert lookup 使用。
export function createApiRemoteAgentResolver(
  ctx: Context,
  options: ApiRemoteAgentOptions,
): (sessionId: SessionId) => Promise<ApiRemoteAgentResult> {
  // 中文：进行中（或已失败但尚未清理）的恢复 Promise 缓存：并发的同身份
  // 请求共享同一次 resume，避免重复恢复；finally 中删除以保证下次重试。
  const resumes = new Map<SessionId, Promise<Agent>>()

  // 中文：在线优先分支：会话已在 Agents 注册表中则直接返回活 Agent；
  // 命中 subagent 归属围栏则返回 agent-busy 错误；否则返回 undefined
  // 表示"没有在线 Agent，需要走冷恢复"。
  const fencedLiveAgent = (sessionId: SessionId): ApiRemoteAgentResult | undefined => {
    const live = ctx.agents.get(sessionId)
    if (live === undefined) return undefined
    if (hasApiRemoteSubagentOwner(ctx, live.session, live)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    return { agent: live }
  }

  // 中文：核心解析函数。分支顺序：在线复用 → 已挂接会话的归属检查 →
  // 冷恢复（并发去重）→ 失败分类（session-not-found / 归属 / internal，
  // 并兜底重查在线状态以应对恢复期间的竞态）。
  const agentFor = async (sessionId: SessionId): Promise<ApiRemoteAgentResult> => {
    const fenced = fencedLiveAgent(sessionId)
    if (fenced !== undefined) return fenced
    const attached = ctx.sessions.get(sessionId)
    if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
      return { error: apiRemoteSubagentOwnershipError(sessionId) }
    }
    let resume = resumes.get(sessionId)
    if (resume === undefined) {
      resume = (async () => {
        try {
          const inspected = await inspectApiRemoteSession(ctx, sessionId)
          if (hasApiRemoteSubagentOwner(ctx, { header: inspected.meta }, undefined)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          // Built from the inspected session before the published re-checks
          // below, so those stay adjacent to `resume` and a Host setup that
          // awaits (composing a preset, say) does not widen the collision
          // window.
          // 中文：基于"检查到的会话"构建 setup，位置放在下方"发布后复检"之前，
          // 使复检紧贴 resume 执行；若 Host 的 setup 会 await（比如组合 preset），
          // 这样的顺序也不会拉宽并发碰撞窗口。
          const setup = options.setup === undefined ? undefined : await options.setup(inspected)
          // 中文：恢复前再复检一次"发布后的"会话 / Agent 归属，收窄与
          // 并发 subagent 路由之间的竞态窗口。
          const publishedSession = ctx.sessions.get(sessionId)
          const publishedAgent = ctx.agents.get(sessionId)
          if (publishedSession !== undefined
            && hasApiRemoteSubagentOwner(ctx, publishedSession, publishedAgent)) {
            throw new ApiRemoteSubagentSessionOwnership(sessionId)
          }
          // 中文：真正执行冷恢复：按需附上默认选项与 Agent 作用域 setup。
          const handle = await ctx.agents.resume({
            resumeSessionId: sessionId,
            ...options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions() },
            ...setup === undefined ? {} : { setup },
          })
          return handle.agent
        } finally {
          // 中文：无论成败都移除缓存条目，保证失败后可重试、成功后释放内存。
          resumes.delete(sessionId)
        }
      })()
      resumes.set(sessionId, resume)
    }
    try {
      return { agent: await resume }
    } catch (error: unknown) {
      // 中文：失败分类：会话不存在 / 子代理归属 直接映射；其余内部错误在
      // 兜底重查在线状态后仍失败才归为 internal（应对恢复期间已被并发
      // 恢复上线的竞态）。
      if (error instanceof ApiRemoteSessionNotFound) {
        return { error: { code: 'session-not-found', message: error.message, details: { sessionId } } }
      }
      if (error instanceof ApiRemoteSubagentSessionOwnership) {
        return { error: apiRemoteSubagentOwnershipError(error.sessionId) }
      }
      const fenced = fencedLiveAgent(sessionId)
      if (fenced !== undefined) return fenced
      const attached = ctx.sessions.get(sessionId)
      if (attached !== undefined && hasApiRemoteSubagentOwner(ctx, attached, undefined)) {
        return { error: apiRemoteSubagentOwnershipError(sessionId) }
      }
      return {
        error: {
          code: 'internal',
          message: `resume failed for session "${sessionId}": ${String(error)}`,
          details: {},
        },
      }
    }
  }

  // 中文：把解析能力注册进 Typert：'agent' 查找（会话 ID → Agent）、
  // 'session' 查找（会话 ID → Session）、以及 'agent' 上下文提供者
  // （会话 ID → Agent 所在 Context），供网关的 lookup / context 调用使用。
  ctx.inject(['typert'], (typeCtx) => {
    const resolveAgent = async (sessionId: SessionId): Promise<Agent> => {
      const found = await agentFor(sessionId)
      if ('error' in found) throw new TypertLookupFailure(found.error)
      return found.agent
    }
    typeCtx.typert.lookups.configure('agent', resolveAgent)
    typeCtx.typert.lookups.configure('session', async sessionId => (await resolveAgent(sessionId)).session)
    typeCtx.typert.contexts.configureHost('agent', async sessionId => (await resolveAgent(sessionId)).ctx)
  })

  return agentFor
}
