/**
 * The host⇄worker wire protocol: one string-valued enum of message tags per direction, a
 * payload map giving each tag its parameters (the single source of truth), and the message
 * unions derived from them. Payloads are plain JSON by construction for structured clone. Both
 * directions are closed engine protocols whose receivers use `assertNever`; generic typed senders
 * make tag/payload mismatches compile-time errors rather than silently skipped messages.
 * @module @deepseek-ai/dsh-workflow-worker-thread/protocol
 */
/*
 * 文件职责：实现 protocol.ts 覆盖的工作流与 Worker Thread行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、Worker Thread、消息协议或领域实体。
 * 产品维度：保障 Agent 的工作流与 Worker Thread能力稳定、可隔离且可诊断。
 * 逻辑维度：准备配置和消息，建立运行环境，执行流程，再处理事件、错误与清理。
 * 关键边界：线程消息不可信；跨线程状态必须显式传递；终止时必须等待所拥有资源停止。
 * 新手阅读建议：先看协议和类型，再读 Host/Runtime 主流程，最后关注隔离、失败与清理。
 */

import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowResult } from '@deepseek-ai/dsh-workflow'
import type { ChildResult, ChildStartRequest } from './types.ts'

/** Message tags the worker sends the host (the wire values are the tag strings). */
/* 中文说明：enum WorkerToHostType 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export enum WorkerToHostType {
  /** The startup handshake: the session is listening and awaits {@link HostToWorkerType.Go}. */
  Ready = 'ready',
  /** Observer narration: a `phase(title)` call. */
  Phase = 'phase',
  /** Observer narration: a `log(message)` call. */
  Log = 'log',
  /** Observer lifecycle: one `agent()` call started a child. */
  AgentStart = 'agent-start',
  /** Observer lifecycle: one `agent()` call settled. */
  AgentEnd = 'agent-end',
  /** Child RPC: start a child on the host (answered by ChildStarted or ChildStartError). */
  ChildStart = 'child-start',
  /** Child RPC: dispose a started child (answered by ChildDisposed). */
  ChildDispose = 'child-dispose',
  /** The run's single terminal result. */
  Result = 'result',
}

/** The payload each worker→host tag carries. */
/* 中文说明：interface WorkerToHostPayloads 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface WorkerToHostPayloads {
  /** Ready carries nothing. */
  [WorkerToHostType.Ready]: Record<never, never>
  /** The phase title, verbatim. */
  [WorkerToHostType.Phase]: { title: string }
  /** The logged message, verbatim. */
  [WorkerToHostType.Log]: { message: string }
  /** The call's sequence number, label, phase, and child id. */
  [WorkerToHostType.AgentStart]: { info: WorkflowAgentInfo }
  /** The call identity plus its outcome. */
  [WorkerToHostType.AgentEnd]: { info: WorkflowAgentEndInfo }
  /** The RPC correlation id and the prompt plus validated options. */
  [WorkerToHostType.ChildStart]: { callId: number; request: ChildStartRequest }
  /** The RPC correlation id of the child to dispose. */
  [WorkerToHostType.ChildDispose]: { callId: number }
  /** The run's terminal outcome. */
  [WorkerToHostType.Result]: { result: WorkflowResult }
}

/** Message tags the host sends the worker (the wire values are the tag strings). */
/* 中文说明：enum HostToWorkerType 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export enum HostToWorkerType {
  /** Releases the startup gate: run the script body. */
  Go = 'go',
  /** Cancel the run: hooks start throwing and the script dies at its next await. */
  Cancel = 'cancel',
  /** Child RPC reply: the provider fulfilled with a published run (exactly one start reply per ChildStart). */
  ChildStarted = 'child-started',
  /** Child RPC reply: the provider's asynchronous start failed. */
  ChildStartError = 'child-start-error',
  /** Child RPC: a started child's result RESOLVED (its JSON projection). */
  ChildSettled = 'child-settled',
  /** Child RPC: a started child's result REJECTED (an infrastructure fault, rendered). */
  ChildFailed = 'child-failed',
  /** Child RPC reply: a requested disposal completed. */
  ChildDisposed = 'child-disposed',
}

/** The payload each host→worker tag carries. */
/* 中文说明：interface HostToWorkerPayloads 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export interface HostToWorkerPayloads {
  /** Go carries nothing. */
  [HostToWorkerType.Go]: Record<never, never>
  /** The cancel reason, canonical for the whole run. */
  [HostToWorkerType.Cancel]: { reason: string }
  /** The RPC correlation id and the child agent's id (minted by the subagent seam). */
  [HostToWorkerType.ChildStarted]: { callId: number; childId: string }
  /** The RPC correlation id and the rendered start failure. */
  [HostToWorkerType.ChildStartError]: { callId: number; rendered: string }
  /** The RPC correlation id and the child's terminal result projection. */
  [HostToWorkerType.ChildSettled]: { callId: number; result: ChildResult }
  /** The RPC correlation id and the rendered infrastructure fault. */
  [HostToWorkerType.ChildFailed]: { callId: number; rendered: string }
  /** The RPC correlation id of the completed disposal. */
  [HostToWorkerType.ChildDisposed]: { callId: number }
}

/**
 * One worker→host message of tag `T`; unparameterized, the closed union over
 * every tag (a discriminated union — `switch` on `type` narrows).
 */
/* 中文说明：type WorkerToHostMessage 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export type WorkerToHostMessage<T extends WorkerToHostType = WorkerToHostType> =
  { [K in T]: { type: K } & WorkerToHostPayloads[K] }[T]

/**
 * One host→worker message of tag `T`; unparameterized, the closed union over
 * every tag (a discriminated union — `switch` on `type` narrows).
 */
/* 中文说明：type HostToWorkerMessage 定义本模块所需的数据或行为，用于表达工作流与 Worker Thread场景。 */
export type HostToWorkerMessage<T extends HostToWorkerType = HostToWorkerType> =
  { [K in T]: { type: K } & HostToWorkerPayloads[K] }[T]
