/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义消息的值类型（Message 及其角色特化）、消息来源（source）
 * 与上下文形态（ContextForm）词汇表，以及不可变消息的构造/冻结辅助函数。
 * 【技术维度】消息跨"交付、持久历史、模型请求"多个边界共享同一不可变表示；
 * source 是可扩展联合（插件可加 kind），ContextForm 是语义化词汇（描述内容
 * 是什么，而非怎么展示）；所有构造函数最终都走 deepFreeze(structuredClone)。
 * 【产品维度】消息是用户可见对话的最小单元：统一的不可变表示保证日志可回放、
 * 模型请求可重建；语义化的上下文形态让 UI 按内容类型展示而不侵入数据层。
 * 【逻辑维度】来源与出处类型 → 上下文形态与结构化字段 → 来源映射 → 消息
 * 主类型与角色特化 → 内部"新消息"输入类型 → 冻结/构造辅助 → token 增量判定。
 * 【关键边界】create* 系列生成的 id 用 crypto.randomUUID；消息一经创建即冻结，
 * 禁止任何原地修改；source.kind 决定"谁产生的"，form 决定"是什么类型的东西"。
 * 【新手阅读建议】先读 Message 接口与三种角色特化，再看 ContextForm 的英文
 * 注释理解"语义而非视觉"的设计原则，最后看构造辅助函数的调用链。
 * ==========================================================================
 */

/** Message value types, identity, and immutable construction helpers. */

import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { MessageId, type ToolCallId } from './brand.ts'
import { deepFreeze } from './call-config.ts'
import type { ContentBlock, ToolResultBlock } from './types.ts'

/** Provider/model identity and adapter-private replay data for an assistant message. */
/*
 * （中文）助手消息的出处：哪个 provider、哪个模型产出了它，以及适配器私有
 * 的、用于回放（replay）的无损 JSON 数据。
 */
export interface AssistantProvenance {
  /** Provider route that produced the message. */
  // 中文：产出该消息的 provider 路由。
  provider: string
  /** Provider model id that produced the message. */
  // 中文：产出该消息的 provider 模型 id。
  model: string
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  // 中文：回放 provider 响应所需的无损 JSON 适配器状态。LlmRuntime 只在"同一
  // 适配器实例同时拥有历史 provider 与目标 provider"时把它暴露给目标适配器。
  replayState?: unknown
}

/** Required source of an assistant message produced by a routed model. */
/*
 * （中文）由路由模型产生的助手消息的必填来源：kind 固定为 'model'。
 */
export interface ModelMessageSource extends AssistantProvenance {
  kind: 'model'
}

/** Required source of a user-role message carrying one tool result. */
/*
 * （中文）携带某次工具结果的 user 角色消息的必填来源：kind 为 'tool'，并带
 * 对应的 callId 用于关联。
 */
export interface ToolMessageSource {
  kind: 'tool'
  callId: ToolCallId
}

/*
 * （中文）生产者声明的上下文形态（form）：回答"这是什么类型的东西"。
 * source.kind 回答"谁产生的"；form 回答"它是哪种东西"，两个维度刻意独立——
 * 多个生产者可共享一种 form，一个生产者也可能在会话中发出多种 form。
 * 该词汇是"语义"而非"视觉"：值只声明内容是什么（文件指令、可用条目目录等），
 * 由消费方决定怎么展示（颜色、图标、排序、折叠与否都是消费方的事）。
 * 词汇随生产者获得其形态所需的结构化字段而逐个增长；缺失或未知的值视为
 * 文档化默认值（当作不透明内容展示）。
 */
/**
 * The kind of information in producer-supplied context, declared by the
 * producer beside its provenance.
 *
 * `MessageSource.kind` answers *who produced this*; `form` answers *what kind
 * of thing it is*, and the two axes are deliberately independent — several
 * producers share one form, and one producer may emit more than one form over
 * a session.
 *
 * The vocabulary is SEMANTIC, never visual: a value states that the content is
 * a file's instructions or a catalog of available items, and a consumer decides
 * what that looks like. Colors, icons, ordering, and collapse defaults are the
 * consumer's business and must not enter this union. It grows one value at a
 * time as producers gain the structured fields their form needs; an absent or
 * unknown value is the documented default, presented as opaque content.
 */
export type ContextForm =
  /** Instructions read out of workspace files the model is expected to follow. */
  // 中文：从工作区文件读出的、期望模型遵循的指令。
  | 'instructions'
  /** A catalog of items available in this session, republished as it changes. */
  // 中文：本会话可用条目的目录，随变化重新发布。
  | 'catalog'
  /** Current state, where a later snapshot from the same producer supersedes an earlier one. */
  // 中文：当前状态；同一生产者的后续快照会取代先前快照。
  | 'snapshot'
  /** A one-off account of something that just happened; it supersedes nothing. */
  // 中文：对刚发生之事的单次性记述；它不取代任何东西。
  | 'notice'
  /** A message another agent addressed to this one. */
  // 中文：另一个 agent 发给本 agent 的消息。
  | 'relay'
  /** Material lifted out of another session's log, possibly reduced on the way in. */
  // 中文：从其他会话日志中提取的材料，可能已在进入时做了精简。
  | 'recall'

/** One named contribution to a `snapshot`-form context, in assembly order. */
/*
 * （中文）snapshot 形态上下文中的一个具名贡献片段，按组装顺序排列。
 */
export interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  // 中文：贡献该片段的子系统名称。
  readonly name: string
  /** That contribution's model-facing text, exactly as assembled. */
  // 中文：该片段面向模型的文本，按组装后的原样。
  readonly text: string
}

/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
/*
 * （中文）生产者声明的 ContextForm 及其形态所要求的字段，混入携带它的来源
 * 类型。以 form 作判别字段：生产者选了某种 form 就必须带上展示它所需的字段
 * （notice 必须记录一行记述、snapshot 必须带 sections）；省略 form 仍然合法，
 * 未声明的上下文即文档化默认值。
 */
export type ContextFormed =
  | { readonly form?: never }
  | { readonly form: 'instructions' }
  | { readonly form: 'catalog' }
  | {
    readonly form: 'snapshot'
    /** The named contributions this snapshot assembled, in order. */
    // 中文：该快照组装的具名贡献，按顺序排列。
    readonly sections: readonly ContextSnapshotSection[]
  }
  | {
    readonly form: 'notice'
    /** One-line account of what happened, shown without expanding the row. */
    // 中文：对发生之事的一行记述，无需展开行即可展示。
    readonly summary: string
  }
  | { readonly form: 'relay' }
  | { readonly form: 'recall' }

/*
 * （中文）消息（或注入内容）的来源。可扩展联合——插件可以增加自己的 kind。
 */
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
export interface MessageSourceMap {
  // 中文：用户直接输入。
  user: { kind: 'user' }
  // 中文：插件注入的内容（可带上下文形态 form 字段）。
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  // 中文：模型产出（含出处与回放状态）。
  model: ModelMessageSource
  // 中文：工具结果（user 角色、带 callId）。
  tool: ToolMessageSource
}

/**
 * Bound for a `notice` summary. The account rides a collapsed transcript row
 * and is committed to the durable log, while its inputs — task labels, goal
 * objectives, tool arguments — are caller text with no length of their own.
 */
/*
 * （中文）notice 一行记述的长度上限：该记述会随折叠的转录行展示并写入持久
 * 日志，而其输入（任务标签、目标、工具参数）是调用方文本、本身没有长度限制。
 */
export const CONTEXT_SUMMARY_MAX_CHARS = 120

/*
 * （中文）把 notice 的一行记述裁剪到 CONTEXT_SUMMARY_MAX_CHARS 以内。
 * @param summary 生产者的一行记述，任意长度。
 * @returns 裁剪（超出部分以省略号结尾）后的记述。
 */
/**
 * Bound one `notice` summary to {@link CONTEXT_SUMMARY_MAX_CHARS}.
 * @param summary - the producer's one-line account, of any length.
 * @returns the account, ellipsized when it exceeds the bound.
 */
export function boundContextSummary(summary: string): string {
  return summary.length <= CONTEXT_SUMMARY_MAX_CHARS
    ? summary
    : `${summary.slice(0, CONTEXT_SUMMARY_MAX_CHARS - 1)}…`
}

/** Any known message source, derived from {@link MessageSourceMap}; switch on `kind` and fall through unknowns (merge-extensible). */
/*
 * （中文）所有已知消息来源的并集；按 kind 分支处理，未知 kind 要显式放行
 * （可扩展联合）。
 */
export type MessageSource = MessageSourceMap[keyof MessageSourceMap]

/** One immutable message representation shared by delivery, durable history, and model requests. */
/*
 * （中文）唯一的不可变消息表示，跨交付、持久历史、模型请求三个边界共享。
 */
export interface Message {
  /** Stable identity preserved across every representation boundary. */
  // 中文：稳定身份，跨所有表示边界保持不变。
  readonly id: MessageId
  /** Provider-neutral conversation role. */
  // 中文：provider 无关的会话角色。
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-facing blocks. */
  // 中文：面向模型的精确内容块列表。
  readonly content: ContentBlock[]
  /** Required source fields supplied by the producer. */
  // 中文：生产者提供的必填来源字段。
  readonly source: MessageSource
}

/** A user-role specialization of the one shared message representation. */
/*
 * （中文）user 角色特化：role 收窄为 'user'。
 */
export interface UserMessage extends Message {
  readonly role: 'user'
}

/** A model-produced assistant specialization of the shared message representation. */
/*
 * （中文）模型产出的助手消息特化：role 为 'assistant'，source 必须是模型来源。
 */
export interface AssistantMessage extends Message {
  readonly role: 'assistant'
  readonly source: ModelMessageSource
}

/** A tool-result specialization whose model-facing block retains call correlation. */
/*
 * （中文）工具结果特化：user 角色，content 固定为单个 tool-result 块，source
 * 带 callId 保持调用关联。
 */
export interface ToolResultMessage extends Message {
  readonly role: 'user'
  readonly content: [ToolResultBlock]
  readonly source: ToolMessageSource
}

// 中文：构造函数的输入类型——剔除 id（由构造时生成）等字段后的剩余部分。
type NewMessage = Omit<Message, 'id'>
type NewUserMessage = Omit<UserMessage, 'id' | 'role'>
type NewAssistantMessage = Omit<AssistantMessage, 'id' | 'role' | 'source'> & {
  readonly source: Omit<ModelMessageSource, 'kind'> & { readonly kind?: never }
}

/*
 * （中文）剥离并深冻结一条身份已存在的消息：保留其稳定身份，返回不可变快照。
 * @param message 完整消息（含稳定身份）。
 * @returns 保留身份的不可变快照。
 */
/**
 * Detach and deep-freeze a message whose identity already exists.
 * @param message - complete message, including its stable identity.
 * @returns an immutable snapshot that preserves the identity.
 */
export function freezeMessage<T extends Message>(message: T): T {
  return deepFreeze(structuredClone(message))
}

/*
 * （中文）创建一条带新身份的消息并在发布前冻结。
 * @param input 新消息的完整 role、content 与 source。
 * @returns 带全新稳定身份的不可变消息。
 */
/**
 * Create one identified message and freeze it before publication.
 * @param input - complete role, content, and source for a new message.
 * @returns an immutable message with a fresh stable identity.
 */
export function createMessage<T extends NewMessage>(
  input: T & { readonly id?: never },
): T & Pick<Message, 'id'> {
  return freezeMessage({
    ...input,
    id: MessageId(randomUUID()),
  })
}

/*
 * （中文）创建一条带新身份的 user 角色消息并冻结。
 * @param input 新用户消息的完整 content 与 source。
 * @returns 带全新稳定身份与固定 role 的不可变用户消息。
 */
/**
 * Create one identified user-role message and freeze it before publication.
 * @param input - complete content and source for a new user message.
 * @returns an immutable user message with a fresh stable identity.
 */
export function createUserMessage<T extends NewUserMessage>(
  input: T & { readonly id?: never; readonly role?: never },
): T & Pick<UserMessage, 'id' | 'role'> {
  return createMessage({
    ...input,
    role: 'user',
  })
}

/*
 * （中文）创建一条带新身份的助手消息并冻结：补上固定的 role 与 kind='model'
 * 来源标签。
 * @param input 完整内容以及新助手消息的 provider、model 与可选回放状态。
 * @returns 固定 role/source 标签、带全新稳定身份的不可变助手消息。
 */
/**
 * Create one identified model-produced assistant message and freeze it before publication.
 * @param input - complete content plus the provider, model, and optional replay state for a new assistant message.
 * @returns an immutable assistant message with fixed role/source tags and a fresh stable identity.
 */
export function createAssistantMessage(
  input: NewAssistantMessage & { readonly id?: never; readonly role?: never },
): AssistantMessage {
  return createMessage({
    role: 'assistant',
    content: input.content,
    source: {
      kind: 'model',
      ...input.source,
    },
  })
}

/** Input whose acceptance creates one tool-result message. */
/*
 * （中文）创建工具结果消息所需的输入：调用关联、结果块与成败标记。
 */
export interface ToolResultMessageInput {
  readonly callId: ToolCallId
  readonly content: ContentBlock[]
  readonly isError: boolean
}

/*
 * （中文）创建并冻结一条带新身份的工具结果消息（user 角色、单个 tool-result
 * 块、tool 来源）。
 * @param input 调用身份、原始结果块与结果成败。
 * @returns 不可变的 user 角色工具结果消息。
 */
/**
 * Create and freeze one identified tool-result message.
 * @param input - call identity, raw result blocks, and outcome.
 * @returns an immutable user-role tool-result message.
 */
export function createToolResultMessage(input: ToolResultMessageInput): ToolResultMessage {
  return createUserMessage({
    source: { kind: 'tool', callId: input.callId },
    content: [{
      type: 'tool-result',
      toolCallId: input.callId,
      content: input.content,
      isError: input.isError,
    }],
  })
}
