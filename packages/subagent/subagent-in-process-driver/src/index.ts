/**
 * Shared driver for in-process ONE-SHOT subagent providers. The agent factory's
 * creation transaction owns unpublished setup and rollback; after publication
 * the returned AgentHandle is the one quiescent lifecycle owner held by the
 * provider's caller.
 *
 * Continuable children never come through here: the continuation manager
 * composes and drives them directly, so this driver owns exactly one turn with
 * one result.
 *
 * @module @deepseek-ai/dsh-subagent-in-process-driver
 */
/*
 * 文件职责：实现 index.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  assertSubagentMaxDepth,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  finalAssistantOutput,
  resolveChildAgentOptions,
  resolveChildDepth,
} from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest,
  SubagentDescriptorData,
  SubagentResult,
  SubagentRun,
  SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import {
  attachStructuredRuntime,
  /** 中文说明：type StructuredAttachment 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type StructuredAttachment,
} from './structured.ts'

export {
  STRUCTURED_OUTPUT_TOOL,
  STRUCTURED_OUTPUT_INSTRUCTION,
} from './structured.ts'

/** Map a session turn outcome to the subagent seam's terminal vocabulary. */
/* 中文说明：函数 toStopReason 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function toStopReason(reason: TurnEndReason | undefined): SubagentStopReason {
  switch (reason?.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
      return 'aborted'
    // A pre-step rejection discarded the claimed prompt: the task was
    // declined, and the caller must not read the run as done.
    case 'blocked':
      return 'refusal'
    case 'error':
    case 'interrupted':
    default:
      return 'error'
  }
}

/** Extra inputs the spawn and fork providers supply to the shared driver. */
/* 中文说明：interface InProcessRunOptions 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface InProcessRunOptions {
  /** Completed-turn seed for fork, or undefined for a fresh spawn. */
  readonly seed?: SessionEvent[]
}

/** Error used when cancellation wins before the child publication boundary. */
/* 中文说明：函数 prePublicationAbort 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function prePublicationAbort(): Error {
  return new Error('subagent request was aborted before child publication')
}

/** Append one one-shot descriptor inside the child's initial turn before its first request. */
/* 中文说明：函数 attachDescriptorAppend 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function attachDescriptorAppend(childCtx: Context, descriptor: SubagentDescriptorData): void {
  /** 中文说明：变量 appended 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let appended = false
  childCtx.on('agent/pre-step', async ({ agent }, next) => {
    /** 中文说明：变量 decision 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const decision = await next()
    if (!appended && decision.kind === 'enter') {
      appended = true
      agent.session.append('subagent/descriptor', descriptor)
    }
    return decision
  })
}

/**
 * Establish and drive one in-process one-shot child. Fulfillment means the agent
 * is already published in the registry and transfers its turn, cancellation,
 * and disposal work through the returned run. Rejection means the agent
 * factory's unpublished creation transaction reached quiescence without
 * publishing a child. Every start appends its resolved descriptor inside the
 * child's initial turn.
 * @param request - the trusted typed start request, including its required signal.
 * @param options - the optional fork seed.
 * @returns a published holder-owned run.
 */
/*
 * 中文说明：函数 startInProcessRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param request 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function startInProcessRun(
  request: ResolvedSubagentStartRequest,
  options: InProcessRunOptions,
): Promise<SubagentRun> {
  assertSubagentMaxDepth(request.maxDepth)
  if (request.signal.aborted) throw prePublicationAbort()
  /** 中文说明：变量 parent 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const parent = request.parent
  /** 中文说明：变量 childDepth 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const childDepth = resolveChildDepth(parent, request.maxDepth)

  /** 中文说明：变量 childId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const childId = SessionId(randomUUID())
  /** 中文说明：变量 seed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const seed = options.seed
  /** 中文说明：变量 activationBoundary 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const activationBoundary = seed?.length ?? 0

  // Capture before the first await: a later parent switch belongs to the
  // parent's future.
  /** 中文说明：变量 inherited 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const inherited = captureDelegatedPolicyOverrides(parent)

  /** 中文说明：变量 structured 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  let structured: StructuredAttachment | undefined
  /** 中文说明：函数值 setup 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const setup = (childCtx: Context): void => {
    appendDelegatedPolicyOverrides((childCtx.agent as Agent).session, inherited)
    applyChildComposition(childCtx, parent, {
      persona: request.persona,
      toolFilter: request.toolFilter,
    })
    if (request.outputSchema !== undefined) {
      structured = attachStructuredRuntime(childCtx, request.outputSchema)
    }
    attachDescriptorAppend(childCtx, request.descriptor)
  }

  /** 中文说明：变量 handle 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const handle = await parent.ctx.agents.create({
    sessionId: childId,
    meta: childSessionMeta(parent, childDepth, activationBoundary),
    ...seed !== undefined ? { seed } : {},
    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
    signal: request.signal,
    setup,
  })
  return drivePublishedRun(
    handle,
    request.signal,
    request.prompt,
    childId,
    activationBoundary,
    structured,
  )
}

/**
 * Wrap a published child in the single run lifecycle that owns signal handoff,
 * one turn, result settlement, and quiescent disposal.
 */
/* 中文说明：函数 drivePublishedRun 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function drivePublishedRun(
  handle: AgentHandle,
  signal: AbortSignal,
  prompt: ContentBlock[],
  childId: SessionId,
  boundary: number,
  structured: StructuredAttachment | undefined,
): SubagentRun {
  /** 中文说明：变量 child 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const child = handle.agent
  /** 中文说明：变量 flags 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const flags = { cancelled: false }
  /** 中文说明：函数值 onAbort 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const onAbort = (): void => {
    flags.cancelled = true
    child.cancel({ kind: 'parent' })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  // Agent creation detaches its creation-only listener before returning. The
  // post-registration check closes that handoff without treating an already
  // published child as a failed start.
  if (signal.aborted) onAbort()

  /** 中文说明：函数值 result 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  const result: Promise<SubagentResult> = (async () => {
    try {
      if (!flags.cancelled) {
        child.followup(createUserMessage({ content: prompt, source: { kind: 'user' } }))
        await child.whenIdle()
      }
      return readResult(
        child,
        boundary,
        flags.cancelled,
        structured ? { captured: structured.captured() } : undefined,
      )
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  })()

  return {
    id: childId,
    localAgent: child,
    result,
    async dispose(): Promise<void> {
      signal.removeEventListener('abort', onAbort)
      flags.cancelled = true
      /** 中文说明：变量 settlements 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const settlements = await Promise.allSettled([handle.dispose(), result])
      /** 中文说明：变量 disposal 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const disposal = settlements[0]
      // The result channel owns run faults; disposal reports only failure to
      // release the published handle after both operations settle.
      if (disposal.status === 'rejected') throw disposal.reason
    },
  }
}

/** Read one settled child's result from events after its activation boundary. */
/* 中文说明：函数 readResult 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function readResult(
  child: Agent,
  boundary: number,
  cancelled: boolean,
  structured?: { captured?: { value: unknown } | undefined },
): SubagentResult {
  /** 中文说明：变量 own 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const own = child.session.events.slice(boundary)
  // `droppedUnrun` is deliberately unread: a one-shot prompt is claimed by its
  // awaited first turn almost immediately, and the owner's own teardown is the
  // `cancelled` flag below. A cancellation with no accounting turn resolves
  // `error` through `toStopReason(undefined)`, which never overstates success.
  /** 中文说明：变量 lastEnd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const lastEnd = foldConsumedWork(own).end
  // The seam's canonical selection rule; a partial answer survives cancel and truncation.
  /** 中文说明：变量 output 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const output: ContentBlock[] = finalAssistantOutput(own) ?? []
  /** 中文说明：变量 recorded 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const recorded = toStopReason(lastEnd?.data.reason)
  // Disposal can tear the owner down before the loop records its ordinary
  // `aborted` end, yielding `disposed` instead.
  /** 中文说明：变量 stopReason 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const stopReason: SubagentStopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded
  if (structured !== undefined) {
    if (structured.captured !== undefined) {
      return { output, structured: structured.captured.value, stopReason }
    }
    if (stopReason === 'completed') return { output, stopReason: cancelled ? 'aborted' : 'error' }
  }
  return { output, stopReason }
}
