/*
 * ================================ 文件注释 ================================
 * 【文件职责】可持久化的子代理描述符：版本化、模型不可见的 subagent/descriptor 会话事件，
 *   标识每个有会话备份的子代理并记录其一次性/续聊模式；续聊描述符额外保存冷恢复所需的组成。
 * 【技术维度】显式快照字段而非整个 AgentOptions（避免不可 JSON 化的扩展值破坏续聊）；
 *   提供 snapshot（构造）/fold（从日志恢复）/parse（校验持久化载荷）三组操作。
 * 【产品维度】子代理列表（listChildren/listDescendants）与冷恢复都依赖描述符判断
 *   一个子代理是什么、能不能恢复，而不必重放父代理的工具结果。
 * 【逻辑维度】按代码顺序：事件声明合并 → 版本常量 → Data 接口族 → Input 接口族 →
 *   键集合常量与解析辅助 → snapshotSubagentDescriptor（重载）→ foldSubagentDescriptor。
 * 【关键边界】当前版本为 2，识别不了未知版本时 fold 返回 undefined（不抛错）；
 *   日志中第一条描述符事件权威，后到的同类型事件不会改写声明。
 * 【新手阅读建议】先看 Data 接口族（one-shot vs continuable），再读 snapshot 与 fold 两个入口。
 * ==========================================================================
 */

/**
 * The durable subagent-child descriptor: the versioned, model-hidden
 * `subagent/descriptor` session event that identifies every session-backed
 * subagent and records whether it is one-shot or continuable. Continuable
 * descriptors additionally preserve the declared composition required for
 * cold resume. Providers append it turn-enclosed in the child's initial turn.
 *
 * The descriptor deliberately snapshots explicit fields rather than the
 * merge-extensible `AgentOptions` object: an unrelated extension value cannot
 * make continuation fail merely because it is not JSON, and later composition
 * inputs require a deliberate {@link SUBAGENT_DESCRIPTOR_VERSION} change. It
 * omits `subagentDepth` — cold resume trusts the persisted header's
 * `delegationDepth` as the monotone floor — and `outputSchema`, which belongs
 * to one activation's result contract rather than durable child composition.
 * Per-activation knobs such as `maxTokens` are omitted for the same reason as
 * `outputSchema`: they budget one activation. Cold resume requires the exact
 * live parent for authorization but reconstructs child options only from the
 * durable descriptor, so it neither restores the prior budget nor inherits
 * the parent's current one; the resumed route's defaults apply instead.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor
 */

import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable identity and lifecycle mode of a session-backed subagent child,
     * appended once by the establishing provider inside the child's initial
     * turn, before its first request. Continuable records also carry their
     * resumable composition. Log-only: it carries no `surfaceOp`, never enters
     * model history, and survives compaction.
     */
    'subagent/descriptor': SubagentDescriptorData
  }
}

/**
 * The current descriptor format version, stamped into every appended
 * `subagent/descriptor` event and required verbatim by {@link foldSubagentDescriptor}.
 * Supporting another composition input is a deliberate version change, never
 * an implicit extra field.
 */
export const SUBAGENT_DESCRIPTOR_VERSION = 3

/** Fields shared by every supported `subagent/descriptor` payload. */
// 中文：所有描述符载荷共享的公共字段：版本、模式（one-shot/continuable）、建立它的提供者名。
interface SubagentDescriptorBase {
  /** Descriptor format version ({@link SUBAGENT_DESCRIPTOR_VERSION}). */
  readonly version: number
  /** Whether the child is a terminal one-shot run or a resumable conversation. */
  readonly mode: 'one-shot' | 'continuable'
  /** The `ctx.subagents` provider name that established the child. */
  readonly provider: string
}

/** A session-backed subagent that cannot be cold-resumed after its run. */
// 中文：一次性（one-shot）子代理的持久化描述符数据：运行结束即终结，不可冷恢复；
// label 是创建时的短描述，供枚举识别会话，可选。
export interface OneShotSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'one-shot'
  /**
   * The initial delegation's short `description`, kept as the child's durable
   * creation label so enumeration can identify the conversation without
   * replaying parent tool results or exposing the child prompt.
   */
  readonly label?: string
}

/** A session-backed subagent whose declared composition supports cold resume. */
// 中文：续聊（continuable）子代理的持久化描述符数据：额外记录冷恢复所需的组成
// （agentProvider/agentModel/persona/toolFilter），label 必填用于持久化枚举。
export interface ContinuableSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'continuable'
  /** The initial delegation's short `description`, used for durable enumeration. */
  readonly label: string
  /** Resolved child `agentOptions.provider`, when one was declared. */
  readonly agentProvider?: string
  /** Resolved child `agentOptions.model`, when one was declared. */
  readonly agentModel?: string
  /** Resolved child `agentOptions.reasoningEffort`, when one was declared. */
  readonly agentReasoningEffort?: ReasoningEffortId
  /** Per-child persona that shadows the deployment persona on resume. */
  readonly persona?: string
  /** Child tool scoping reapplied on resume. */
  readonly toolFilter?: ToolRestriction
}

/** The supported durable subagent identity and optional continuation composition. */
// 中文：描述符数据的最终联合：one-shot 或 continuable 二选一，是 subagent/descriptor
// 事件载荷的类型，也是 fold/snapshot 两侧共用的数据形状。
export type SubagentDescriptorData =
  | OneShotSubagentDescriptorData
  | ContinuableSubagentDescriptorData

/** Fields shared by descriptor snapshot inputs. */
// 中文：快照输入共享的公共字段：模式与将建立的提供者名（不带版本，版本由 snapshot 固定写入）。
interface SubagentDescriptorInputBase {
  /** Whether the child is a terminal one-shot run or a resumable conversation. */
  readonly mode: 'one-shot' | 'continuable'
  /** The `ctx.subagents` provider name that will establish the child. */
  readonly provider: string
}

/** Input for a one-shot child's durable identity. */
// 中文：一次性子代理的快照输入：mode 固定为 'one-shot'，label 可选。
export interface OneShotSubagentDescriptorInput extends SubagentDescriptorInputBase {
  readonly mode: 'one-shot'
  /** Optional initial delegation `description` used as the durable creation label. */
  readonly label?: string
}

/** Input for a continuable child's durable identity and resumable composition. */
// 中文：续聊子代理的快照输入：label 必填，agentProvider/agentModel/persona/toolFilter
// 是请求中声明的组成，cold resume 时据此重建。
export interface ContinuableSubagentDescriptorInput extends SubagentDescriptorInputBase {
  readonly mode: 'continuable'
  /** Initial delegation `description` used for durable enumeration. */
  readonly label: string
  /** Requested child `agentOptions.provider`. */
  readonly agentProvider?: string
  /** Requested child `agentOptions.model`. */
  readonly agentModel?: string
  /** Requested child `agentOptions.reasoningEffort`. */
  readonly agentReasoningEffort?: ReasoningEffortId
  /** Requested per-child persona. */
  readonly persona?: string
  /** Requested child tool scoping. */
  readonly toolFilter?: ToolRestriction
}

// 中文：snapshot 入口接受的输入联合（one-shot 或 continuable），
// 与输出 Data 联合保持一一对应。
/** Inputs {@link snapshotSubagentDescriptor} validates and detaches. */
export type SubagentDescriptorInput =
  | OneShotSubagentDescriptorInput
  | ContinuableSubagentDescriptorInput

// 中文：一次性描述符允许的字段键集合（公共 + label）。
const DESCRIPTOR_BASE_KEYS = [
  'version',
  'mode',
  'provider',
  'label',
] as const
const ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS)
const CONTINUABLE_DESCRIPTOR_KEYS = new Set([
  ...DESCRIPTOR_BASE_KEYS,
  'agentProvider',
  'agentModel',
  'agentReasoningEffort',
  'persona',
  'toolFilter',
])
const TOOL_FILTER_KEYS = new Set(['allow', 'deny'])

/** Whether a persisted JSON value is an object record. */
// 中文：判断持久化 JSON 值是否为"对象记录"（排除 null 与数组）。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 中文：拒绝记录里出现声明之外的多余字段（fail loud，未知字段即视为数据损坏）。
/** Reject fields outside one versioned record's declared schema. */
function assertKnownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) {
    throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`)
  }
}

/** Read one optional string field from a persisted descriptor record. */
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined
  const field = value[key]
  if (typeof field !== 'string') {
    throw new Error(`persisted subagent descriptor ${key} must be a string`)
  }
  return field
}

/** Read one optional string-array field from a persisted tool restriction. */
// 中文：读取持久化工具限制里的可选字符串数组字段，类型不符即报错。
function optionalStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
  if (!Object.hasOwn(value, key)) return undefined
  const field = value[key]
  if (!Array.isArray(field)) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`)
  }
  const items: unknown[] = field
  if (items.some(item => typeof item !== 'string')) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`)
  }
  return items as string[]
}

// 中文：校验并重建持久化的工具限制：必须是对象、只允许 allow/deny 键、至少声明其一。
/** Validate and reconstruct a persisted tool restriction. */
function parseToolFilter(value: unknown): ToolRestriction {
  if (!isRecord(value)) {
    throw new Error('persisted subagent descriptor toolFilter must be an object')
  }
  assertKnownKeys(value, TOOL_FILTER_KEYS, 'toolFilter')
  const allow = optionalStringArray(value, 'allow')
  const deny = optionalStringArray(value, 'deny')
  if (allow === undefined && deny === undefined) {
    throw new Error('persisted subagent descriptor toolFilter must declare allow and/or deny')
  }
  return {
    ...allow !== undefined ? { allow } : {},
    ...deny !== undefined ? { deny } : {},
  }
}

/** Validate one persisted descriptor payload for the current runtime. */
// 中文：解析一条持久化描述符载荷：版本不符返回 undefined（本运行时无法分类），
// 当前版本则按模式严格校验字段并重建数据对象；工具限制与可选字段逐一解析。
function parseSubagentDescriptor(value: unknown): SubagentDescriptorData | undefined {
  if (!isRecord(value)) {
    throw new Error('persisted subagent descriptor payload must be an object')
  }
  const version = value['version']
  if (typeof version !== 'number') {
    throw new Error('persisted subagent descriptor version must be a number')
  }
  if (version !== SUBAGENT_DESCRIPTOR_VERSION) return undefined

  const mode = value['mode']
  if (mode !== 'one-shot' && mode !== 'continuable') {
    throw new Error('persisted subagent descriptor mode must be "one-shot" or "continuable"')
  }
  assertKnownKeys(
    value,
    mode === 'one-shot' ? ONE_SHOT_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS,
    'payload',
  )
  const provider = value['provider']
  if (typeof provider !== 'string') {
    throw new Error('persisted subagent descriptor provider must be a string')
  }
  if (mode === 'one-shot') {
    const label = optionalString(value, 'label')
    return {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode,
      provider,
      ...label !== undefined ? { label } : {},
    }
  }
  const label = value['label']
  if (typeof label !== 'string') {
    throw new Error('persisted subagent descriptor label must be a string')
  }
  const agentProvider = optionalString(value, 'agentProvider')
  const agentModel = optionalString(value, 'agentModel')
  const agentReasoningEffort = optionalString(value, 'agentReasoningEffort') as ReasoningEffortId | undefined
  const persona = optionalString(value, 'persona')
  const toolFilter = Object.hasOwn(value, 'toolFilter')
    ? parseToolFilter(value['toolFilter'])
    : undefined
  return {
    version: SUBAGENT_DESCRIPTOR_VERSION,
    mode,
    provider,
    label,
    ...agentProvider !== undefined ? { agentProvider } : {},
    ...agentModel !== undefined ? { agentModel } : {},
    ...agentReasoningEffort !== undefined ? { agentReasoningEffort } : {},
    ...persona !== undefined ? { persona } : {},
    ...toolFilter !== undefined ? { toolFilter } : {},
  }
}

/**
 * Validate and detach descriptor inputs into the durable payload, before any
 * Task or provider work begins — the same detached lossless-JSON boundary the
 * session log itself enforces, applied early so a synchronous validation
 * failure rejects the tool call without creating a Task.
 * @param input - the caller-collected composition fields.
 * @returns the versioned, detached descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export function snapshotSubagentDescriptor(
  input: OneShotSubagentDescriptorInput,
): OneShotSubagentDescriptorData
/**
 * Validate and detach a continuable descriptor input.
 * @param input - the caller-collected continuable composition fields.
 * @returns the versioned, detached continuable descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export function snapshotSubagentDescriptor(
  input: ContinuableSubagentDescriptorInput,
): ContinuableSubagentDescriptorData
// 中文：把调用方收集的组成字段校验并"脱离"成可持久化的版本化载荷：经 snapshotJsonValue
// 无损 JSON 化，失败（含不可序列化值）在任何 Task 或子代理创建之前就抛错。
export function snapshotSubagentDescriptor(input: SubagentDescriptorInput): SubagentDescriptorData {
  const candidate: SubagentDescriptorData = input.mode === 'one-shot'
    ? {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: input.mode,
      provider: input.provider,
      ...input.label !== undefined ? { label: input.label } : {},
    }
    : {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: input.mode,
      provider: input.provider,
      label: input.label,
      ...input.agentProvider !== undefined ? { agentProvider: input.agentProvider } : {},
      ...input.agentModel !== undefined ? { agentModel: input.agentModel } : {},
      ...input.agentReasoningEffort !== undefined ? { agentReasoningEffort: input.agentReasoningEffort } : {},
      ...input.persona !== undefined ? { persona: input.persona } : {},
      ...input.toolFilter !== undefined ? { toolFilter: input.toolFilter } : {},
    }
  const snapshot = snapshotJsonValue(candidate)
  if (snapshot === undefined) {
    throw new Error('subagent descriptor is not losslessly JSON-serializable')
  }
  return snapshot
}

/**
 * Fold a persisted child log to its supported descriptor. The first
 * `subagent/descriptor` event is authoritative — the establishing provider
 * appends exactly one, so a later same-type event cannot rewrite the declared
 * composition.
 * @param events - the loaded child session events.
 * @returns the descriptor, or `undefined` when the log has none or its
 *   version is not {@link SUBAGENT_DESCRIPTOR_VERSION} (the child cannot be
 *   classified by this runtime).
 * @throws when a current-version persisted payload does not match its complete
 *   declared schema.
 */
// 中文：把子代理日志折叠成受支持的描述符：第一条 subagent/descriptor 事件权威（建立者
// 只追加一条）；没有或版本不受支持时返回 undefined（本运行时无法分类，不抛错）。
export function foldSubagentDescriptor(events: readonly SessionEvent[]): SubagentDescriptorData | undefined {
  const event = events.find(
    (candidate): candidate is SessionEvent<'subagent/descriptor'> => candidate.type === 'subagent/descriptor',
  )
  if (event === undefined) return undefined
  return parseSubagentDescriptor(event.data)
}
