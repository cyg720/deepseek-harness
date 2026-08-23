/**
 * ================================ 文件注释 ================================
 * 【文件职责】SessionRuntime：根会话服务——列表快照存储（含持久化选中
 *   current）、Agent 作用域树、稳定 SessionBinding 缓存、面包屑路由投影。
 * 【技术维度】管理器（SessionManager）是 wire 真值、list 是投影；作用域
 *   生命周期由"舞台"（stage）驱动：懒铸造、随 current 开窗、离场即拆。
 * 【产品维度】会话侧边栏、会话路由、标准属性 provide、子代理目录、fork
 *   与搜索都经本服务；选中会话的窗口"打开"与舞台严格同步。
 * 【逻辑维度】类型区定义概要/列表/绑定；构造函数装配管理器、存储、提供
 *   通道与注册表重建；公开面（open/clear/search/fork/provide/scope 系列）；
 *   私有区（followCurrent/resolve/eligible/projectList/pruneScopes 等）。
 * 【关键边界】舞台（watched）在遮蔽间隙保持冻结视图；被裁剪的会话延迟到
 *   舞台移开再拆；create/fork 保证解析时新会话已在列表存储中（同步可寻址）。
 * 【新手阅读建议】先读 manager.ts 与 session.ts，再看本文件的舞台生命周期。
 * ==========================================================================
 */
/**
 * SessionRuntime: root sessions service — list snapshot store (manager
 * projection; carries `current`, the persisted selection every
 * session-scoped surface keys off), Agent scope tree (mintScope pattern: no-op plugin
 * Fiber + ctx.extend scope tag; one scope per session, agent id === session
 * id), stable SessionBinding cache, breadcrumb-route projection.
 *
 * Scope lifecycle is stage-driven: a scope is minted lazily on first
 * resolution (pure — resolution has no side effects and is render-safe);
 * the event window and deferred teardown key off the STAGED session, which
 * follows `list.current` exactly. Staging is the open signal: the window
 * opens ⟺ the session is on stage (today the stage is `current`; the staged
 * state can widen to a multi-pane list later). A session leaving the list
 * tears its scope down immediately unless it is the staged one, whose scope
 * survives frozen (read-only view) until the stage moves on.
 */
/**
 * SessionRuntime：根会话服务——列表快照存储（管理器投影；携带 current，
 * 每个会话作用域表面都以此为键的持久选中）、Agent 作用域树（mintScope
 * 模式：no-op 插件 Fiber + ctx.extend 作用域标签；每会话一个作用域，
 * agent id === session id）、稳定 SessionBinding 缓存、面包屑路由投影。
 *
 * 作用域生命周期由舞台（stage）驱动：作用域在首次解析时懒铸造（纯——
 * 解析无副作用且渲染安全）；事件窗口与延迟拆除都以 STAGED 会话为键，
 * 它精确跟随 list.current。上台即开窗信号：窗口打开 ⟺ 会话在舞台上
 * （今天舞台就是 current；将来可放宽为多窗格列表）。离开列表的会话
 * 立即拆除其作用域，除非它是舞台会话——其作用域保持冻结（只读视图）
 * 直到舞台移开。
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {
  IApiClient, RpcError, RpcResult, SessionId, SubagentAddress, JobView, WorkspaceId,
} from '@deepseek-ai/dsh-api-remotes/client'
// Value import from the inline-safe wire layer (not the connection plugin):
// plugin-to-plugin value imports are a bundle purity error.
// 从内联安全的 wire 层做值导入（而非 connection 插件）：插件到插件的值
// 导入是捆绑纯净性错误。
import { SESSION_SEARCH_RESULT_LIMIT } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  HostObservable, SessionMaybeProvideInfo, SessionProvideInfo,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types'
import type { SnapshotStore } from '../contract/store.ts'
import { createSnapshotStore } from '../contract/store.ts'
import type { SessionFace } from '../contract/session.ts'
import type { AgentContext, ISessions } from '../contract/sessions.ts'
import { createScope, scopeOf as scopeTagOf } from '../agents/scope.ts'
import type { ConversationRuntime } from './conversation-assembler.ts'
import { SessionManager } from './manager.ts'
import type { SessionRemotes } from './remotes.ts'
import type { SessionListPhase, SessionSearchResultItem, SubagentCatalogSnapshot } from './manager.ts'
import type { PendingInteractionStatus } from './pending.ts'
import { SessionProvideChannel } from './provide.ts'
import type { Session } from './session.ts'

/** Session list row projected from the host list RPC plus live stream increments. */
/** 由 Host 列表 RPC 加实时流增量投影出的会话列表行。 */
export interface SessionSummary {
  id: SessionId
  /** Latest durable log-backed title, absent until the host projects one. */
  /** 最新持久化日志支持的标题；Host 投影前缺失。 */
  title?: string
  /** Human-facing label: durable title, project basename, then session id. */
  /** 人类可读标签：持久标题、项目目录基名、然后会话 id。 */
  displayTitle: string
  cwd?: string
  /**
   * Agent preset this session's agent was composed from; absent when the
   * deployment composes no presets. The session header labels what the
   * session actually runs rather than the deployment's current default.
   */
  /**
   * 本会话 agent 组合时使用的 agent preset；部署不组合 preset 时缺失。
   * 会话头标注会话实际运行的 preset，而非部署当前默认值。
   */
  agentPreset?: string
  parentId?: SessionId
  /** Coarse durable origin for navigation filtering; not a continuation capability. */
  /** 供导航过滤使用的粗粒度持久来源；不是续接能力。 */
  origin?: 'subagent'
  running: boolean
  /** User interaction currently blocking this session (sidebar amber-dot state). */
  /** 当前阻塞本会话的用户交互（侧边栏琥珀点状态）。 */
  pendingInteraction?: PendingInteractionStatus
  /** Finished while not selected and not yet opened — the sidebar's green "done" reminder. Absent = false. */
  /** 未选中且未打开时已运行完成——侧边栏绿色"完成"提醒。缺省 = false。 */
  completed?: boolean
  /**
   * Empty-log bit (host summary derivation mirror). New Session reuses a blank
   * one targeting the same workspace. Filtering stays with the consumer: the
   * store carries every row, while the Workspace browser shows only the
   * selected blank entry.
   */
  /**
   * 空日志位（Host 概要推导镜像）。New Session 复用指向同一工作区的空白
   * 会话。过滤留在消费方：存储携带每行，而工作区浏览器只展示选定的空白项。
   */
  blank: boolean
  updatedAt: number
  /** Current host-computed projection values retained by the object layer. */
  /** 对象层保留的当前 Host 计算投影值。 */
  projectionValues?: Readonly<Partial<SessionProjectionMap>>
}

/**
 * Session list store shape. `current` rides the same snapshot (arbitrated:
 * the single useSessions standard hook reads list and selection together —
 * sidebar highlighting and SessionProvider share one fact source).
 */
/**
 * 会话列表存储形状。current 与列表在同一快照上（仲裁：唯一 useSessions
 * 标准钩子同时读列表与选中——侧边栏高亮与 SessionProvider 共享一个事实源）。
 */
export interface SessionListState {
  /** Host-list order; addressed breadcrumb-only rows are excluded. */
  /** Host 列表顺序；被寻址的面包屑专属行被排除。 */
  ids: SessionId[]
  /** Host rows plus the current addressed subagent route used by navigation. */
  /** Host 行 + 导航使用的当前寻址子代理路由。 */
  byId: Record<SessionId, SessionSummary>
  current: SessionId | undefined
  /** Arrival lifecycle projected 1:1 from the manager snapshot (see SessionListPhase): empty-with-ready means "truly no sessions". */
  /** 从管理器快照 1:1 投影的到达生命周期（见 SessionListPhase）：空且 ready 意味着"真没有会话"。 */
  phase: SessionListPhase
  /** Direct durable catalogs keyed by their selected parent address. */
  /** 按其选中父地址键控的直接持久目录。 */
  subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>
  /**
   * Background jobs each session can see, mirrored last-wins from
   * `session/jobs`. A missing key is an empty set — the Host sends no baseline
   * for a session without tasks — so consumers read absence, never a sentinel.
   */
  /**
   * 每个会话可见的后台任务，从 session/jobs 以后到者胜镜像。缺失键即空集
   * ——Host 对无任务的会话不发基线——因此消费方读"缺失"而非哨兵值。
   */
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>
  /** Current session's catalog-derived address, absent on ordinary navigation. */
  /** 当前会话的目录派生地址；普通导航时缺失。 */
  currentAddress: SubagentAddress | undefined
}

/** Persisted navigation cell: address survives refresh for correct history routing. */
/** 持久化导航单元：地址在刷新后存活，保证历史路由正确。 */
interface SessionSelection {
  sessionId?: SessionId
  subagentAddress?: SubagentAddress
}

/** Structured session-create failure. */
/** 结构化的会话创建失败。 */
export class SessionCreateError extends Error {
  override readonly name = 'SessionCreateError'

  /**
   * @param rpcError - Host business or folded transport error.
   * @param requestedSessionId - caller-preallocated id used for later stream/list reconciliation.
   */
  /**
   * @param rpcError Host 业务或折叠传输错误。
   * @param requestedSessionId 调用方预分配的 id，用于之后的流/列表对账。
   */
  constructor(
    readonly rpcError: RpcError,
    readonly requestedSessionId: SessionId | undefined,
  ) {
    super(`session create failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Structured session-fork failure. */
/** 结构化的会话 fork 失败。 */
export class SessionForkError extends Error {
  override readonly name = 'SessionForkError'

  /**
   * @param rpcError - Host business or folded transport error.
   * @param sourceSessionId - the session the fork was cut from.
   */
  /**
   * @param rpcError Host 业务或折叠传输错误。
   * @param sourceSessionId fork 切割的源会话。
   */
  constructor(
    readonly rpcError: RpcError,
    readonly sourceSessionId: SessionId,
  ) {
    super(`session fork failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Session assembly handle for SessionProvider/inject factories (identity-stable per session). */
/** 供 SessionProvider/inject 工厂使用的会话装配句柄（每会话身份稳定）。 */
export interface SessionBinding {
  readonly sessionId: SessionId
  /** The outward session face only — feature code never sees the concrete class. */
  /** 仅对外会话面——功能代码永远看不到具体类。 */
  readonly session: SessionFace
  readonly ctx: AgentContext
}

// Scope primitives live in ../agents/scope.ts (the client mirror of host
// dsh-scope, keyed by Agent identity); re-exported here so existing
// consumers keep their import site.
// 作用域原语在 ../agents/scope.ts（Host dsh-scope 的客户端镜像，按 Agent
// 身份键控）；在此再导出，使既有消费方保持导入位置。
export { scopeOf } from '../agents/scope.ts'

/**
 * Workspace display title of a session cwd: the path's last non-empty
 * segment (both separators accepted; trailing separators ignored), or ''
 * for separator-only paths — callers own their fallback (session id, raw
 * cwd, default-directory copy). The repo-wide single basename derivation —
 * every surface naming a workspace (picker rows, toggle labels, list titles)
 * calls this instead of re-splitting paths.
 * @param cwd - workspace directory path.
 * @returns basename title, or '' when no non-empty segment exists.
 */
/**
 * 会话 cwd 的工作区展示标题：路径最后一个非空段（两种分隔符都接受；
 * 忽略结尾分隔符），纯分隔符路径返回 ''——调用方自行决定回退（会话 id、
 * 原始 cwd、默认目录文案）。这是仓库级唯一的基名推导——每个命名工作区
 * 的面（选择器行、切换标签、列表标题）都调用它而非重新切分路径。
 * @param cwd 工作区目录路径。
 * @returns 基名标题；无非空段时返回 ''。
 */
export function workspaceTitleOf(cwd: string): string {
  return cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
}

/**
 * Display title projection: durable title, project directory basename, then
 * the raw id.
 */
/**
 * 展示标题投影：持久标题、项目目录基名、然后原始 id。
 */
function displayTitleOf(title: string | undefined, cwd: string | undefined, id: SessionId): string {
  if (title !== undefined) return title
  if (cwd !== undefined && cwd !== '') {
    const base = workspaceTitleOf(cwd)
    if (base !== '') return base
  }
  return id
}

/**
 * Increment a trailing fork number while preserving its half-width or
 * full-width parentheses; an unnumbered title starts with ` (1)`.
 * @param title - source session's durable title.
 * @returns the title assigned to the fork child.
 */
/**
 * 递增结尾的 fork 序号，同时保留半角或全角括号；未编号标题从 ` (1)` 起。
 * @param title 源会话的持久标题。
 * @returns 分配给 fork 子会话的标题。
 */
function increasedForkTitle(title: string): string {
  const ascii = /^(.*?)\((\d+)\)$/u.exec(title)
  if (ascii?.[1] !== undefined && ascii[2] !== undefined) {
    return `${ascii[1]}(${BigInt(ascii[2]) + 1n})`
  }
  const fullWidth = /^(.*?)（(\d+)）$/u.exec(title)
  if (fullWidth?.[1] !== undefined && fullWidth[2] !== undefined) {
    return `${fullWidth[1]}（${BigInt(fullWidth[2]) + 1n}）`
  }
  return `${title} (1)`
}

/** 每个已铸造作用域的记录：fiber/ctx/绑定/会话实例/provide 捆绑。 */
interface ScopeRecord {
  fiber: Fiber
  ctx: AgentContext
  binding: SessionBinding
  /** The concrete Session for runtime-internal entry points (staging open()); the binding carries only the outward face. */
  /** 供运行时内部入口（舞台上 open()）使用的具体 Session；绑定只携带对外面。 */
  session: Session
  /** Render-layer standard-props bundle (identity-stable per scope; the renderer's per-info caches key off it). */
  /** 渲染层标准属性捆绑（每作用域身份稳定；渲染器的每信息缓存以它为键）。 */
  provideInfo: SessionProvideInfo
}

/** One plugin's per-session standard-props contribution (see {@link SessionRuntime.provide}). */
/** 一个插件的按会话标准属性贡献（见 SessionRuntime.provide）。 */
export interface SessionProvideContribution {
  /** Bare observable sources, keyed by hook base name ('input' → useInput). */
  /** 裸可观察源，按钩子基名键控（'input' -> useInput）。 */
  hooks?: Record<string, HostObservable<unknown>>
  /** Stable plain members (action callbacks etc.), spread into standard props verbatim. */
  /** 稳定的普通成员（动作回调等），原样展开进标准属性。 */
  props?: Record<string, unknown>
}

/**
 * Static declaration plus per-session resolver for one standard-kit
 * contribution. The declared names let the renderer construct the same hook
 * and prop surface while no session is current.
 */
/**
 * 一个标准套件贡献的静态声明 + 按会话解析器。声明名使渲染器在无当前会话
 * 时也能构造相同的钩子与属性面。
 */
export interface SessionProvideDescriptor {
  /** Hook base names (`input` becomes `useInput`). */
  /** 钩子基名（input 变成 useInput）。 */
  hooks?: readonly string[]
  /** Plain standard-prop names. */
  /** 普通标准属性名。 */
  props?: readonly string[]
  /** Resolve every declared member for one definite session. */
  /** 为某个确定会话解析每个声明成员。 */
  resolve(binding: SessionBinding): SessionProvideContribution
}

/** Root sessions service: list store, current selection, object-layer manager, scope tree, bindings, and breadcrumb routes. */
/** 根会话服务：列表存储、当前选中、对象层管理器、作用域树、绑定与面包屑路由。 */
export class SessionRuntime implements ISessions {
  /**
   * The wire schema's own result bound, re-exposed for presentation plugins as
   * injected data. Not per-connection state: the `session.search` response
   * schema caps `items` at this constant, so every transport (fixture included)
   * reports the same number.
   */
  /**
   * wire schema 自身的结果条数上限，作为注入数据重新暴露给呈现插件。
   * 不是按连接的状态：session.search 响应 schema 把 items 封顶在此常量，
   * 因此每种传输（含夹具）报告同一数值。
   */
  readonly searchResultLimit = SESSION_SEARCH_RESULT_LIMIT
  /** List snapshot store (list RPC + host stream increments; re-pulled on reconnect) — the useSessions standard feed, current included. */
  /** 列表快照存储（列表 RPC + Host 流增量；重连时重拉）——useSessions 标准源，含 current。 */
  readonly list: SnapshotStore<SessionListState>
  /** The object-layer instance cluster and frame dispatch entry. */
  /** 对象层实例簇与帧分发入口。 */
  private readonly manager: SessionManager
  /**
   * Atomic current-session provide projection: selection changes and
   * provider-roster changes publish through this one source (the renderer
   * host's `sessions.provide` feed), so a roster change under a stable
   * current id republishes the bundle instead of stranding mounted entries.
   */
  /**
   * 原子性的当前会话 provide 投影：选中变化与提供者名册变化都经这一个源
   * 发布（渲染宿主的 sessions.provide 数据源），使当前 id 稳定时的名册
   * 变化重新发布捆绑，而不是让已挂载条目搁浅。
   */
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>

  /**
   * Persisted selection cell (the durable half of `list.current`). Private on
   * purpose: reads go through the list snapshot; writes through {@link
   * SessionRuntime.open} / {@link SessionRuntime.clear}. Projection
   * validates it against the live list instead of destructively pruning, so a
   * selection survives transient list states (reconnect re-pull) and
   * resurfaces when its session returns.
   */
  /**
   * 持久化选中单元（list.current 的持久半边）。刻意私有：读走列表快照；
   * 写经 open / clear。投影会对照活跃列表校验它而非破坏性裁剪，因此选中
   * 在瞬态列表状态（重连重拉）下存活，并在其会话回归时重新浮现。
   */
  private readonly selection: SnapshotStore<SessionSelection>

  private readonly scopes = new Map<SessionId, ScopeRecord>() // 会话 id -> 作用域记录
  /** The provide channel (roster, materialization rules, current projection) — shared with the test runtime's double. */
  /** provide 通道（名册、物化规则、当前投影）——与测试运行时的替身共享。 */
  private readonly provideChannel: SessionProvideChannel
  /**
   * The staged session id — follows `list.current` exactly, holding its last
   * defined value across masked gaps (a transiently absent selection blanks
   * `current` without moving the stage, so reconnect re-pulls and removals
   * keep the staged scope's frozen view alive until the stage moves on).
   */
  /**
   * 舞台会话 id——精确跟随 list.current，在遮蔽间隙保持最后定义值
   * （瞬态缺失的选中清空 current 但不移动舞台，因此重连重拉与移除都保持
   * 舞台作用域的冻结视图存活，直到舞台移开）。
   */
  private watched: SessionId | undefined
  /** Removed-while-staged sessions whose teardown waits for the stage to move away. */
  /** 舞台上被移除的会话，其拆除等待舞台移开。 */
  private readonly deferredRemovals = new Set<SessionId>()

  /**
   * @param ctx - client root context (scope fibers mount under it).
   * @param api - wire client shared with every Session.
   * @param remote - generated Remote namespaces shared with every Session.
   * @param conversationRuntime - same-pass registry instances, when runtime apply owns them.
   */
  /**
   * @param ctx 客户端根上下文（作用域 fiber 挂载其下）。
   * @param api 每个会话共享的线上客户端。
   * @param remote 每个会话共享的生成远程命名空间。
   * @param conversationRuntime 当运行时 apply 拥有它们时，同趟的注册表实例。
   */
  constructor(
    private readonly rootCtx: Context,
    api: IApiClient,
    remote: SessionRemotes,
    conversationRuntime?: ConversationRuntime,
  ) {
    this.selection = createSnapshotStore<SessionSelection>(
      {},
      { persist: { name: 'dsh.sessions.current' } })
    const restored = this.selection.getSnapshot()
    const conversationEvents = rootCtx.get('conversationEvents')
    const conversationViews = rootCtx.get('conversationViews')
    const conversation = conversationRuntime ?? (
      conversationEvents === undefined || conversationViews === undefined
        ? undefined
        : { events: conversationEvents, views: conversationViews }
    )
    this.manager = new SessionManager(
      api,
      remote,
      restored.sessionId,
      restored.subagentAddress,
      conversation,
    )
    this.list = createSnapshotStore<SessionListState>({
      ids: [], byId: {}, current: undefined, phase: 'pending',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })
    // The manager owns wire truth; the store is its projection. Manager
    // notifications are already microtask-batched.
    // 管理器拥有 wire 真值；存储是它的投影。管理器通知已微任务批处理。
    this.manager.subscribe(() => { this.projectList() })
    // Stage follower: every current write (open() and projection alike)
    // re-evaluates staging, so startup restore (persisted selection validated
    // by the projection) and reconnect resurfacing open their window with no
    // dedicated code path. Safe to run synchronously inside the store notify:
    // the follower writes no list state — session.open()'s synchronous prefix
    // touches only session-side state and its own microtask-batched notifier.
    // The current-provide projection follows the same current writes.
    // 舞台跟随器：每次 current 写入（open() 与投影一致）都重新评估舞台，
    // 因此启动恢复（投影校验持久选中）与重连回归无需专用代码路径即开窗。
    // 在存储通知内同步运行是安全的：跟随器不写列表状态——session.open()
    // 的同步前缀只触碰会话侧状态与其自己的微任务批处理通知器。
    // 当前 provide 投影跟随同样的 current 写入。
    this.list.subscribe(() => {
      this.followCurrent()
      this.provideChannel.publishCurrent()
    })
    this.provideChannel = new SessionProvideChannel({
      rebuildBundles: () => {
        for (const record of this.scopes.values()) {
          record.provideInfo = this.provideChannel.materializeInfo(record.binding)
        }
      },
      resolveCurrent: () => this.maybeProvideInfo(this.list.getSnapshot().current),
    })
    this.currentProvideInfo = this.provideChannel.currentProvideInfo
    let registryRebuildQueued = false
    const scheduleRegistryRebuild = (): void => {
      if (registryRebuildQueued) return
      registryRebuildQueued = true
      queueMicrotask(() => {
        registryRebuildQueued = false
        this.manager.rebuildConversationRegistry()
      })
    }
    if (conversation !== undefined) {
      rootCtx.effect(() => {
        const disposeEvents = conversation.events.subscribe(scheduleRegistryRebuild)
        const disposeViews = conversation.views.subscribe(scheduleRegistryRebuild)
        return () => {
          disposeEvents()
          disposeViews()
        }
      }, 'sessions: conversation registry rebuild')
    }
    rootCtx.reflect.provide('sessions', this, undefined)
  }

  /**
   * Register a per-session standard-props provider: every session-scope slot
   * component receives the contributed members as standard props (`hooks`
   * sources become `use<Name>` selector hooks on the render side; `props`
   * spread verbatim). Contributions materialize lazily with the session's
   * scope record and die with it. Registration order is resolution order;
   * duplicate member names fail loud at materialization.
   * @param descriptor - static member roster plus per-session resolver.
   * @returns disposer removing the provider (already-materialized bundles keep their members until their scope drops).
   */
  /**
   * 注册一个按会话的标准属性提供者：每个会话作用域槽位组件都收到贡献的
   * 成员作为标准属性（hooks 源在渲染侧成为 use<Name> 选择器钩子；props
   * 原样展开）。贡献随会话作用域记录懒物化、随它消亡。注册顺序即解析
   * 顺序；重复成员名在物化时 fail-loud。
   * @param descriptor 静态成员名册 + 按会话解析器。
   * @returns 移除提供者的销毁函数（已物化捆绑在其作用域消亡前保留成员）。
   */
  provide(descriptor: SessionProvideDescriptor): () => void {
    // Scopes may already exist (boot order: the list lands and resolves
    // scopes before later plugins register) — the channel rebuilds their
    // bundles through the host hooks so every provider lands by first render.
    // 作用域可能已存在（启动顺序：列表落地并在后续插件注册前解析作用域）
    // ——通道经宿主钩子重建它们的捆绑，使每个提供者在首次渲染前落地。
    return this.provideChannel.provide(descriptor)
  }

  /**
   * Select a listed or retained catalog-addressed session as current.
   * @param id - listed or addressed session id.
   */
  /**
   * 把一个已列出或保留的目录寻址会话选为当前。
   * @param id 已列出或被寻址的会话 id。
   */
  open(id: SessionId): void {
    this.manager.select(id)
  }

  /**
   * Open a healthy catalog child through its direct-parent address.
   * @param address - catalog-derived parent and child ids.
   */
  /**
   * 通过其直接父地址打开一个健康的目录子会话。
   * @param address 目录派生的父与子 id。
   */
  openSubagent(address: SubagentAddress): void {
    this.manager.selectSubagent(address)
  }

  /**
   * Resolve an already discovered direct-parent address without opening it.
   * Feature plugins use this to avoid Agent-bound RPCs in persisted child views.
   * @param id - possible addressed child id.
   * @returns The retained address, when present.
   */
  /**
   * 解析一个已发现的直接父地址而不打开它。功能插件用它避免在持久子视图中
   * 发起 Agent 绑定的 RPC。
   * @param id 可能的被寻址子 id。
   * @returns 保留的地址（若有）。
   */
  subagentAddress(id: SessionId): SubagentAddress | undefined {
    return this.manager.subagentAddress(id)
  }

  /**
   * Inform the runtime whether a catalog menu is consuming membership updates.
   * @param parentSessionId - selected parent.
   * @param open - menu state.
   */
  /**
   * 告知运行时某个目录菜单是否在消费成员更新。
   * @param parentSessionId 选中的父。
   * @param open 菜单状态。
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void {
    this.manager.setSubagentCatalogOpen(parentSessionId, open)
  }

  /**
   * Refresh one direct-child catalog.
   * @param parentSessionId - catalog owner.
   */
  /**
   * 刷新一个直接子目录。
   * @param parentSessionId 目录属主。
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void> {
    return this.manager.refreshSubagents(parentSessionId)
  }

  /** 记录某会话现在运行的组合（agent preset 座位调用）。 */
  noteAgentPreset(sessionId: SessionId, agentPreset: string): void {
    this.manager.noteAgentPreset(sessionId, agentPreset)
  }

  /**
   * Clear the current selection so the layout shows the no-session empty
   * state (new-session affordance and the workspace preselection flow).
   * Wipes the persisted selection too — a reload stays on empty until the
   * user opens or starts a session. The staged scope keeps its frozen view
   * per the masked-gap contract until the next open() moves the stage.
   */
  /**
   * 清除当前选中，使布局显示"无会话"空状态（新建会话入口与工作区预选
   * 流程）。同时清除持久选中——重载保持空状态，直到用户打开或启动会话。
   * 按遮蔽间隙契约，舞台作用域保持其冻结视图，直到下次 open() 移动舞台。
   */
  clear(): void {
    this.manager.clearSelection()
  }

  /**
   * Refresh the real Session baseline, reusing an in-flight pull.
   * @returns completion of the current or newly started baseline pull.
   */
  /**
   * 刷新真实会话基线，复用进行中的拉取。
   * @returns 当前或新发起的基线拉取的完成信号。
   */
  refresh(): Promise<void> {
    return this.manager.refreshList()
  }

  /**
   * Search the Host's visible message-content index. Results stay
   * request-local; the list snapshot remains the metadata authority.
   * @param query - non-blank literal phrase.
   * @param signal - cancellation for a superseded search.
   * @returns bounded results or a business/transport error.
   */
  /**
   * 搜索 Host 可见的消息内容索引。结果保持在请求本地；列表快照仍是元数据
   * 权威。
   * @param query 非空白字面短语。
   * @param signal 用于取消被取代搜索的中止信号。
   * @returns 有界结果或业务/传输错误。
   */
  search(
    query: string,
    signal: AbortSignal,
  ): Promise<RpcResult<{ items: SessionSearchResultItem[]; hasMore: boolean }>> {
    return this.manager.search(query, signal)
  }

  /**
   * Route a mux stream envelope into the Session object layer.
   * @param envelope - validated mux stream envelope.
   */
  /**
   * 把 mux 流信封路由进会话对象层。
   * @param envelope 已验证的 mux 流信封。
   */
  handleMuxEnvelope(envelope: Parameters<SessionManager['handleMuxEnvelope']>[0]): void {
    this.manager.handleMuxEnvelope(envelope)
  }

  /**
   * Route a Host stream envelope into the Session object layer.
   * @param envelope - validated Host stream envelope.
   */
  /**
   * 把 Host 流信封路由进会话对象层。
   * @param envelope 已验证的 Host 流信封。
   */
  handleHostEnvelope(envelope: Parameters<SessionManager['handleHostEnvelope']>[0]): void {
    this.manager.handleHostEnvelope(envelope)
  }

  /** Rebuild the Session baseline and every opened window after connection. */
  /** 连接后重建会话基线与每个已打开的窗口。 */
  handleConnected(): void {
    this.manager.handleConnected()
  }

  /** Drop generation-scoped live interaction state the moment a connection generation dies. */
  /** 连接世代死亡瞬间丢弃世代作用域的实时交互状态。 */
  handleDisconnected(): void {
    this.manager.handleDisconnected()
  }

  /**
   * Create a session on the host. Resolution guarantee: by the time the
   * promise resolves, the created session is in the list store and
   * {@link SessionRuntime.binding} resolves it — callers (New Session
   * draft hand-off) may address the scope synchronously, without waiting a
   * notifier flush. The synchronous projection below makes this structural
   * rather than an accident of microtask ordering.
   * @param opts - target workspace or directory and an optional preallocated id.
   * @returns the new session id.
   * @throws {SessionCreateError} with the requested id.
   */
  /**
   * 在 Host 上创建会话。解析保证：promise 解析时新会话已在列表存储中，且
   * binding 可解析它——调用方（New Session 草稿交接）可同步寻址作用域，
   * 无需等通知冲刷。下方的同步投影使这成为结构性保证，而非微任务顺序的
   * 偶然。
   * @param opts 目标工作区或目录 + 可选预分配 id。
   * @returns 新会话 id。
   * @throws 携带请求 id 的 SessionCreateError。
   */
  async create(opts: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId } = {}): Promise<SessionId> {
    const result = await this.manager.create(opts)
    if (!result.ok) throw new SessionCreateError(result.error, opts.sessionId)
    this.projectList()
    return result.value.sessionId
  }

  /**
   * Fork a session from a completed-turn prefix of the source (same
   * synchronous-addressability guarantee as {@link SessionRuntime.create}:
   * on resolution the child is in the list store and open() can target it).
   * @param opts - source session id, the optional event seq anchoring the
   *   cut (the boundary is the first turn/end at or after it; an in-log
   *   anchor in an open turn is unavailable rather than clipped backward),
   *   and whether to increment an inherited durable title before resolving.
   *   A fractional anchor floors to a real event seq: the frozen nodes of an
   *   interrupted turn carry flow-ordering seqs between two events, and the
   *   wire takes integers only.
   * @returns the child session id.
   * @throws {SessionForkError} with the source id.
   * @throws {Error} when a requested child-title rename fails after creation.
   */
  /**
   * 从源会话的已完成轮次前缀 fork 出子会话（与 create 相同的同步可寻址
   * 保证：解析时子会话已在列表存储中，open() 可指向它）。
   * @param opts 源会话 id、可选的锚定切割的事件 seq（边界是该 seq 处或
   *   之后的第一个轮次结束；开放轮次中的日志内锚点不可用，不会向后裁剪）、
   *   以及解析前是否递增继承的持久标题。分数锚点向下取整为真实事件 seq：
   *   被中断轮次的冻结节点携带两个事件之间的流排序 seq，而线上只收整数。
   * @returns 子会话 id。
   * @throws 携带源 id 的 SessionForkError。
   * @throws 创建后请求的子会话标题重命名失败时抛出 Error。
   */
  async fork(opts: {
    sessionId: SessionId
    atSeq?: number
    increaseTitle?: boolean
  }): Promise<SessionId> {
    const sourceTitle = opts.increaseTitle
      ? this.list.getSnapshot().byId[opts.sessionId]?.title
      : undefined
    const result = await this.manager.fork({
      sessionId: opts.sessionId,
      // Flooring lands inside the anchor's own turn (every turn opens with a
      // turn/start), so the host's first-turn/end-at-or-after cut still ends
      // on that turn — never clipped back to the previous one.
      // 向下取整落在锚点自己的轮次内（每轮都以 turn/start 开启），因此
      // Host 的"该处或之后的首个轮次结束"切割仍结束于该轮——绝不回退到
      // 上一轮。
      ...(opts.atSeq === undefined ? {} : { atSeq: Math.floor(opts.atSeq) }),
    })
    if (!result.ok) throw new SessionForkError(result.error, opts.sessionId)
    this.projectList()
    const childId = result.value.sessionId
    if (sourceTitle !== undefined) {
      const child = this.binding(childId)?.session
      if (child === undefined) throw new Error(`fork child "${childId}" is not locally addressable`)
      const renamed = await child.rename(increasedForkTitle(sourceTitle))
      if (!renamed.ok) throw new Error(`fork child rename failed: ${renamed.error.code}: ${renamed.error.message}`)
    }
    return childId
  }

  /**
   * Resolve an Agent-scoped context view (use-and-discard).
   * @param id - session id (the agent identity — 1:1 same axis).
   * @returns scoped ctx, or undefined for a session neither listed nor already scoped.
   */
  /**
   * 解析一个 Agent 作用域化上下文视图（即用即弃）。
   * @param id 会话 id（即 agent 身份——1:1 同轴）。
   * @returns 作用域化 ctx；会话既未列出也未作用域化时为 undefined。
   */
  scope(id: SessionId): AgentContext | undefined {
    return this.resolve(id)?.ctx
  }

  /**
   * Read the Agent scope tag off a context. Service-method boundary: fetch
   * bundles must reach scope resolution through ctx.sessions — a cross-bundle
   * value import of the standalone helper would inline a second module
   * instance whose private tag Symbol never matches.
   * @param ctx - any client context.
   * @returns the session id, or undefined on root contexts.
   */
  /**
   * 从上下文读取 Agent 作用域标签。服务方法边界：fetch 捆绑必须经
   * ctx.sessions 到达作用域解析——跨捆绑值导入独立助手会内联第二个模块
   * 实例，其私有标签 Symbol 永不匹配。
   * @param ctx 任意客户端上下文。
   * @returns 会话 id，根上下文返回 undefined。
   */
  scopeOf(ctx: Context): SessionId | undefined {
    return scopeTagOf(ctx)
  }

  /**
   * Resolve the business Session behind an Agent-scoped context — the one
   * hop every scoped consumer (event listeners, per-session controllers)
   * takes from ctx-space into object-space (the client mirror of host
   * `agent.session`). Same service-method boundary as
   * {@link SessionRuntime.scopeOf}.
   * @param ctx - an Agent-scoped context.
   * @returns the session face, or undefined when the ctx is untagged or its scope was pruned.
   */
  /**
   * 解析 Agent 作用域化上下文背后的业务 Session——每个作用域消费方
   * （事件监听器、按会话控制器）从 ctx 空间进入对象空间的那一跳（Host
   * agent.session 的客户端镜像）。与 scopeOf 相同的服务方法边界。
   * @param ctx 一个 Agent 作用域化上下文。
   * @returns 会话面；ctx 未带标签或其作用域被裁剪时为 undefined。
   */
  sessionOf(ctx: Context): SessionFace | undefined {
    const id = scopeTagOf(ctx)
    if (id === undefined) return undefined
    return this.scopes.get(id)?.binding.session
  }

  /**
   * Resolve the stable session binding (scope-addressed assembly feed). Pure
   * resolution — no staging, no window side effects.
   * @param id - session id.
   * @returns binding, or undefined for a session neither listed nor already scoped.
   */
  /**
   * 解析稳定的会话绑定（作用域寻址的装配数据源）。纯解析——不上台、
   * 无窗口副作用。
   * @param id 会话 id。
   * @returns 绑定；会话既未列出也未作用域化时为 undefined。
   */
  binding(id: SessionId): SessionBinding | undefined {
    return this.resolve(id)?.binding
  }

  /**
   * Resolve one session's render-layer standard-props bundle (ctx never
   * enters the render layer; the renderer subscribes to
   * {@link SessionRuntime.currentProvideInfo}). Pure resolution — render-safe:
   * no staging, no window side effects (StrictMode double-invokes and
   * concurrent discarded passes must stay free).
   */
  /**
   * 解析一个会话的渲染层标准属性捆绑（ctx 从不进入渲染层；渲染器订阅
   * currentProvideInfo）。纯解析——渲染安全：不上台、无窗口副作用
   * （StrictMode 双调用与并发丢弃的 pass 必须保持自由）。
   */
  private provideInfo(id: string): SessionProvideInfo | undefined {
    return this.resolve(id as SessionId)?.provideInfo
  }

  /**
   * Resolve the current-session-optional standard kit. Unknown or absent ids
   * return the static no-session projection rather than removing hook props.
   */
  /**
   * 解析当前会话可选的标配套件。未知或缺失 id 返回静态无会话投影，而非
   * 移除钩子属性。
   */
  private maybeProvideInfo(id: string | undefined): SessionMaybeProvideInfo {
    return (id === undefined ? undefined : this.provideInfo(id)) ?? this.provideChannel.maybeInfo
  }

  /**
   * Move the stage to the list's current session: sweep teardowns deferred
   * behind the previous occupant and pull the new occupant's history window.
   * Staging IS the open signal — the window opens ⟺ the session is on stage
   * — and open() is idempotent (an in-flight or completed open no-ops; a
   * failed one retries the next time current is touched).
   */
  /**
   * 把舞台移到列表当前会话：清扫前一个占据者延迟的拆除，并拉取新占据者
   * 的历史窗口。上台即开窗信号——窗口打开 ⟺ 会话在舞台上——且 open()
   * 是幂等的（进行中或已完成的 open 空操作；失败的会在下次触碰 current
   * 时重试）。
   */
  private followCurrent(): void {
    const snapshot = this.list.getSnapshot()
    const current = snapshot.current
    // A masked gap (current blanked while the selection's session is
    // transiently absent) holds the stage: tearing down on the gap would
    // destroy exactly the frozen scope the mask exists to preserve.
    // 遮蔽间隙（选中会话瞬态缺失时 current 被清空）保持舞台：在间隙上
    // 拆除会破坏掩码恰恰要保留的冻结作用域。
    if (current === undefined || snapshot.byId[current] === undefined || current === this.watched) return
    this.watched = current
    this.sweepDeferred()
    const record = this.resolve(current)
    /* v8 ignore next 3 -- defensive: current is always a listed id (open()
     * validates and the projection masks absent selections), so resolve
     * cannot miss; kept so a future current writer cannot crash the notify. */
    if (record !== undefined) {
      void record.session.open()
      void this.manager.refreshSubagents(current)
    }
  }

  /**
   * Lazily mint the scope + binding for an eligible session. Eligibility and
   * prune share one predicate: listed on the host or selected
   * through a retained subagent address. Breadcrumb-only ancestors remain
   * summary data and do not keep scopes alive.
   */
  /**
   * 为符合条件的会话懒铸造作用域 + 绑定。资格与裁剪共享一个谓词：在 Host
   * 上列出，或经保留的子代理地址选中。仅面包屑的祖先保持概要数据，不
   * 维持作用域存活。
   */
  private resolve(id: SessionId): ScopeRecord | undefined {
    const existing = this.scopes.get(id)
    if (existing !== undefined) return existing
    if (!this.eligible(id)) return undefined
    const { fiber, ctx } = createScope(this.rootCtx, id)
    const session = this.manager.get(id)
    // The Session owns its scoped dispatch point (host Agent.loopCtx mirror);
    // mint and bind are one step so a live scope record implies a bound actx.
    // Session 拥有其作用域分发点（Host Agent.loopCtx 镜像）；铸造与绑定是
    // 一步，因此活跃作用域记录意味着 actx 已绑定。
    session.bindScope(ctx)
    const binding: SessionBinding = { sessionId: id, session, ctx }
    const record: ScopeRecord = {
      fiber,
      ctx,
      binding,
      session,
      // Sources are bare observables; React binds selector hooks at its own boundary.
      // 源是裸可观察对象；React 在自己的边界绑定选择器钩子。
      provideInfo: this.provideChannel.materializeInfo(binding),
    }
    this.scopes.set(id, record)
    return record
  }

  /** The one aliveness predicate shared by scope mint and prune: host-listed or currently addressed. */
  /** 作用域铸造与裁剪共享的唯一存活谓词：已列出或当前被寻址。 */
  private eligible(id: SessionId): boolean {
    const { ids, current } = this.list.getSnapshot()
    return current === id || ids.includes(id)
  }

  /** Project the manager's list snapshot into the store (title derivation is display-only). */
  /** 把管理器的列表快照投影进存储（标题推导仅用于展示）。 */
  private projectList(): void {
    const {
      items, current, phase, subagentsByParent, jobsBySession, currentAddress,
    } = this.manager.getListSnapshot()
    const ids: SessionId[] = []
    const byId: Record<SessionId, SessionSummary> = {}
    for (const entry of items) {
      ids.push(entry.sessionId)
      byId[entry.sessionId] = {
        id: entry.sessionId,
        displayTitle: displayTitleOf(entry.title, entry.cwd, entry.sessionId),
        running: entry.running,
        ...(entry.completed ? { completed: true } : {}),
        blank: entry.blank,
        updatedAt: entry.updatedAt,
        ...(entry.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: entry.pendingInteraction }),
        ...(entry.projectionValues === undefined
          ? {}
          : { projectionValues: entry.projectionValues }),
        ...(entry.title !== undefined ? { title: entry.title } : {}),
        ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}),
        ...(entry.parentSessionId !== undefined ? { parentId: entry.parentSessionId } : {}),
        ...(entry.origin !== undefined ? { origin: entry.origin } : {}),
        ...(entry.agentPreset !== undefined ? { agentPreset: entry.agentPreset } : {}),
      }
    }
    if (current !== undefined && currentAddress !== undefined) {
      const seen = new Set<SessionId>()
      let address: SubagentAddress | undefined = currentAddress
      while (address !== undefined && !seen.has(address.childSessionId)) {
        const childId = address.childSessionId
        seen.add(childId)
        const child = subagentsByParent[address.parentSessionId]?.entries
          .find(entry => entry.kind === 'child' && entry.id === childId)
        if (child?.kind !== 'child') break
        const displayTitle = child.label ?? childId
        const summary = byId[childId]
        if (summary === undefined) {
          byId[childId] = {
            id: childId,
            displayTitle,
            parentId: address.parentSessionId,
            origin: 'subagent',
            running: child.activity === 'running',
            blank: false,
            updatedAt: 0,
          }
        } else if (summary.displayTitle !== displayTitle) {
          byId[childId] = { ...summary, displayTitle }
        }
        const parent = byId[address.parentSessionId]
        if (parent !== undefined && parent.origin !== 'subagent') break
        address = this.manager.navigationAddress(address.parentSessionId)
      }
    }
    const persisted = this.selection.getSnapshot().sessionId
    // No current (cleared, or masked gap) wipes the persisted cell — a reload
    // stays on empty; the in-memory selection still resurfaces a masked id.
    // 无 current（清除或遮蔽间隙）会擦除持久单元——重载保持空；内存选中
    // 仍会让被遮蔽的 id 重新浮现。
    if (current === undefined) {
      if (persisted !== undefined) this.selection.set({})
    } else if (byId[current] !== undefined
      && (persisted !== current
        || this.selection.getSnapshot().subagentAddress?.childSessionId !== currentAddress?.childSessionId
        || this.selection.getSnapshot().subagentAddress?.parentSessionId !== currentAddress?.parentSessionId
        || this.selection.getSnapshot().subagentAddress?.mode !== currentAddress?.mode)) {
      this.selection.set({
        sessionId: current,
        ...(currentAddress === undefined ? {} : { subagentAddress: currentAddress }),
      })
    }
    this.list.set({ ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress })
    this.pruneScopes()
  }

  /** Tear down scope + instance for no-longer-eligible sessions off stage; the staged one defers until the stage moves. */
  /** 为不再符合条件且不在舞台上的会话拆除作用域 + 实例；舞台会话延迟到舞台移开。 */
  private pruneScopes(): void {
    for (const [id, record] of this.scopes) {
      if (this.eligible(id)) continue
      if (id === this.watched) {
        this.deferredRemovals.add(id)
        continue
      }
      this.scopes.delete(id)
      this.deferredRemovals.delete(id)
      this.dropScope(id, record)
    }
  }

  /**
   * One teardown for the whole per-session axis: the scope
   * fiber (cascading every actx-registered effect: input shell, slash
   * controller, popup, plugin stores, listeners), the session-keyed slot
   * stores, and the Session instance itself — the host session log is the
   * durable truth, a reopen lazily rebuilds and backfills via open().
   */
  /**
   * 整个按会话轴的一次拆除：作用域 fiber（级联每个 actx 注册的 effect：
   * 输入壳、斜杠控制器、弹窗、插件存储、监听器）、会话键控槽位存储，
   * 以及 Session 实例本身——Host 会话日志是持久真值，重新打开会经
   * open() 懒重建并回填。
   */
  private dropScope(id: SessionId, record: ScopeRecord): void {
    void record.fiber.dispose()
    // Release the Session's dispatch point with the scope it belongs to (a
    // surviving instance — the live Intent — rebinds when resolve re-mints).
    // 随作用域释放 Session 的分发点（存活的实例——实时 Intent——会在
    // resolve 重新铸造时重新绑定）。
    record.session.unbindScope()
    // Optional lookup: slots and sessions are sibling services with no
    // declared dependency; a slots-less boot (object-layer tests) skips.
    // 可选查找：slots 与 sessions 是兄弟服务，无声明依赖；无 slots 的启动
    // （对象层测试）跳过。
    this.rootCtx.get('slots')?.pruneStoreScope(id)
    this.manager.drop(id)
  }

  /** Run deferred teardowns whose session is no longer staged (called when the stage moves). */
  /** 运行其会话已不再上台的延迟拆除（舞台移动时调用）。 */
  private sweepDeferred(): void {
    for (const id of [...this.deferredRemovals]) {
      /* v8 ignore next -- defensive: only the staged id ever defers, and every
       * stage move sweeps first, so the set cannot contain the id the stage just
       * moved to; kept as a guard against future extra sweep call sites. */
      if (id === this.watched) continue
      // Eligible again? (A re-added id cancels the deferred teardown.)
      // 又符合条件了？（重新加入的 id 取消延迟拆除。）
      if (this.eligible(id)) {
        this.deferredRemovals.delete(id)
        continue
      }
      const record = this.scopes.get(id)
      this.deferredRemovals.delete(id)
      /* v8 ignore next -- defensive: prune deletes a scope and its deferral
       * together, so a deferred id always still owns its record; kept so a
       * future teardown path cannot double-dispose. */
      if (record !== undefined) {
        this.scopes.delete(id)
        this.dropScope(id, record)
      }
    }
  }
}
