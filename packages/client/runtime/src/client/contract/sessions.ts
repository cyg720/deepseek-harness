/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话服务（sessions-service）的对外接口面：ctx.sessions 暴露
 *   给功能包与渲染宿主的能力清单，测试运行时的会话替身必须实现它。
 * 【技术维度】纯类型接口；wire 泵入口（handleMuxEnvelope/handleConnected/
 *   refresh）与运行时内部留在具体类上；跨域消费方用更窄的 SessionsPort。
 * 【产品维度】会话是核心交互域：选中、子代理目录、搜索、fork、标准属性
 *   提供者、Agent 作用域解析都从这里发起。
 * 【逻辑维度】list/currentProvideInfo 是标准源；open/openSubagent/clear
 *   管选中；setSubagentCatalogOpen/refreshSubagents 管子代理目录；
 *   search/fork 管操作；provide/scope/scopeOf/sessionOf/binding 管扩展缝。
 * 【关键边界】拓宽本接口即显式拓宽功能包可对会话域做的事情；unknown id
 *   的 open 会 fail-loud。
 * 【新手阅读建议】对照 sessions/service.ts 看实现，对照 session.ts 看细粒度面。
 * ==========================================================================
 */
/**
 * The outward sessions-service face — what `ctx.sessions` exposes to feature
 * packages and the renderer host, and therefore exactly what the test
 * runtime's sessions double must implement. Wire-pump entry points
 * (handleMuxEnvelope/handleConnected/refresh) and runtime internals stay on
 * the concrete class; cross-domain consumers keep the narrower
 * [SessionsPort](./sessions-port.ts). Widening this interface is the
 * explicit act of widening what features may do to the sessions domain.
 */
/*
 * 会话服务对外面：ctx.sessions 暴露给功能包与渲染宿主的能力，因此也是
 * 测试运行时会话替身必须实现的全部。wire 泵入口（handleMuxEnvelope/
 * handleConnected/refresh）与运行时内部留在具体类上；跨域消费方使用更窄的
 * SessionsPort。拓宽本接口即显式拓宽功能包可对会话域做的事情。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  RpcResult, SessionId, SubagentAddress,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable, SessionMaybeProvideInfo } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentContext } from '../agents/scope.ts'
import type { SessionSearchResultItem } from '../sessions/manager.ts'
import type {
  SessionBinding, SessionListState, SessionProvideDescriptor,
} from '../sessions/service.ts'
import type { SessionFace } from './session.ts'
import type { ObservableSnapshot } from './store.ts'

/** 再导出 AgentContext，使会话契约消费方获得统一的类型入口。 */
export type { AgentContext } from '../agents/scope.ts'

/** The sessions-service face injected as `ctx.sessions`. */
/* 以 ctx.sessions 注入的会话服务面。 */
export interface ISessions {
  /** The useSessions standard feed (list rows + current selection; read face — writes stay inside the domain). */
  /* useSessions 的标准数据源（列表行 + 当前选中；只读面——写操作留在域内部）。 */
  readonly list: ObservableSnapshot<SessionListState>
  /** Atomic current-session provide projection (the renderer host's `sessions.provideInfo` feed). */
  /* 原子性的当前会话 provide 投影（渲染宿主的 sessions.provideInfo 数据源）。 */
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>
  /**
   * The `session.search` result bound the wire schema fixes, exposed to
   * presentation as injected data. Not per-connection state: every transport
   * (fixture included) reports the same number.
   */
  /*
   * session.search 的结果条数上限由 wire schema 固定，以注入数据暴露给
   * 呈现层。不是按连接变化的状态：每种传输（含夹具）都报告同一数值。
   */
  readonly searchResultLimit: number
  /**
   * Select a session as current.
   * @param id - session id (must exist in the list; unknown ids fail loud).
   */
  /*
   * 把某个会话设为当前会话。
   * @param id 会话 id（必须存在于列表中；未知 id 会 fail-loud）。
   */
  open(id: SessionId): void
  /**
   * Open a healthy catalog child through its exact direct-parent address.
   * @param address - catalog-derived parent and child ids.
   */
  /*
   * 通过其精确的直接父地址打开一个健康的目录子会话。
   * @param address 由目录推导的父与子 id。
   */
  openSubagent(address: SubagentAddress): void
  /**
   * Resolve an already discovered direct-parent address without opening it.
   * @param id - possible addressed child id.
   * @returns the retained address, when present.
   */
  /*
   * 解析一个已发现的直接父地址而不打开它。
   * @param id 可能的被寻址子 id。
   * @returns 保留的地址（若有）。
   */
  subagentAddress(id: SessionId): SubagentAddress | undefined
  /**
   * Mark whether a catalog menu is consuming live membership updates.
   * @param parentSessionId - catalog owner.
   * @param open - current menu state.
   */
  /*
   * 标记某个目录菜单是否在消费实时的成员更新。
   * @param parentSessionId 目录属主。
   * @param open 当前菜单状态。
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void
  /**
   * Refresh one direct-child catalog.
   * @param parentSessionId - catalog owner.
   * @returns completion of the current or newly started refresh.
   */
  /*
   * 刷新一个直接子目录。
   * @param parentSessionId 目录属主。
   * @returns 当前或新发起的刷新的完成信号。
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void>

  /**
   * Record the composition one session now runs. The agent-preset seat calls
   * this after a successful blank-session switch, so the header label moves
   * with the composition instead of waiting for the next full list refresh.
   * @param sessionId - the switched session.
   * @param agentPreset - the preset id the host confirmed.
   */
  /*
   * 记录某个会话当前运行的组合（composition）。agent-preset 座位在空白
   * 会话切换成功后调用它，使头部标签随组合移动，而不必等下一次完整
   * 列表刷新。
   * @param sessionId 被切换的会话。
   * @param agentPreset Host 确认的 preset id。
   */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void
  /** Clear the current selection into the no-session view state. */
  /* 清除当前选中，回到"无会话"视图状态。 */
  clear(): void
  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results, or a business/transport error.
   */
  /*
   * 搜索 Host 可见的消息内容索引。结果保持在请求本地；列表快照仍是
   * 元数据的权威来源。
   * @param query 非空白字面短语。
   * @param signal 用于取消被取代搜索的中止信号。
   * @returns 有界结果，或业务/传输错误。
   */
  search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>>
  /**
   * Fork a session from a completed-turn prefix of the source; on resolution
   * the child is in the list store and `open()` can target it.
   * @param opts - source session id, the optional event seq anchoring the
   *   cut (the boundary is the first turn/end at or after it; an in-log
   *   anchor in an open turn is unavailable rather than clipped backward),
   *   and whether to increment an inherited durable title before resolving.
   * @returns the child session id.
   * @throws when the fork fails, or when a requested child-title rename fails after creation.
   */
  /*
   * 从源会话的已完成轮次前缀 fork 出一个子会话；解析完成后子会话进入
   * 列表存储，open() 可指向它。
   * @param opts 源会话 id、可选的事件 seq 锚点（切割边界是该 seq 处或之后
   *   的第一个轮次结束；开放轮次中的日志内锚点不可用，不会向后裁剪），
   *   以及解析前是否递增继承的持久标题。
   * @returns 子会话 id。
   * @throws fork 失败，或创建后请求的子会话标题重命名失败时抛出。
   */
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId>
  /**
   * Register a per-session standard-props provider (hooks become `use<Name>`
   * selector hooks on the render side; props spread verbatim).
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider.
   */
  /*
   * 注册一个按会话的标准属性提供者（hooks 在渲染侧成为 use<Name> 选择器
   * 钩子；props 原样展开）。
   * @param descriptor 静态成员名册 + 按会话解析器。
   * @returns 移除该提供者的销毁函数。
   */
  provide(descriptor: SessionProvideDescriptor): () => void
  /**
   * Resolve an Agent-scoped context view (use-and-discard).
   * @param id - session id.
   * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
   */
  /*
   * 解析一个 Agent 作用域化的上下文视图（即用即弃）。
   * @param id 会话 id。
   * @returns 作用域化 ctx；会话既未列出也未作用域化时为 undefined。
   */
  scope(id: SessionId): AgentContext | undefined
  /**
   * Read the Agent scope tag off a context (service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions).
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  /*
   * 从上下文读取 Agent 作用域标签（服务方法边界：fetch 捆绑必须通过
   * ctx.sessions 到达作用域解析）。
   * @param ctx 任意客户端上下文。
   * @returns 会话 id，根上下文返回 undefined。
   */
  scopeOf(ctx: Context): SessionId | undefined
  /**
   * Resolve the session face behind an Agent-scoped context.
   * @param ctx - an Agent-scoped context.
   * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
   */
  /*
   * 解析 Agent 作用域化上下文背后的会话面。
   * @param ctx 一个 Agent 作用域化上下文。
   * @returns 会话面；ctx 未带标签或其作用域被裁剪时为 undefined。
   */
  sessionOf(ctx: Context): SessionFace | undefined
  /**
   * Resolve the stable session binding (scope-addressed assembly feed).
   * @param id - session id.
   * @returns binding, or undefined for a session neither listed nor already scoped.
   */
  /*
   * 解析稳定的会话绑定（作用域寻址的装配数据源）。
   * @param id 会话 id。
   * @returns 绑定；会话既未列出也未作用域化时为 undefined。
   */
  binding(id: SessionId): SessionBinding | undefined
}
