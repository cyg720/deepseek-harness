/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹目标的数据契约：各状态机产出的贡献（TrajectoryContribution）、视图节点
 *             信封（TrajectoryConversationViewNode）、面向视图的阶段快照（TrajectorySnapshot），
 *             以及请求头事实（TrajectoryRequestHeaderState）。
 * 【技术维度】纯类型文件（无运行时代码）；通过模块扩充把 'trajectory' 注册进
 *             ConversationViewSnapshotMap。
 * 【产品维度】把"会话事件流 → 轨迹视图"之间的所有数据结构固定成共享契约，供 Definition、
 *             快照构建器与视图组件三端引用。
 * 【逻辑维度】1) 请求头状态；2) 六类贡献的判别联合；3) 视图节点信封；4) 阶段快照；
 *             5) 视图快照映射的模块扩充。
 * 【关键边界】contribution 的 kind 是判别字段，快照构建器据此分派；任何结构变化都需
 *             同步更新构建器与视图。
 * 【新手阅读建议】先读 TrajectoryContribution 的六种分支，再读 TrajectorySnapshot 的字段。
 * ==========================================================================
 */
import type {
  AssistantMessageNode, ConversationLocation, ConversationNode, ConversationPromptSnapshot,
  ConversationViewNode, MessageImagesOwnerProps, PartialAssistant, RequestPromptChange,
  RequestView, RunningToolCall, ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Request-header facts retained by the Trajectory target. */
// 轨迹目标保留的"请求头"事实：请求的系统提示词快照、可选变更、位置与时间。
export interface TrajectoryRequestHeaderState {
  readonly seq: number
  readonly time: number
  readonly prompt: ConversationPromptSnapshot
  readonly change?: RequestPromptChange
  readonly location: ConversationLocation
}

/** One independently assembled contribution to the legacy Trajectory ledger. */
/*
 * 一条独立组装的轨迹贡献（判别联合）：node / assistant / tool / request-header /
 * compaction / session-end / turn-end 七种，kind 是判别字段。
 */
export type TrajectoryContribution =
  | {
    readonly kind: 'node'
    readonly node: ConversationNode
  }
  | {
    readonly kind: 'assistant'
    readonly node?: AssistantMessageNode
    readonly partial: PartialAssistant | null
    readonly request?: Extract<RequestView, { purpose: 'assistant' }>
  }
  | {
    readonly kind: 'tool'
    readonly root: ToolCallBlock
  }
  | {
    readonly kind: 'request-header'
    readonly header: TrajectoryRequestHeaderState
  }
  | {
    readonly kind: 'compaction'
    readonly request: Extract<RequestView, { purpose: 'compaction' }>
  }
  | {
    readonly kind: 'session-end'
    readonly seq: number
    readonly time: number
  }
  | {
    readonly kind: 'turn-end'
    readonly turn: number
    readonly time: number
    readonly error?: string
    readonly errorCode?: string
  }

/** Target envelope consumed by the Trajectory snapshot builder. */
export interface TrajectoryConversationViewNode extends ConversationViewNode {
  readonly target: 'trajectory'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: TrajectoryContribution
}

/** Stage-oriented Trajectory data assembled from registered business Contexts. */
export interface TrajectorySnapshot {
  readonly eventNodes: readonly ConversationNode[]
  readonly eventLocations: ReadonlyMap<number, ConversationLocation>
  readonly requests: readonly RequestView[]
  readonly callSchemas: ReadonlyMap<string, ConversationPromptSnapshot['tools'][number]>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

/** Selector hook over the current Conversation binding's Trajectory target. */
export type UseTrajectory = SnapshotSelectorHook<TrajectorySnapshot>

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the Trajectory view. */
    trajectory: TrajectorySnapshot
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's Trajectory target. */
    useTrajectory: UseTrajectory
  }

  interface SlotMap {
    /**
     * Renderer for one group of durable record images in the Trajectory
     * ledger. The owner supplies image references, an authorized loader, and
     * alignment. A registration replaces the shipped gallery; without one,
     * images are omitted.
     */
    'conversation.trajectory.images': { kind: 'single'; scope: 'session'; owner: MessageImagesOwnerProps }
  }
}
