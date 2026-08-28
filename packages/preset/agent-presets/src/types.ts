/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PresetTrust } from './preset.ts'

export type { PresetTrust } from './preset.ts'

/**
 * One roster row as a client reads it. Path-free: a preset is addressed by id
 * everywhere off the Host, and the composition's location is the Host's own.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** The roster one deployment currently supplies, with its authoring capability. */
export interface AgentPresetRoster {
  /** Every preset the configured roots supply, first-root-wins per id. */
  readonly presets: readonly AgentPresetRow[]
  /** Whether this deployment has a root locally authored presets go to. */
  readonly authorable: boolean
}

/** Stable details for agent-preset failures returned by the Remote namespace. */
export interface AgentPresetErrorDetailsMap {
  /** A required preset id is empty. */
  'bad-request': Record<never, never>
  /** No configured root supplies the requested id. */
  'agent-preset-not-found': { readonly agentPreset: string; readonly available: readonly string[] }
  /** The id is unusable, already taken, or its composition cannot be installed. */
  'agent-preset-invalid': { readonly agentPreset: string; readonly reason: string }
  /** The preset ships with the deployment and is not the user's to change. */
  'agent-preset-read-only': { readonly agentPreset: string; readonly reason: string }
  /** The session's conversation has started, so its composition is fixed. */
  'agent-preset-locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  /** The preset operation failed without a caller-actionable classification. */
  internal: Record<never, never>
}

/** One agent-preset refusal as a client reads it. */
export type AgentPresetError = {
  [Code in keyof AgentPresetErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: AgentPresetErrorDetailsMap[Code]
  }
}[keyof AgentPresetErrorDetailsMap]

/** One preset's composition text beside the row it belongs to. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** Trust of the root this preset was discovered under. */
  readonly trust: PresetTrust
  /** The composition exactly as stored. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentPreset: string | null
  }
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

// 类型扩充：把代理预设领域拥有的事件合并到 Cordis 的全局事件映射中。
declare module '@deepseek-ai/cordis' {
  // Events：Cordis 的事件名到监听函数签名的映射；这里只增加一个预设选择事件。
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    /*
     * 一个会话把新的代理预设提交到持久日志后发出此事件。
     * 消费方只应失效由该会话组合派生的状态。
     * @mode emit
     * @param sessionId - 发生组合变化的品牌化会话标识。
     * @param agentPreset - 已提交选择所记录的预设名称。
     * @returns 不返回值；该事件仅用于通知监听者。
     * @example ctx.emit('agent-preset/selected', sessionId, 'default')
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

// 空导出：确保模块扩充在模块作用域生效，不产生运行时代码。
export {}
