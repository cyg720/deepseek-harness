/**
 * The in-process FORK subagent backend: registers a {@link SubagentProvider} on
 * `ctx.subagents` that runs each child as a child {@link Agent} SEEDED with a prefix of the
 * parent's session log — so the child inherits the parent's conversation context instead of
 * starting fresh. The seed ends at the last `turn/end`: the current tool-call turn is
 * unbalanced and cannot be replayed as a valid child session.
 * @module @deepseek-ai/dsh-subagent-fork-in-process
 */

/*
 * 【文件职责】创建继承父会话前缀的进程内 fork 子 Agent；
 * 种子截止最后一个 turn/end，避免复制尚未平衡的当前轮次。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  ContinuableCreateRequest,
  ContinuableCreateSpec,
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'

/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'subagent-fork-in-process'
// `tools` is deliberately NOT injected — same rationale as subagent-spawn-in-process: the
// per-run structured runtime gates its capture-tool registration on `tools`
// itself, so this backend's apply timing (and the delegation tool's position
// in the model-visible tool list) is unchanged by structured output.
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['subagents']

/** Config: the registry name to register the provider under. */
/* 中文说明：interface Config 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface Config {
  /** Provider name on `ctx.subagents` (default `fork`). */
  providerName: string
}

/** 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  providerName: z.string().default('fork'),
})

/**
 * The balanced completed-turn prefix of `parent`'s log: every event up to and including the
 * last `turn/end`. The in-flight turn is excluded; before any completed turn the child starts
 * fresh. Because live sequence numbers equal array indexes, the result remains a valid seed
 * beginning at sequence zero.
 * @param parent - the agent whose session log to slice.
 * @returns the seed events, contiguous from seq 0; empty when no turn has completed.
 */
/* 中文说明：函数 completedTurnPrefix 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function completedTurnPrefix(parent: Agent): SessionEvent[] {
  const events = parent.session.snapshotEvents()
  const lastEnd = events.findLast(e => e.type === 'turn/end')
  if (lastEnd === undefined) return []
  // seq === array index (the append contract), so slice up to and including it.
  return events.slice(0, lastEnd.seq + 1)
}

/**
 * The fork provider. Supports `depthLimit` and `outputSchema` (via the shared
 * in-process structured runtime), `agentOptions` (merged over the parent
 * route), and `toolFilter`/`persona` (scoped restrict() and a scoped shadowing
 * persona section).
 */
/* 中文说明：class ForkInProcessProvider 定义本模块所需的数据或行为，用于表达子代理场景。 */
class ForkInProcessProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = {
    agentOptions: true,
    outputSchema: true,
    depthLimit: true,
    toolFilter: true,
    persona: true,
  }
  // Context contract: a forked child IS seeded with the parent's completed-turn prefix.
  readonly inheritsParentContext = true

  constructor(readonly name: string) {}

  start(request: ResolvedSubagentStartRequest) {
    /** 中文说明：变量 seed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = completedTurnPrefix(request.parent)
    return startInProcessRun(request, {
      // Only pass a seed when there's a completed turn to inherit; an empty seed
      // is equivalent to a fresh child, so omit it to keep the session unseeded.
      ...seed.length > 0 ? { seed } : {},
    })
  }

  prepareContinuable(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec> {
    // The fork prefix is captured ONCE, at creation: it becomes part of the
    // child's own durable transcript, so a later cold resume replays that
    // prefix instead of re-forking the parent's newer history.
    /** 中文说明：变量 seed 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seed = completedTurnPrefix(request.parent)
    return Promise.resolve(seed.length > 0 ? { seed } : {})
  }
}

/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config): void {
  ctx.subagents.registerProvider(new ForkInProcessProvider(config.providerName))
}
