/**
 * Versionless, structured-clone wire protocol between co-shipped host and worker code. The host
 * treats inbound traffic as hostile because model code can forge `parentPort` messages; the
 * worker trusts host replies.
 * @module @deepseek-ai/dsh-code-runtime-worker-thread/src/protocol
 */
/*
 * 文件职责：实现代码运行时的 protocol 模块。
 * 技术维度：TypeScript、Cordis 插件、Worker/JSON 协议和严格类型。
 * 产品维度：为产品提供代码运行时能力。
 * 逻辑维度：解析配置或协议，执行核心流程并返回结构化结果。
 * 关键边界：跨线程和模型输入属于不可信边界；资源与事件注册必须清理。
 * 新手阅读建议：先读导出类型与配置，再跟踪入口和错误分支。
 */

import type { WorkerJsonWire } from './worker-json.ts'

/** What the host hands the worker at spawn, via `workerData`. */
/* 中文说明：类型或类 WorkerBootData 约束协议数据或模块职责。 */
export interface WorkerBootData {
  /** The type-stripped (plain JS) program body. */
  code: string
  /** Binding namespaces to materialize; functions themselves stay host-side. */
  namespaces: {
    global: string
    names: string[]
    errorClass?: { name: string; memberNameProperty: string }
  }[]
  /** Hard cap for the combined serialized outer logs plus completion value or failure diagnostic. */
  maxOutputBytes: number
}

/** Worker → host: one bridged binding call. */
/* 中文说明：类型或类 CallMessage 约束协议数据或模块职责。 */
interface CallMessage {
  type: 'call'
  /** Worker-issued correlation id; the host answers each id at most once and ignores duplicates. */
  id: number
  /** The namespace global the call targets. */
  global: string
  /** The function name within the namespace. */
  name: string
  /** The single argument as a flat lossless-JSON wire value. */
  args: WorkerJsonWire
}

/** Worker → host: captured text, streamed eagerly so output survives a mid-run termination (timeout, abort, OOM). */
/* 中文说明：类型或类 LogMessage 约束协议数据或模块职责。 */
interface LogMessage {
  type: 'log'
  text: string
}

/** Worker → host: worker-side capture or completion measurement exceeded the outer cap. */
/* 中文说明：类型或类 OutputLimitMessage 约束协议数据或模块职责。 */
interface OutputLimitMessage {
  type: 'output-limit'
}

/**
 * Worker → host: the program settled. `error` carries a program exception,
 * invalid completion, or output overflow (budgets, aborts, and substrate death
 * are observed host-side). `value` is present only on a clean completion that
 * produced one, as a flat wire value already lossless and admitted against
 * the remaining combined output cap. Logs are NOT carried here — they streamed
 * eagerly as {@link LogMessage}s.
 */
/* 中文说明：类型或类 DoneMessage 约束协议数据或模块职责。 */
export interface DoneMessage {
  type: 'done'
  value?: WorkerJsonWire
  error?: { kind: 'exception' | 'invalid-output' | 'output-limit'; message: string }
}

/** Every message the worker sends. */
/* 中文说明：类型或类 WorkerToHost 约束协议数据或模块职责。 */
export type WorkerToHost = CallMessage | LogMessage | OutputLimitMessage | DoneMessage

/** Host → worker: the answer to one {@link CallMessage}. */
/* 中文说明：类型或类 ReplyMessage 约束协议数据或模块职责。 */
export type ReplyMessage =
  | { type: 'reply'; id: number; ok: true; value: WorkerJsonWire }
  | { type: 'reply'; id: number; ok: false; message: string }
