/**
 * ================================ 文件注释 ================================
 * 【文件职责】客户端 Cordis 运行时的装配入口：挂载插槽（slots）、会话
 *   （sessions）、工作区（workspaces）服务，并启动与 Host 的连接流。
 * 【技术维度】Cordis 插件 + 声明合并：本文件是浏览器运行时类型的唯一
 *   合并点（Typert 上下文、SessionStandardProps、Cordis Events/Context）；
 *   re-export 汇总运行时对外 API。
 * 【产品维度】桌面客户端启动时加载本插件，获得"插槽渲染 + 会话/工作区
 *   管理 + 连接流投递"的完整运行时能力。
 * 【逻辑维度】apply 依次：挂 SlotRegistry、构造会话/工作区服务、注册
 *   agent 上下文、启动连接循环（mux/host 信封分发、连接重置、重连清理）。
 * 【关键边界】只做装配与声明合并，不含业务实现；ctx.remote 使用网关的
 *   Client 半边（避免引入 Host 产物到客户端构建图）。
 * 【新手阅读建议】先看各 declare module 块理解类型合并，再看 apply。
 * ==========================================================================
 */
/** Browser runtime services for slots, sessions, workspaces, and connection-stream delivery. */
/** 浏览器运行时服务：插槽、会话、工作区与连接流投递。 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the ctx.remote merge. Deliberately the gateway's Client half rather
// than api-remotes': that face imports a Host-tsdown-generated artifact, and this
// project sits in the Host build graph.
// 仅类型：ctx.remote 的合并。刻意选择网关（gateway）的 Client 半边而非
// api-remotes 的：后者的面会导入 Host 用 tsdown 生成的产物，而本项目处于
// Host 构建图内。
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertContext } from '@deepseek-ai/dsh-typert-protocol'
import type { MaybeSnapshotSelectorHook, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from './slots.ts'
import { SessionRuntime } from './sessions/service.ts'
import type { SessionListState } from './sessions/service.ts'
import { WorkspaceRuntime } from './workspaces/service.ts'
import type { ConversationSnapshot } from './sessions/conversation.ts'
import type { UseProjection } from './sessions/projection-store.ts'
import { ConversationEventRegistry } from './conversation/event-registry.ts'
import { ConversationViewRegistry } from './conversation/view-registry.ts'

export { isAppendSurfaceEvent, isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

export { SlotRegistry } from './slots.ts'
export { ConversationEventRegistry } from './conversation/event-registry.ts'
export { ConversationViewRegistry } from './conversation/view-registry.ts'
export { ConversationNodeAssembler } from './sessions/conversation-assembler.ts'
export { ConversationLocationIndex } from './sessions/conversation-location-index.ts'
export { conversationContextKey } from './contract/conversation.ts'
export type {
  ChatConversationViewNode, ConversationContextReader, ConversationEventInput,
  ConversationLocationData, ConversationLocationDataScope, ConversationLocationDataStore,
  ConversationStepDataMap,
  ConversationLocation, ConversationMatch, ConversationMatchResult,
  ConversationNodeContext, ConversationNodeDefinition, ConversationPreviousContext,
  ConversationPublication, ConversationTimelineSnapshot, ConversationTurnDataMap, ConversationViewBuilder,
  ConversationViewDefinition, ConversationViewNode, ConversationViewSnapshotMap,
  ConversationViewSnapshotStore, StepLocation, TurnLocation,
} from './contract/conversation.ts'
export type { ConversationRuntime } from './sessions/conversation-assembler.ts'
export type { RootOwnerProps } from './slots.ts'
export { SessionCreateError, SessionRuntime, scopeOf, workspaceTitleOf } from './sessions/service.ts'
export { indexSubagentDescendants } from './sessions/subagent-lineage.ts'
export type { SubagentDescendantSummary } from './sessions/subagent-lineage.ts'
// The provide channel is shared with the client test runtime (one
// materialization/projection implementation; no test-side mirror to drift).
// provide 通道与客户端测试运行时共享（单一物化/投影实现；没有测试侧镜像
// 可供漂移）。
export { SessionProvideChannel } from './sessions/provide.ts'
export type { SessionProvideChannelHost } from './sessions/provide.ts'
export { createScope } from './agents/scope.ts'
export type { AgentScopeHandle } from './agents/scope.ts'
export { DirectoryBrowseError, WorkspaceCreateError, WorkspaceRuntime } from './workspaces/service.ts'
export { abbreviateHomePath, resolveWorkspacePath } from './workspaces/path.ts'
// Contract only: the scope implementation and its Host transport belong to
// dsh-client-ui-settings (see that package's settings-scope.ts).
// 仅契约：作用域实现与其 Host 传输属于 dsh-client-ui-settings
// （见该包的 settings-scope.ts）。
export type {
  SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec,
} from './contract/settings-scope.ts'
export type { Session } from './sessions/session.ts'
export type { ISession, ProjectionsFace, SessionFace } from './contract/session.ts'
export type { AgentContext, ISessions } from './contract/sessions.ts'
export type { IWorkspaces } from './contract/workspaces.ts'
export type {
  SessionBinding, SessionListState, SessionProvideContribution, SessionProvideDescriptor, SessionSummary,
} from './sessions/service.ts'
export type { SessionListPhase, SessionSearchResultItem, SubagentCatalogSnapshot } from './sessions/manager.ts'
export type { SubagentAddress, JobView } from '@deepseek-ai/dsh-client-connection/client'
export type { WorkspaceListPhase } from './workspaces/manager.ts'
export type { WorkspaceListState } from './workspaces/service.ts'
export type {
  DirectoryEntry, DirectoryListing, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-connection/client'
// Runtime owns the snapshot store; ui-renderer only binds it to React.
// 快照存储归运行时所有；ui-renderer 只把它绑定到 React。
export { createSnapshotStore, defineStore, shallowEqual } from './contract/store.ts'
export type {
  EngineStoreHandle, EngineStoreInstance, ObservableSnapshot, SnapshotStore,
} from './contract/store.ts'
export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, ChatLocationNodeIndex, ChatNodeStore, ChatSnapshot,
  CommandNode, CompactionSummaryNode, ComposerPhase,
  ContextMessageNode, ConversationNode, ConversationSnapshot, ModelRetryNode, QueuedMessage,
  LegacyConversationSlice, PartialAssistant, RunningToolCall,
  SteeringMessageNode, TodoItem, ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode,
  UnknownSurfaceNode, UserMessageNode,
} from './sessions/conversation.ts'
export {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, toAssistantBlock, toAssistantBlocks,
} from './sessions/conversation.ts'
export { emptyAssistantBlock } from './sessions/partial.ts'
export { isTokenDelta } from './sessions/assistant-timing.ts'
export { contextForm, contextProvenance, sessionRecallLabels } from './sessions/context-provenance.ts'
export { displayFailureMessage } from './sessions/failure-display.ts'
export type {
  ConversationContext, ConversationContextOriginKind,
} from './sessions/conversation-context.ts'
export type {
  ContextProvenanceView, ContextRole, KnownContextForm,
} from './sessions/context-provenance.ts'
export type {
  ConversationPromptSnapshot, RequestInspectionSnapshot, RequestPromptChange, RequestView,
} from './sessions/request-inspection.ts'
export { PendingWait } from './sessions/pending.ts'
export type {
  PendingInteraction, PendingInteractionStatus, PendingKind, PendingPayloads,
} from './sessions/pending.ts'
// Projection value store (push model; see the session-projection subsystem
// page, docs/subsystems/session-projection.md): host-computed
// whole values per key; domains ship projection support with zero client code.
// 投影值存储（推送模型；见 docs/subsystems/session-projection.md）：
// Host 按键计算完整值；域以零客户端代码交付投影支持。
export type {
  ProjectionsBaseline, ProjectionValueStore, SessionProjectionMap, UseProjection,
} from './sessions/projection-store.ts'
export type { SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Client-side Cordis context after declaration merging. */
/** 声明合并后的客户端 Cordis 上下文（即 Context 本身）。 */
export type ClientContext = Context

/** 声明合并：向 Typert 注册"agent"客户端上下文类型（身份即会话线上 id）。 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertContextMap {
    /** Client Agent scope identity; the agent and session share one wire id. */
    /** 客户端 Agent 作用域身份；agent 与会话共享一个线上 id。 */
    agent: TypertContext<SessionId>
  }
}

/** The conversation-snapshot selector hook supplied to session-scoped UI entries. */
/** 提供给会话作用域 UI 条目的会话快照选择器钩子。 */
export type UseConversationSession = SnapshotSelectorHook<ConversationSnapshot>

/** 声明合并：向 ui-slots 注入会话标准套件的真实成员（框架空座位由运行时填充）。 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /**
   * Session standard kit, real members (ui-slots declares the empty seat;
   * the runtime — where the subjects live — merges the concrete types):
   * every session-scope slot component receives these from the framework.
   */
  /**
   * 会话标准套件的真实成员（ui-slots 声明空座位；运行时——即主体所在处——
   * 合并具体类型）：每个会话作用域槽位组件都会从框架收到这些属性。
   */
  interface SessionStandardProps {
    useSession: SnapshotSelectorHook<ConversationSnapshot>
    /** The framework-resolved session id (owners never pass it). */
    /** 框架解析出的会话 id（属主从不自行传入）。 */
    sessionId: SessionId
    /** The fifth framework hook seat: key-addressed projection reader (undefined = capability absent). */
    /** 第五个框架钩子座位：按键寻址的投影读取器（undefined = 能力缺失）。 */
    useProjection: UseProjection
  }
  /** Standard kit for slots that remain mounted while current session changes. */
  /** 当前会话切换时仍保持挂载的槽位使用的标准套件。 */
  interface SessionMaybeStandardProps {
    useSession: MaybeSnapshotSelectorHook<ConversationSnapshot>
    /** Current session id; absent in the no-session state. */
    /** 当前会话 id；无会话状态下缺失。 */
    sessionId: SessionId | undefined
    /** Key-addressed projection reader; every key reads absent while no session is current. */
    /** 按键寻址的投影读取器；无当前会话时每个键都读作缺失。 */
    useProjection: UseProjection
  }
  /** Props injected into every global slot component. */
  /** 注入每个全局槽位组件的属性。 */
  interface GlobalStandardProps {
    useSessions: SnapshotSelectorHook<SessionListState>
    /** Selector hook over real Workspaces and their independent baseline lifecycle. */
    /** 覆盖真实工作区及其独立基线生命周期的选择器钩子。 */
    useWorkspaces: SnapshotSelectorHook<import('./workspaces/service.ts').WorkspaceListState>
  }
}

/** 声明合并：向 Cordis 注册运行时事件与上下文服务类型。 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A slot's definition or registration set changed.
     * @mode emit
     * @param key - the mutated SlotMap key.
     */
    /**
     * 某个槽位的定义或注册集合发生变化。
     * @mode emit
     * @param key 发生变化的 SlotMap 键。
     */
    'slots/changed'(key: string): void
    /**
     * A connection generation was (re-)established. Wire-derived caches must
     * treat their state as stale and repull (commands directory; the queue
     * mirrors reset themselves through the session resync path).
     * @mode emit
     */
    /**
     * 连接世代被（重新）建立。由 wire 推导的缓存必须把自身状态视为过期并
     * 重新拉取（命令目录；队列镜像通过会话重新同步路径自重置）。
     * @mode emit
     */
    'connection/reset'(): void
  }
  interface Context {
    slots: import('./slots.ts').SlotRegistry
    /** Event-to-business-Context Definition registry. */
    /** 事件到业务上下文的定义注册表。 */
    conversationEvents: import('./conversation/event-registry.ts').ConversationEventRegistry
    /** Per-target Conversation snapshot builder registry. */
    /** 按目标的会话快照构建器注册表。 */
    conversationViews: import('./conversation/view-registry.ts').ConversationViewRegistry
    /** The outward face only; the concrete service stays inside the runtime. */
    /** 仅对外面；具体服务留在运行时内部。 */
    sessions: import('./contract/sessions.ts').ISessions
    /** The outward face only; the concrete service stays inside the runtime. */
    /** 仅对外面；具体服务留在运行时内部。 */
    workspaces: import('./contract/workspaces.ts').IWorkspaces
  }
}

/** Required services: the wire handle and Client Typert registry. */
/** 必需服务：线上连接句柄与客户端 Typert 注册表。 */
export const inject = ['connection', 'typert', 'remote', 'remote.commands']

/** Mounts the browser runtime services and connection stream.
 * @param ctx - Client Cordis context.
 */
/**
 * 挂载浏览器运行时服务与连接流。
 * @param ctx 客户端 Cordis 上下文。
 */
export function apply(ctx: Context): void {
  ctx.plugin(SlotRegistry)
  const conversation = {
    events: new ConversationEventRegistry(ctx),
    views: new ConversationViewRegistry(ctx),
  }
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions = new SessionRuntime(ctx, connection.api, ctx.remote, conversation)
  ctx.typert.contexts.registerClient('agent', {
    identity: candidate => sessions.scopeOf(candidate),
  })
  const workspaces = new WorkspaceRuntime(ctx, connection.api, sessions)
  ctx.effect(
    () => workspaces.startInitialSelection(),
    'runtime: initial Workspace selection',
  )
  const loop = connection.start({
    onMuxEnvelope: (envelope) => {
      sessions.handleMuxEnvelope(envelope)
    },
    onHostEnvelope: (envelope) => {
      sessions.handleHostEnvelope(envelope)
      workspaces.handleHostEnvelope(envelope)
      // Forwarded-event bridge: the session layer ignores registry frames (no
      // session routing). This plugin owns the frame sink, so it hands the
      // decoded frame straight to the Remote service, which fans it out to
      // `ctx.remote.$on` subscribers; no consumer reads a frame.
      // 转发事件桥：会话层忽略注册表帧（无会话路由）。本插件拥有帧汇
      // （frame sink），因此把解码后的帧直接交给 Remote 服务，由它扇出
      // 给 ctx.remote.$on 的订阅者；没有任何消费方直接读帧。
      const frame = envelope.payload
      if (frame.type === 'host/remote-event') ctx.remote.$dispatch(frame.event, frame.args)
    },
    onConnected: () => {
      sessions.handleConnected()
      workspaces.handleConnected()
      ctx.emit('connection/reset')
    },
    onStateChange: (state) => {
      // Generation death fires before any next-generation frame can arrive
      // (reconnect replays flow from stream open, ahead of onConnected):
      // the only safe moment to drop generation-scoped interaction state.
      // 世代死亡在任何下一代帧到达前触发（重连重放从流打开即开始，早于
      // onConnected）：这是丢弃世代作用域交互状态的唯一安全时机。
      if (state === 'reconnecting') {
        sessions.handleDisconnected()
      }
    },
  })
  ctx.effect(() => () => { loop.stop() }, 'runtime: connection stream loop')
}
