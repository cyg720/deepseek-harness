/**
 * Vocabulary for the spill storage Service Definition. Types only — the abstract service
 * lives in `./index.ts`, implementations in sibling packages
 * (`@deepseek-ai/dsh-spill-local` first).
 *
 * @module @deepseek-ai/dsh-spill/types
 */
/*
 * 文件职责：实现 types.ts 覆盖的大结果落盘行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的大结果落盘能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * Opaque model-facing handle for one spilled artifact. A local backend may use a
 * filesystem path; a remote or database backend may use a URI or key. Consumers
 * render it with {@link SpillRef.retrievalHint}, but do not parse it.
 */
/* 中文说明：type SpillLocator 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export type SpillLocator = Branded<'SpillLocator'>

/**
 * Brand a string as a {@link SpillLocator}.
 *
 * @param locator The backend-produced locator string to brand.
 * @returns The branded spill locator.
 */
/*
 * 中文说明：函数 SpillLocator 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param locator 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function SpillLocator(locator: string): SpillLocator {
  return locator as SpillLocator
}

/**
 * Save-time storage namespace for a spilled artifact. The session id lets a
 * backend group storage under the producing session, but the returned
 * {@link SpillLocator} is the model-facing handle. Forked sessions inherit
 * locators already present in the seeded log; those artifacts are not copied or
 * re-owned, and spills produced after the fork use the child session id.
 */
/* 中文说明：interface SpillOwner 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface SpillOwner {
  sessionId: SessionId
}

/**
 * Tool and call that produced one spilled artifact — recorded by the backend for a readable
 * filename and inspection. Not interpreted for access control; purely
 * descriptive.
 */
/* 中文说明：interface SpillSource 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface SpillSource {
  /** The tool whose result was spilled (e.g. `web_fetch`). */
  toolName: string
  /** The model-issued call id the result belongs to. */
  callId: ToolCallId
  /** A short human label for the artifact (e.g. `result`). */
  label: string
}

/** One request to persist text to a spill artifact. */
/* 中文说明：interface SaveTextSpill 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface SaveTextSpill {
  owner: SpillOwner
  source: SpillSource
  /**
   * A caller-suggested base name (e.g. `web_fetch.txt`). The backend sanitizes
   * it to a single safe path segment before use — it is a hint, never a path.
   */
  suggestedName: string
  /** The full text to persist (UTF-8). */
  content: string
}

/** A saved spill artifact: its locator, byte length, and backend-specific retrieval guidance. */
/* 中文说明：interface SpillRef 定义本模块所需的数据或行为，用于表达大结果落盘场景。 */
export interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
