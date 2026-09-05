/*
 * 【文件职责】把持久会话事件转换成 Chat 所需数据；
 * 可扩展类型中的未知值保留为不透明材料。
 */

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock, ContextProvenanceView, KnownContextForm,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/* jscpd:ignore-start -- Chat and Trajectory own independent event-to-view projections. */

/**
 * 功能说明：处理 asRecord 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Record<string, unknown> | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 asRecord(value)，并按返回类型处理结果。
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * 功能说明：读取 String 相关流程；使用场景由所在模块及调用位置决定。
 * @param record （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param key （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 readString(record, key)，并按返回类型处理结果。
 */
function readString(record: Record<string, unknown>, key: string): string | null {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 功能说明：收集 collect 相关流程；使用场景由所在模块及调用位置决定。
 * @param source （Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param member （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param field （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 collect(source, member, field)，并按返回类型处理结果。
 */
function collect(source: Record<string, unknown>, member: string, field: string): string[] {
  /**
   * 常量说明：list 用于列出 list 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const list = source[member]
  if (!Array.isArray(list)) return []
  /**
   * 常量说明：seen 用于处理 seen 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seen: string[] = []
  /**
   * 变量说明：entry 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const entry of list) {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const record = asRecord(entry)
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = record === null ? null : readString(record, field)
    if (value !== null && !seen.includes(value)) seen.push(value)
  }
  return seen
}

/**
 * 功能说明：处理 joined 相关流程；使用场景由所在模块及调用位置决定。
 * @param names （string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 joined(names)，并按返回类型处理结果。
 */
function joined(names: string[]): string | null {
  return names.length > 0 ? names.join(', ') : null
}

/** Forms Chat presents structurally; unknown merge-extensible values remain opaque.
 * @remarks 中文说明：常量说明：KNOWN_FORMS 用于处理 KNOWN_FORMS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
const KNOWN_FORMS: readonly KnownContextForm[] = [
  'instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall',
]

/**
 * Read the target-supported presentation form from a durable message source.
 * @param source - Logged `user/message` source.
 * @returns Supported form, or null for the opaque presentation.
 * @remarks 中文说明：功能说明：处理 contextForm 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：KnownContextForm
 * | null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * contextForm(source)，并按返回类型处理结果。
 */
export function contextForm(source: unknown): KnownContextForm | null {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = asRecord(source)
  /**
   * 常量说明：form 用于处理 form 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const form = record === null ? null : readString(record, 'form')
  return form !== null && (KNOWN_FORMS as readonly string[]).includes(form)
    ? form as KnownContextForm
    : null
}

/**
 * Project a durable message source to the Chat row's role and producer label.
 * @param source - Logged `user/message` source.
 * @returns Role and label rendered by Chat.
 * @remarks 中文说明：功能说明：处理 contextProvenance 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ContextProvenanceView；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * contextProvenance(source)，并按返回类型处理结果。
 */
export function contextProvenance(source: unknown): ContextProvenanceView {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = asRecord(source)
  /**
   * 常量说明：kind 用于处理 kind 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const kind = record === null ? null : readString(record, 'kind')
  if (record === null || kind === null) return { role: 'inject', label: null }
  switch (kind) {
    case 'session-reference':
      return { role: 'recall', label: joined(collect(record, 'references', 'label')) ?? kind }
    case 'agent-instructions':
      return { role: 'inject', label: joined(collect(record, 'changes', 'path')) ?? kind }
    case 'plugin':
      return { role: 'inject', label: readString(record, 'plugin') ?? kind }
    case 'skill-invocation':
      return { role: 'inject', label: readString(record, 'name') ?? kind }
    default:
      // MessageSourceMap is merge-extensible; keep an unknown producer
      // visible by its durable kind.
      return { role: 'inject', label: kind }
  }
}

/**
 * Read distinct labels cited by a durable cross-session recall source.
 * @param source - Logged `user/message` source.
 * @returns Labels in first-seen order.
 * @remarks 中文说明：功能说明：处理 sessionRecallLabels 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：source（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sessionRecallLabels(source)，并按返回类型处理结果。
 */
export function sessionRecallLabels(source: unknown): string[] {
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = asRecord(source)
  if (record === null || readString(record, 'kind') !== 'session-reference') return []
  return collect(record, 'references', 'label')
}

/**
 * Read the skill name a durable skill-invocation injection loaded.
 * @param source - Logged `user/message` source.
 * @returns The skill name, or null for every other source.
 */
export function skillInvocationName(source: unknown): string | null {
  const record = asRecord(source)
  if (record === null || readString(record, 'kind') !== 'skill-invocation') return null
  return readString(record, 'name')
}

/**
 * Classify finalized Assistant content for Chat rendering.
 * @param content - Core content blocks.
 * @returns Chat blocks in source order.
 * @remarks 中文说明：功能说明：处理 toAssistantBlocks 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：content（readonly ContentBlock[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：AssistantBlock[]；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * toAssistantBlocks(content)，并按返回类型处理结果。
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock)
}

/**
 * Classify one finalized Assistant block for Chat rendering.
 * @param block - Core content block.
 * @returns Chat block.
 * @remarks 中文说明：功能说明：处理 toAssistantBlock 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ContentBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：AssistantBlock；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * toAssistantBlock(block)，并按返回类型处理结果。
 */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

/**
 * Create the initial Chat block for one streamed Assistant block kind.
 * @param blockType - Wire block kind.
 * @returns Empty block ready to receive deltas.
 * @remarks 中文说明：功能说明：处理 emptyAssistantBlock 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：blockType（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：AssistantBlock；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * emptyAssistantBlock(blockType)，并按返回类型处理结果。
 */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
    default: return { kind: 'other', block: null }
  }
}

/** Display-safe failure fields retained by Chat projections. */
export interface DisplayFailure {
  readonly code?: string
  readonly message: string
}

/**
 * Convert a durable failure to locale-independent fields safe for Chat.
 * @param failure - Failure preserved by a Session event.
 * @returns Sanitized message and optional stable provider code.
 * @remarks 中文说明：功能说明：处理 displayFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：failure（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：DisplayFailure；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 displayFailure(failure)，
 * 并按返回类型处理结果。
 */
export function displayFailure(failure: unknown): DisplayFailure {
  if (failure === null || typeof failure !== 'object') return { message: String(failure) }
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = failure as { code?: unknown; message?: unknown }
  /**
   * 常量说明：code 用于处理 code 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const code = typeof record.code === 'string' ? record.code : undefined
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the Session log, but never retain it in UI state.
  if (code === 'AUTH') return { code, message: '' }
  return {
    ...(code === undefined ? {} : { code }),
    message: typeof record.message === 'string' ? record.message : JSON.stringify(failure),
  }
}

/**
 * Whether a stream chunk carries visible model output for Chat timing.
 * @param chunk - Stream chunk to inspect.
 * @returns true for a non-empty text, reasoning, or Tool-call delta.
 * @remarks 中文说明：功能说明：判断是否为 Token Delta 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：chunk（StreamChunk）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isTokenDelta(chunk)，
 * 并按返回类型处理结果。
 */
export function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/* jscpd:ignore-end */
