/**
 * The child-scoped `report` tool and its usage guidance, installed into every
 * continuable in-process child's unpublished context. Roots, one-shot children,
 * remote providers, and agentless executions never see the registration.
 *
 * @module @deepseek-ai/dsh-tool-subagent-report
 */
/**
 * 文件职责：实现 index.ts 覆盖的子代理工具行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程流、终端会话或快照规范化。
 * 产品维度：保障 Agent 的子代理工具能力稳定、可复现且可诊断。
 * 逻辑维度：准备输入和资源，执行核心流程，收集事件或输出，再处理错误与清理。
 * 关键边界：进程退出与取消可能竞态；外部输出不可信；清理必须等待子资源完全停止。
 * 新手阅读建议：先看类型和夹具，再读启动/收集主流程，最后关注平台差异、规范化和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentReportDelivery } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'tool-subagent-report'
// The contribution registers only through childCtx.tools and
// childCtx.systemPrompt, but declaring both services makes Loader ordering fail
// at load instead of at the next child materialization.
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['subagents', 'tools', 'systemPrompt']

/** Guidance order after every per-tool section a continuable child can carry. */
/** 中文说明：常量 REPORT_SECTION_ORDER 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const REPORT_SECTION_ORDER = 117

/** Config: how accepted reports are scheduled on the parent. */
/** 中文说明：interface Config 定义本模块所需的数据或行为，用于表达子代理工具场景。 */
export interface Config {
  /**
   * Parent scheduling (default `next-step`). `next-step` wakes the parent and
   * enters at its nearest step boundary; `quiet` adds the same context without
   * waking, so a parked parent waits for another waking input.
   */
  reportDelivery?: SubagentReportDelivery
}

/** 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  reportDelivery: z.union(['quiet', 'next-step'] as const).default('next-step'),
})

/**
 * Install `report` and its usage guidance into one continuable child's scope.
 * Both registrations are owned by that scope and are therefore invisible to the
 * child's parent and siblings.
 * @param childCtx - child-scoped context receiving the tool and the guidance.
 * @param ctx - service context used for delivery.
 * @param delivery - resolved deployment scheduling policy.
 * @returns disposer that attempts both child registrations before reporting cleanup failures.
 */
/** 中文说明：函数 installReportTool 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function installReportTool(
  childCtx: Context,
  ctx: Context,
  delivery: SubagentReportDelivery,
): () => void {
  /** 中文说明：变量 disposeSection 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const disposeSection = childCtx.systemPrompt.section({
    name: 'tool:report',
    order: REPORT_SECTION_ORDER,
    text: 'Deliver your result with the report tool before you finish: call it once with a self-contained '
      + 'answer. The agent that started you shares your workspace but does not automatically receive your '
      + 'transcript, tool output, or reasoning, so a closing remark such as "done" leaves it nothing it can '
      + 'use. Report earlier as well whenever a partial finding changes what that agent should do next; '
      + 'reporting never ends your turn.',
  })
  /** 中文说明：函数值 disposeTool 封装本模块的局部步骤；参数和返回值由右侧签名约束；示例见本模块调用。 */
  let disposeTool: () => void
  try {
    disposeTool = childCtx.tools.register(defineTool({
      name: 'report',
      description:
        'Report selected content to the agent that started you. Call this once before you finish, with a '
        + 'self-contained final result, and earlier for progress or findings that change what that agent does '
        + 'next. That agent shares your workspace but does not automatically receive your transcript, tool '
        + 'output, or reasoning, so finishing your work is not itself a result. Reporting does not end your '
        + 'turn or finish your work, and only your direct parent receives it. A failed call may still have '
        + 'arrived, so do not blindly repeat it.',
      parameters: {
        output: {
          type: 'string',
          required: true,
          description: 'Actionable content for your parent; summarize conclusions and reference relevant shared paths.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            messageId: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `report accepted by the agent that started you as message ${value.messageId}`,
        }],
      },
      async execute(args, exec) {
        /** 中文说明：变量 content 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const content: ContentBlock[] = [{ type: 'text', text: args.output }]
        // Scope-local resolution guarantees an Agent. The service still verifies
        // its exact live Activation identity at the authority boundary.
        /** 中文说明：变量 messageId 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const messageId = await ctx.subagents.reportFrom(exec.agent as Agent, content, {
          delivery,
          signal: exec.signal,
        })
        return { messageId }
      },
    }))
  } catch (error: unknown) {
    try {
      disposeSection()
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [error, rollbackError],
        'failed to register the report tool and roll back its prompt guidance',
      )
    }
    throw error
  }
  return () => {
    /** 中文说明：变量 failures 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failures: unknown[] = []
    /** 中文说明：该循环依次处理事件或输出；循环变量仅在当前循环中有效。 */
    for (const dispose of [disposeTool, disposeSection]) {
      try {
        dispose()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'failed to revoke report tool and prompt registrations')
    }
  }
}

/**
 * Register the continuable-child contribution.
 * @param ctx - context carrying tools, the system prompt, and the subagent service.
 * @param config - deployment scheduling policy.
 */
/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config = {}): void {
  // Config() applies the schema default at runtime; the schemastery return
  // type keeps the input's optional shape, so assert the resolved one.
  const { reportDelivery } = Config(config) as { reportDelivery: SubagentReportDelivery }
  ctx.subagents.registerContinuableSetup(childCtx =>
    installReportTool(childCtx, ctx, reportDelivery))
}
