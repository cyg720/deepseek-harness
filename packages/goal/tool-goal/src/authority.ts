/** Execution-time authority checks for the model-facing goal tools. */
/**
 * 文件职责：实现目标工具与投影的 authority.ts 模块。
 * 技术维度：TypeScript、Cordis、JSON 编解码、子进程、事件匹配和严格联合类型。
 * 产品维度：保证目标工具与投影可预测地传递事件、限制循环或适配外部工具。
 * 逻辑维度：解析配置，匹配事件，执行处理器并合并输出。
 * 关键边界：线协议输入必须校验；外部 Hook 失败不得破坏会话日志或核心循环。
 * 新手阅读建议：先读 types/events，再看 codec/matcher/runner，最后阅读桥接配置。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** 中文说明：类型或类 TurnStartEvent 约束 Hook、守卫或目标数据职责。 */
type TurnStartEvent = Extract<SessionEvent, { type: 'turn/start' }>

/** Current open turn plus the events accepted after its start boundary. */
/** 中文说明：类型或类 GoalToolExecution 约束 Hook、守卫或目标数据职责。 */
export interface GoalToolExecution {
  readonly agent: Agent
  readonly start: TurnStartEvent
  readonly events: readonly SessionEvent[]
}

/** Hard authority granted to one state-changing call. */
/** 中文说明：类型或类 GoalToolAuthority 约束 Hook、守卫或目标数据职责。 */
export type GoalToolAuthority =
  | { readonly kind: 'direct-human' }
  | { readonly kind: 'goal-round'; readonly goal: GoalView }

/** Throw one structured tool-policy failure. */
/** 中文说明：函数 reject 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function reject(message: string, code = 'GOAL_TOOL_AUTHORITY_REQUIRED'): never {
  throw new HarnessError(message, code)
}

/** Locate the open turn enclosing a model tool call. */
/** 中文说明：函数 openTurn 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function openTurn(agent: Agent): { start: TurnStartEvent; events: readonly SessionEvent[] } {
  /** 中文说明：协议局部值 events，由紧邻初始化决定。 */
  const events = agent.session.events
  /** 中文说明：协议局部值 index，由紧邻初始化决定。 */
  for (let index = events.length - 1; index >= 0; index -= 1) {
    /** 中文说明：协议局部值 boundary，由紧邻初始化决定。 */
    const boundary = events[index]
    if (boundary?.type === 'turn/end') {
      reject('goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED')
    }
    if (boundary?.type === 'turn/start') {
      return { start: boundary, events: events.slice(index + 1) }
    }
  }
  return reject('goal tools require an open model turn', 'GOAL_TOOL_DRIVER_REQUIRED')
}

/**
 * Resolve and authenticate the calling agent and its driver boundary.
 * @param ctx - Context carrying the live agent registry.
 * @param exec - Tool execution metadata supplied by the registry.
 * @returns The authenticated agent and its current turn window.
 */
/** 中文说明：函数 goalToolExecution 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function goalToolExecution(ctx: Context, exec: ToolRunContext): GoalToolExecution {
  /** 中文说明：协议局部值 agent，由紧邻初始化决定。 */
  const agent = exec.agent
  if (agent === undefined) {
    return reject('goal tools require a calling agent', 'GOAL_TOOL_AGENT_REQUIRED')
  }
  if (ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    return reject(
      'goal tools require the exact live calling agent inside its active driver',
      'GOAL_TOOL_DRIVER_REQUIRED',
    )
  }
  return { agent, ...openTurn(agent) }
}

/**
 * Whether host-attested human input appears in the current root-agent turn.
 * An omitted `Agent.followup()` / `steer()` source resolves to `user`, so non-human
 * producers must supply their own source rather than inheriting this authority.
 */
/** 中文说明：函数 hasDirectHumanInput 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hasDirectHumanInput(ctx: Context, execution: GoalToolExecution): boolean {
  if (!ctx.agents.roots().includes(execution.agent)) return false
  return execution.events.some(event =>
    event.type === 'user/message' && event.data.source.kind === 'user')
}

/** Whether this turn is the current goal's exact admitted round. */
/** 中文说明：函数 isMatchingGoalRound 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function isMatchingGoalRound(execution: GoalToolExecution, goal: GoalView): boolean {
  return execution.events.some(event => event.type === 'user/message'
    && event.data.source.kind === 'goal'
    && event.data.source.goalId === goal.id
    && event.data.source.revision === goal.revision
    && event.data.source.round === goal.roundsStarted)
}

/**
 * Require authority originating in a human message accepted by a runtime root.
 * @param ctx - Context carrying the live agent graph.
 * @param execution - Authenticated current tool execution.
 */
/** 中文说明：函数 requireDirectHuman 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function requireDirectHuman(ctx: Context, execution: GoalToolExecution): void {
  if (hasDirectHumanInput(ctx, execution)) return
  reject('this goal operation requires a direct human turn on a top-level agent')
}

/**
 * Resolve completion authority from either direct human input or the exact goal round.
 * @param ctx - Context carrying live agents and goal state.
 * @param execution - Authenticated current tool execution.
 * @returns The direct-human or exact-goal-round authority grant.
 */
/** 中文说明：函数 completionAuthority 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function completionAuthority(ctx: Context, execution: GoalToolExecution): GoalToolAuthority {
  if (hasDirectHumanInput(ctx, execution)) return { kind: 'direct-human' }
  /** 中文说明：协议局部值 goal，由紧邻初始化决定。 */
  const goal = ctx.goals.get(execution.agent)
  if (goal !== undefined && isMatchingGoalRound(execution, goal)) {
    return { kind: 'goal-round', goal }
  }
  return reject('complete and blocked require a direct human turn or the current goal round')
}
