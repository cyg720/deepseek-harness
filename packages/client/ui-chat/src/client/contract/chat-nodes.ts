/**
 * ================================ 文件注释 ================================
 * 【文件职责】最终聊天节点（ChatNode）的类型体系：按渲染器 kind 的可合并载荷注册表
 *             （ChatNodeDataMap）+ 判别联合 + 各业务行载荷（assistant / tool / 压缩 /
 *             重试 / 回合尾），以及工具是否已定格的判定函数。
 * 【技术维度】纯类型 + 两个类型守卫；ChatNodeDataMap 是"可合并扩充"的注册表，业务模块
 *             通过声明合并加入新的 kind 与载荷。
 * 【产品维度】渲染器按 kind 分发节点；数据形状由各业务状态机定义。
 * 【逻辑维度】1) 载荷注册表与 kind；2) ChatNode 判别联合；3) 各行载荷接口；
 *             4) isSettledTool / isRunningTool 守卫。
 * 【关键边界】'kind' in block 是运行中 / 已定格工具块的判别依据。
 * 【新手阅读建议】先看 ChatNodeDataMap 如何被 conversation-nodes 扩充。
 * ==========================================================================
 */
import type {
  AssistantBlock, AssistantMessageNode, CommandNode, CompactionSummaryNode,
  ConversationLocation, ConversationViewNode, ModelRetryNode, RunningToolCall,
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Final Chat render unit produced by a Chat business Definition. */
export interface ChatConversationViewNode extends ConversationViewNode {
  readonly target: 'chat'
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly visibility: 'visible' | 'hidden'
}

/** Merge-extensible payload registry keyed by final Chat renderer kind. */
// 按最终聊天渲染器 kind 键控的可合并载荷注册表（业务模块经声明合并扩充）。
export interface ChatNodeDataMap {}

/** Renderer kinds contributed by the currently installed Chat business modules. */
// 当前已安装的聊天业务模块贡献的渲染器 kind。
export type ChatNodeKind = Extract<keyof ChatNodeDataMap, string>

/** Final Chat Node narrowed to one registered renderer kind and payload. */
// 窄化到某个已注册渲染器 kind 与载荷的最终聊天节点（判别联合）。
export type ChatNode<Kind extends ChatNodeKind = ChatNodeKind> = {
  [RegisteredKind in Kind]: ChatConversationViewNode & {
    readonly kind: RegisteredKind
    readonly data: ChatNodeDataMap[RegisteredKind]
  }
}[Kind]

/** Final Assistant row payload shared by streaming and settled states. */
export interface AssistantChatData {
  readonly status: 'running' | 'settled' | 'interrupted'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
  readonly time: number
  readonly usage?: unknown
  readonly finalNode?: AssistantMessageNode
}

/** Settled or interrupted Assistant payload with its durable presentation node. */
export type FinalAssistantChatData = AssistantChatData & {
  readonly finalNode: AssistantMessageNode
}

/** Root Tool row payload; the root lifecycle owns all recursive subcalls. */
export interface ToolChatData {
  readonly root: ToolCallBlock
}

/** One manual command and its correlated compaction transaction. */
export interface ManualCompactionChatData {
  readonly command: CommandNode
  readonly compaction: CompactionSummaryNode | null
}

/** One durable retry chain rendered as a single row. */
export interface RetryChatData {
  readonly attempts: readonly ModelRetryNode[]
  readonly current: ModelRetryNode
}

/** One provider/model route that contributed a billed request attempt. */
export interface TurnTokenUsageRoute {
  readonly provider: string
  readonly model: string
}

/** Exact provider-reported token accounting for every attempt in one completed Turn. */
export interface TurnTokenUsage {
  /** Sum of uncached prompt input across all attempts. */
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  /** Exact aggregate prompt plus output total across all attempts. */
  readonly totalTokens: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheReadTokens?: number
  /** Present only when every attempt reported the bucket. */
  readonly cacheWriteTokens?: number
  /** Output subset, present only when every attempt reported it. */
  readonly reasoningTokens?: number
  /** Present only when every billed attempt has provider/model attribution. */
  readonly routes?: readonly TurnTokenUsageRoute[]
}

/** Turn-local footer row that owns actions and optional feature contributions. */
export interface TurnTailChatData {
  readonly turn: number
  readonly seq: number
  readonly time: number
  /** Last finalized content-bearing Assistant in this Turn. */
  readonly closing: FinalAssistantChatData | null
  /** Whether non-rendered later evidence makes the closing seq non-tail. */
  readonly branchUnavailable: boolean
  readonly ttftMs?: number
  readonly tokensPerSecond?: number
  /** Exact per-Turn accounting; absent when the loaded evidence is incomplete. */
  readonly tokenUsage?: TurnTokenUsage
}

/** Turn-level process disclosure projected before the finalized answer. */
export interface TurnProcessChatData {
  readonly turn: number
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  readonly messageCount: number
  readonly toolCallCount: number
  readonly subagentCount: number
}

/**
 * Test whether a Tool root has settled.
 * @param block - Tool root lifecycle value.
 * @returns whether the root carries its final result.
 */
export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * Test whether a Tool root is still running.
 * @param block - Tool root lifecycle value.
 * @returns whether the root lacks a final result.
 */
export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
