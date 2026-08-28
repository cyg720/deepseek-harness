/**
 * 文件职责：实现 client/ui-chat 中 snapshot 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type {
  ConversationNode, ConversationTimelineSnapshot, PartialAssistant, RunningToolCall,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from './chat-nodes.ts'

export type {
  AssistantBlock, AssistantMessageNode, AssistantProvenanceView, AssistantRequestConfig,
  AssistantTiming, CommandNode, CompactionSummaryNode, ContextMessageNode, ConversationNode,
  ModelRetryNode, PartialAssistant, RunningToolCall, SteeringMessageNode, TodoItem,
  ToolCallBlock, ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UnknownSurfaceNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
/** Stable live per-key reader for Chat nodes. */
export interface ChatNodeStore {
  /** @param key - stable Conversation Context key. @returns current Node, when visible or hidden.
   * @remarks 中文说明：功能说明：获取 get 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：key（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：ChatConversationViewNode | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 get(key)，并按返回类型处理结果。 */
  get(key: string): ChatConversationViewNode | undefined
  /** @returns all currently materialized Nodes without imposing render order.
   * @remarks 中文说明：功能说明：处理 values 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * ChatConversationViewNode[]；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 values()，并按返回类型处理结果。 */
  values(): readonly ChatConversationViewNode[]
}

/** One loaded Turn projected into the compact Chat navigation rail. */
export interface TurnNavigationItem {
  readonly turn: number
  /** Stable Conversation Context key the rail scrolls to. */
  readonly anchorKey: string
  /** Bounded prompt preview; empty when the loaded window starts mid-Turn. */
  readonly prompt: string
  /** Bounded assistant-response preview; empty until the Turn answers. */
  readonly response: string
}

/** Stable live navigation projection of the loaded Turns. */
export interface ChatTurnNavigationIndex {
  /**
   * Loaded Turns that have a visible anchor, in timeline order. The array
   * identity changes exactly when a Turn enters, leaves, or changes preview,
   * so a renderer can select it directly as its change signal.
   * @returns current navigation items.
   * @remarks 中文说明：功能说明：处理 items 相关流程；使用场景由所在模块及调用位置决定。；返回值：readonly
   * TurnNavigationItem[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * items()，并按返回类型处理结果。
   */
  items(): readonly TurnNavigationItem[]
}

/** Stable live Location index for Chat nodes. */
export interface ChatLocationNodeIndex {
  /** @param turn - owning turn. @returns ordered Chat Node keys in the turn.
   * @remarks 中文说明：功能说明：获取 Turn 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：readonly string[]；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getTurn(turn)，并按返回类型处理结果。 */
  getTurn(turn: number): readonly string[]
  /** @param turn - owning turn. @param step - owning step. @returns ordered Chat Node keys in the step.
   * @remarks 中文说明：功能说明：获取 Step 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：step（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：readonly string[]；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 getStep(turn, step)，
   * 并按返回类型处理结果。 */
  getStep(turn: number, step: number): readonly string[]
}

/** Compatibility projection backing StatsLine and the legacy top-level snapshot fields. */
export interface LegacyConversationSlice {
  readonly nodes: readonly ConversationNode[]
  readonly turnTimings: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  readonly turnEnds: ReadonlyMap<number, number>
  readonly partial: PartialAssistant | null
  readonly runningCalls: readonly RunningToolCall[]
}

/** Incremental Chat publication with immutable order and stable live keyed readers. */
export interface ChatSnapshot {
  readonly order: readonly string[]
  readonly nodes: ChatNodeStore
  readonly locations: ChatLocationNodeIndex
  readonly navigation: ChatTurnNavigationIndex
  readonly timeline: ConversationTimelineSnapshot
  readonly legacy: LegacyConversationSlice
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    chat: ChatSnapshot
  }
}

/**
 * 常量说明：EMPTY_LIST 用于处理 EMPTY_LIST 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EMPTY_LIST: readonly never[] = []
/**
 * 常量说明：EMPTY_TIMELINE 用于处理 EMPTY_TIMELINE 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EMPTY_TIMELINE: ConversationTimelineSnapshot = { turnOrder: EMPTY_LIST, turns: new Map() }

/** Empty Chat target used before a view builder is registered.
 * @remarks 中文说明：常量说明：EMPTY_CHAT_SNAPSHOT 用于处理 EMPTY_CHAT_SNAPSHOT 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
export const EMPTY_CHAT_SNAPSHOT: ChatSnapshot = {
  order: EMPTY_LIST,
  nodes: {
    get: () => undefined,
    values: () => EMPTY_LIST,
  },
  locations: {
    getTurn: () => EMPTY_LIST,
    getStep: () => EMPTY_LIST,
  },
  navigation: {
    items: () => EMPTY_LIST,
  },
  timeline: EMPTY_TIMELINE,
  legacy: {
    nodes: EMPTY_LIST,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: EMPTY_LIST,
  },
}
