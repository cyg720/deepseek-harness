import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/* oxlint-disable typescript/no-duplicate-type-constituents, typescript/no-redundant-type-constituents --
 * The unaugmented declaration-merge maps intentionally resolve to never in the Runtime program;
 * installed business packages supply their concrete keys in consuming Client programs. */
/* oxlint 禁用说明：未增强的声明合并 Map 在 Runtime 程序中故意解析为 never；
 * 安装的业务包在消费客户端程序中提供具体键。*/

/** Definition-local identity and lifecycle role extracted from one event. */
/* 从一个事件提取的定义本地身份与生命周期角色。 */
export interface ConversationMatchResult {
  readonly id: string
  readonly role: 'start' | 'update'
}

/** Merge-extensible business values published against one Turn. */
/* 针对一个轮次（Turn）发布的合并可扩展业务值。 */
export interface ConversationTurnDataMap {}

/** Merge-extensible business values published against one Step. */
/* 针对一个步骤（Step）发布的合并可扩展业务值。 */
export interface ConversationStepDataMap {}

/** Stable keyed reader for independently owned Location business values. */
/* 独立拥有的位置业务值的稳定按键读取器。 */
export interface ConversationLocationDataStore<DataMap extends object> {
  /**
   * Read one business value without exposing another owner's mutable State.
   * @param key - declaration-merged business key.
   * @returns latest immutable value, when its owning Context has published one.
   */
  /*
   * 读取一个业务值，不暴露其他属主的可变状态。
   * @param key 声明合并的业务键。
   * @returns 属主 Context 已发布时的最新不可变值。
   */
  get<Key extends keyof DataMap & string>(key: Key): Readonly<DataMap[Key]> | undefined
}

/** 位置数据值的内部载体：kind 判别 turn/step + 键 + 值。 */
interface ConversationLocationDataValue {
  readonly kind: 'turn' | 'step'
  readonly turn: number
  readonly step?: number
  readonly key: string
  readonly value: unknown
}

/** 已注册轮次数据的类型化载体（按 keyof 映射生成判别联合）。 */
type RegisteredTurnData = {
  [Key in keyof ConversationTurnDataMap & string]: {
    readonly kind: 'turn'
    readonly turn: number
    readonly key: Key
    readonly value: ConversationTurnDataMap[Key]
  }
}[keyof ConversationTurnDataMap & string]

/** 已注册步骤数据的类型化载体（按 keyof 映射生成判别联合）。 */
type RegisteredStepData = {
  [Key in keyof ConversationStepDataMap & string]: {
    readonly kind: 'step'
    readonly turn: number
    readonly step: number
    readonly key: Key
    readonly value: ConversationStepDataMap[Key]
  }
}[keyof ConversationStepDataMap & string]

/** One Definition-owned value attached to an Engine-owned Turn or Step. */
/*
 * 附着在引擎拥有的轮次或步骤上的、定义拥有的值。
 * 无注册键时退化为通用载体，有注册键时是类型化的判别联合。
 */
export type ConversationLocationData =
  [keyof ConversationTurnDataMap | keyof ConversationStepDataMap] extends [never]
    ? ConversationLocationDataValue
    : RegisteredTurnData | RegisteredStepData

/** Immutable resolved boundary for one Agent step. */
/* 单个 Agent 步骤的不可变已解析边界。 */
export interface StepLocation {
  readonly turn: number
  readonly step: number
  readonly start: SessionEvent<'step/start'> | undefined
  readonly end: SessionEvent<'step/end'> | undefined
  readonly status: 'open' | 'closed' | 'unknown'
  /** Stable reader for Step-scoped business values. */
  /* 步骤作用域业务值的稳定读取器。 */
  readonly data: ConversationLocationDataStore<ConversationStepDataMap>
}

/** Immutable resolved boundary for one Agent turn. */
/* 单个 Agent 轮次的不可变已解析边界。 */
export interface TurnLocation {
  readonly turn: number
  readonly start: SessionEvent<'turn/start'> | undefined
  readonly end: SessionEvent<'turn/end'> | undefined
  readonly status: 'open' | 'closed' | 'unknown'
  readonly steps: readonly StepLocation[]
  /** Stable reader for Turn-scoped business values. */
  /* 轮次作用域业务值的稳定读取器。 */
  readonly data: ConversationLocationDataStore<ConversationTurnDataMap>
}

/** Engine-owned placement of one matched event in the Session hierarchy. */
/* 一个已匹配事件在会话层级中由引擎拥有的放置位置。 */
export type ConversationLocation =
  | { readonly kind: 'session' }
  | { readonly kind: 'turn'; readonly turn: TurnLocation }
  | { readonly kind: 'step'; readonly turn: TurnLocation; readonly step: StepLocation }
  | { readonly kind: 'unresolved' }

interface ConversationMatchOf<
  Event extends SessionEventLike,
  Role extends ConversationMatchResult['role'],
> {
  readonly event: Event
  readonly role: Role
  readonly location: ConversationLocation
}

/** One scalar event accepted as a Context's unique start. */
export type ConversationStartMatch = ConversationMatchOf<SessionEvent, 'start'>

/** One event accepted by a Definition, with its lifecycle role and resolved Location. */
export type ConversationMatch =
  | ConversationStartMatch
  | ConversationMatchOf<SessionEventLike, 'update'>

/** Target-neutral identity returned by a business Definition. */
/* 业务定义返回的目标中立身份。 */
export interface ConversationViewNode {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly target: string
  readonly data: unknown
}

/** Merge-extensible immutable snapshots published by registered view targets. */
/* 由已注册视图目标发布的合并可扩展不可变快照。 */
export interface ConversationViewSnapshotMap {}

/** Stable reader over the latest snapshot of every registered view target. */
/* 覆盖每个已注册视图目标最新快照的稳定读取器。 */
export interface ConversationViewSnapshotStore {
  /** @param target - registered view target. @returns its current snapshot. */
  /* @param target 已注册的视图目标。 @returns 其当前快照。 */
  get<Target extends Extract<keyof ConversationViewSnapshotMap, string>>(
    target: Target,
  ): ConversationViewSnapshotMap[Target] | undefined
}

/** Immutable public view of an assembled business Context. */
/* 一个已装配业务上下文的不可变公开视图。 */
export interface ConversationNodeContext<State = unknown> {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly matches: readonly ConversationMatch[]
  readonly start: ConversationStartMatch | undefined
  readonly state: State | undefined
  readonly current: ReadonlyMap<string, ConversationViewNode | null>
}

/** Read-only predecessor returned to a Definition's start function. */
/* 返回给定义 start 函数的只读前驱上下文。 */
export interface ConversationPreviousContext<State = unknown> {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly startSeq: number
  readonly state: Readonly<State>
  readonly matches: readonly ConversationMatch[]
}

/** Strictly-backward Context lookup available while a start is evaluated. */
/* start 求值期间可用的严格向后上下文查找。 */
export interface ConversationContextReader {
  /**
   * Find the active Context of `kind` with the greatest start seq below the
   * current start event.
   * @param kind - Definition kind to query.
   * @returns the nearest predecessor, or undefined when absent in the current window.
   */
  /*
   * 查找 kind 中"start seq 小于当前 start 事件且最大"的活跃上下文。
   * @param kind 要查询的定义类型。
   * @returns 最近的前驱；当前窗口内不存在时为 undefined。
   */
  previous<State>(kind: string): ConversationPreviousContext<State> | undefined
}

/** Requested cadence for materializing updated business State into view Nodes. */
/* 把更新的业务状态物化为视图节点时请求的节奏。 */
export type ConversationPublication = 'none' | 'animation-frame' | 'immediate'

/** Engine-owned Location data publication phase. */
/* 引擎拥有的位置数据发布阶段。 */
export type ConversationLocationDataScope = 'step' | 'turn'

/** One independently registered business Event-to-Node state machine. */
/* 一个独立注册的业务"事件 -> 节点"状态机。 */
export interface ConversationNodeDefinition<State = unknown> {
  readonly kind: string
  /** Sole view target owned by this Definition; omitted for state-only Contexts. */
  /* 本定义拥有的唯一视图目标；纯状态上下文省略该字段。 */
  readonly target?: string
  /**
   * Extract this Definition's stable business identity from one event.
   * @param event - standard or compact Client history event; no Context or history access is available.
   * @returns identity and lifecycle role, or null when unrelated.
   */
  match(event: SessionEventLike): ConversationMatchResult | null
  /**
   * Create State from the unique start Match.
   * @param context - complete evidence currently collected for the Context.
   * @param match - the start Match.
   * @param reader - strictly-backward read-only Context lookup.
   * @returns the State adopted by the engine.
   */
  /*
   * 从唯一的 start 匹配创建状态。
   * @param context 当前为该上下文收集的完整证据。
   * @param match start 匹配。
   * @param reader 严格向后的只读上下文查找。
   * @returns 引擎采用的状态。
   */
  start(
    context: ConversationNodeContext<State>,
    match: ConversationStartMatch,
    reader: ConversationContextReader,
  ): State
  /**
   * Apply one post-start update Match.
   * @param context - Context with its current State.
   * @param match - update Match in ascending log order.
   * @returns the State adopted by the engine.
   */
  /*
   * 应用一次 start 之后的更新匹配。
   * @param context 带当前状态的上下文。
   * @param match 按日志升序的更新匹配。
   * @returns 引擎采用的状态。
   */
  update(
    context: ConversationNodeContext<State> & { readonly state: State },
    match: ConversationMatch,
  ): State
  /**
   * Select publication cadence for one accepted Match.
   * @param match - accepted Match.
   * @returns requested cadence; omission defaults to immediate.
   */
  /*
   * 为一个已接受的匹配选择发布节奏。
   * @param match 已接受的匹配。
   * @returns 请求的节奏；省略时默认立即发布。
   */
  publication?(match: ConversationMatch): ConversationPublication
  /**
   * Publish this Definition's read-only business value for one Location phase.
   * The Engine evaluates every Definition first for Step and then for Turn,
   * owns replacement/removal, and rejects another Context trying to publish
   * the same Location key.
   * @param context - latest complete Context.
   * @param scope - Location hierarchy level currently being materialized.
   * @returns current Location value, or null while unavailable.
   */
  /*
   * 为某个位置阶段发布本定义的只读业务值。引擎先按 Step 后按 Turn 求值
   * 每个定义，拥有替换/移除权，并拒绝另一个上下文发布相同的位置键。
   * @param context 最新的完整上下文。
   * @param scope 当前正在物化的位置层级。
   * @returns 当前的位置值；不可用时为 null。
   */
  buildLocationData?(
    context: ConversationNodeContext<State>,
    scope: ConversationLocationDataScope,
  ): ConversationLocationData | null
  /**
   * Materialize one final Node for this Definition's declared view target.
   * @param context - latest complete Context.
   * @returns final Node, or null when this Context is not currently visible.
   */
  /*
   * 为本定义声明的视图目标物化一个最终节点。
   * @param context 最新的完整上下文。
   * @returns 最终节点；当前不可见时为 null。
   */
  buildViewNode?(context: ConversationNodeContext<State>): ConversationViewNode | null
}

/** Reference-stable Turn/Step facts published beside view Nodes. */
/* 与视图节点一同发布的引用稳定的轮次/步骤事实。 */
export interface ConversationTimelineSnapshot {
  readonly turnOrder: readonly number[]
  readonly turns: ReadonlyMap<number, TurnLocation>
}

/** Per-Session incremental builder for one view target. */
/* 每个会话一个、面向某个视图目标的增量构建器。 */
export interface ConversationViewBuilder<Node extends ConversationViewNode = ConversationViewNode, Snapshot = unknown> {
  readonly empty: Snapshot
  /**
   * Replace the low-frequency complete materialized Node set.
   * @param input - complete Nodes and current timeline.
   * @returns next view snapshot.
   */
  /*
   * 替换低频的完整物化节点集。
   * @param input 完整节点与当前时间线。
   * @returns 下一个视图快照。
   */
  replace(input: {
    readonly nodes: readonly Node[]
    readonly timeline: ConversationTimelineSnapshot
  }): Snapshot
  /**
   * Apply only Nodes whose materialized values changed in this transaction.
   * @param input - changed Nodes and current timeline.
   * @returns next view snapshot.
   */
  /*
   * 只应用本次事务中物化值发生变化的节点。
   * @param input 变化的节点与当前时间线。
   * @returns 下一个视图快照。
   */
  apply(input: {
    readonly upserts: readonly Node[]
    readonly timeline: ConversationTimelineSnapshot
  }): Snapshot
}

/** Registry contribution that creates one isolated view builder per Session. */
/* 每个会话创建一个隔离视图构建器的注册贡献。 */
export interface ConversationViewDefinition<Node extends ConversationViewNode = ConversationViewNode, Snapshot = unknown> {
  readonly target: string
  /** @returns a new Session-owned incremental builder. */
  /* @returns 一个新的会话属主增量构建器。 */
  create(): ConversationViewBuilder<Node, Snapshot>
  /**
   * Decide whether this target contributes visible Conversation activity.
   * @param snapshot - latest target-owned snapshot.
   * @returns whether the shell should treat this target as active.
   */
  isActive?(snapshot: Snapshot): boolean
}

/**
 * Build a stable collision-free key for one Definition-local business identity.
 * @param kind - Definition kind.
 * @param id - Definition-local business identity.
 * @returns engine-owned Context key.
 */
/*
 * 为一个定义本地业务身份构造稳定无碰撞的键。
 * @param kind 定义类型。
 * @param id 定义本地业务身份。
 * @returns 引擎拥有的上下文键。
 */
export function conversationContextKey(kind: string, id: string): string {
  return `${kind.length}:${kind}${id}`
}
