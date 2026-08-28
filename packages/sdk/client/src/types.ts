/**
 * Types for the TypeScript SDK client: launch options, notification shapes,
 * and owned activity results.
 *
 * @module @deepseek-ai/dsh-sdk-client/types
 */
/*
 * 文件职责：实现 types.ts 覆盖的SDK 通信行为与生命周期。
 * 技术维度：使用 TypeScript、Cordis 插件、Vitest、事件日志或异步传输。
 * 产品维度：保障 Agent 的SDK 通信能力稳定、可追踪且可恢复。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：跨进程数据不可信；持久化状态必须可重放；异步资源必须完全释放。
 * 新手阅读建议：先看导出类型和辅助函数，再读主流程，最后关注错误、恢复和清理。
 */

import type { ContentBlock, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SdkPromptContentBlock } from '@deepseek-ai/dsh-sdk-protocol'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One server-to-client notification as received off the wire. */
/* 中文说明：interface HarnessNotification 定义本模块所需的数据或行为，用于表达SDK 通信场景。 */
export interface HarnessNotification {
  /** The JSON-RPC notification method name. */
  method: string
  /** The raw params object; see `HarnessSdkNotificationMap` for the shapes per method. */
  params: Record<string, unknown>
}

/** Predicate deciding whether a subscription receives a notification. */
/* 中文说明：type NotificationFilter 定义本模块所需的数据或行为，用于表达SDK 通信场景。 */
export type NotificationFilter = (notification: HarnessNotification) => boolean

/** Launch and timeout options for {@link HarnessClient}. */
/* 中文说明：interface HarnessClientOptions 定义本模块所需的数据或行为，用于表达SDK 通信场景。 */
export interface HarnessClientOptions {
  /** Absolute or caller-relative dsh CLI module; omitted resolves this package's same-version dependency. */
  dshBin?: string
  /** Named profile serving the SDK protocol (default `sdk`). */
  profile?: string
  /** Ordered per-launch profile patches; relative paths resolve before spawn. */
  patches?: string[]
  /** Explicit Harness home for this child; relative paths resolve before spawn. */
  dshHome?: string
  /** Working directory for the dsh process itself. */
  processCwd?: string
  /**
   * The complete child environment, read when {@link HarnessClient.start}
   * spawns. `undefined` reads the parent env at that time; passing an object
   * reads that object at spawn and replaces the parent environment entirely, so callers own
   * credential policy (see `scrubbedParentEnv` in `@deepseek-ai/dsh-subprocess`
   * for the shared scrub-then-merge base).
   */
  env?: NodeJS.ProcessEnv
  /** Bound (ms) on the initial profile handshake (default 10000). */
  initializeTimeoutMs?: number
  /** Per-request timeout (ms); `undefined` waits indefinitely (a turn can legitimately run long). */
  requestTimeoutMs?: number
  /** Bound (ms) on the protocol `shutdown` exchange inside `close()` (default 1000). */
  shutdownTimeoutMs?: number
  /** Grace (ms) for the runtime's stdin-EOF quiesce during `close()` (default 6000). */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms) after SIGTERM/SIGKILL during `close()` (default 3000). */
  disposeGraceMs?: number
}

/** Options for the high-level {@link DeepSeekHarness} wrapper. */
export interface DeepSeekHarnessOptions extends HarnessClientOptions {
  /** Workspace cwd recorded on every SDK-created session (default: the process cwd, else `process.cwd()`). */
  cwd?: string
  /** Provider route for SDK-created agents (default `deepseek-official`). */
  provider?: string
  /** Model for SDK-created agents (default `deepseek-v4-flash`). */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}

/** One owned session activity interval, from enqueue receipt through idle. */
/* 中文说明：interface RunResult 定义本模块所需的数据或行为，用于表达SDK 通信场景。 */
export interface RunResult {
  /** The session the activity ran on. */
  sessionId: string
  /** Concatenated text of the interval's last assistant message (empty when none). */
  finalResponse: string
  /** Every `session.event` payload for the root session, in wire order. */
  events: SessionEvent[]
  /** Every notification for the root session and discovered descendants, in wire order. */
  notifications: HarnessNotification[]
}

/** Re-exported content-block alias so SDK callers need no extra import. */
export type { ContentBlock }
export type { SdkPromptContentBlock }
