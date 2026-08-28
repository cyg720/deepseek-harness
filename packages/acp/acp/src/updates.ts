/** Standard ACP updates derived from committed DSH session events.
 * @remarks 文件说明：文件职责：实现 acp/acp 中 updates 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 acp/acp 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'
import { assistantBlockToAcp } from './content.ts'

/**
 * Convert one committed assistant message and its context usage in block order.
 * @param ctx - bridge context carrying attachment and token-meter services.
 * @param session - durable session used for context pressure.
 * @param event - committed assistant message event.
 * @returns ordered standard thought, message, and optional usage updates.
 * @remarks 中文说明：功能说明：处理 assistantUpdates 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（SessionEvent<'assistant/message'>）：提供需要处理或投影的事件数据；
 * 必须满足声明的类型及调用时序要求。；返回值：Promise<SessionUpdate[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 assistantUpdates(ctx, session, event)，并按返回类型处理结果。
 */
export async function assistantUpdates(
  ctx: Context,
  session: Session,
  event: SessionEvent<'assistant/message'>,
): Promise<SessionUpdate[]> {
  /**
   * 常量说明：updates 用于处理 updates 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const updates: SessionUpdate[] = []
  for (const /*
   * 变量说明：block 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ block of event.data.message.content) {
    if (block.type === 'reasoning') {
      if (block.text.length > 0) {
        updates.push({
          sessionUpdate: 'agent_thought_chunk',
          messageId: event.data.message.id,
          content: { type: 'text', text: block.text },
        })
      }
      continue
    }
    /**
     * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const content = await assistantBlockToAcp(ctx, block)
    if (content !== undefined) {
      updates.push({
        sessionUpdate: 'agent_message_chunk',
        messageId: event.data.message.id,
        content,
      })
    }
  }
  /**
   * 常量说明：usage 用于处理 usage 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const usage = usageUpdate(ctx, session, event)
  if (usage !== undefined) updates.push(usage)
  return updates
}

/**
 * Start one generic ACP tool lifecycle from the durable call fact.
 * @param event - committed DSH tool-call event.
 * @returns the standard generic tool-call update.
 * @remarks 中文说明：功能说明：处理 toolCallUpdate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：event（SessionEvent<'tool/call'>）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionUpdate；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * toolCallUpdate(event)，并按返回类型处理结果。
 */
export function toolCallUpdate(event: SessionEvent<'tool/call'>): SessionUpdate {
  return {
    sessionUpdate: 'tool_call',
    toolCallId: event.data.callId,
    title: event.data.name,
    kind: 'other',
    status: 'in_progress',
    rawInput: parseToolArguments(event.data.arguments),
  }
}

/**
 * Finish one generic ACP tool lifecycle from its committed model-facing result.
 * @param ctx - bridge context carrying the attachment store.
 * @param event - committed DSH tool-result event.
 * @returns the standard completed or failed tool-call update.
 * @remarks 中文说明：功能说明：处理 toolResultUpdate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（SessionEvent<'tool/result'>）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 返回值：Promise<SessionUpdate>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 toolResultUpdate(ctx, event)，并按返回类型处理结果。
 */
export async function toolResultUpdate(
  ctx: Context,
  event: SessionEvent<'tool/result'>,
): Promise<SessionUpdate> {
  /**
   * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const result = event.data.message.content[0]
  /**
   * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const content: ToolCallContent[] = []
  for (const /*
   * 变量说明：block 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ block of result.content) {
    /**
     * 常量说明：converted 用于处理 converted 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const converted = await assistantBlockToAcp(ctx, block)
    if (converted !== undefined) content.push({ type: 'content' as const, content: converted })
  }
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: result.toolCallId,
    status: result.isError === true ? 'failed' : 'completed',
    content,
  }
}

/** Report current context occupancy only when DSH has both usage and capacity facts.
 * @remarks 中文说明：功能说明：处理 usageUpdate 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（SessionEvent<'assistant/message'>）：提供需要处理或投影的事件数据；
 * 必须满足声明的类型及调用时序要求。；返回值：SessionUpdate | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * ；使用示例：典型用法：在完成前置校验后调用 usageUpdate(ctx, session, event)，并按返回类型处理结果。 */
function usageUpdate(
  ctx: Context,
  session: Session,
  event: SessionEvent<'assistant/message'>,
): SessionUpdate | undefined {
  if (event.data.usage === undefined) return undefined
  /**
   * 常量说明：size 用于处理 size 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const size = session.requestContext()?.contextWindow
  /**
   * 常量说明：meter 用于处理 meter 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const meter = ctx.get('tokenMeter')
  if (size === undefined || meter === undefined) return undefined
  return {
    sessionUpdate: 'usage_update',
    used: meter.measure(session).totalTokens,
    size,
  }
}

/** Preserve malformed model output as opaque input instead of dropping the call update.
 * @remarks 中文说明：功能说明：解析 Tool Arguments 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：unknown；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 parseToolArguments(value)，并按返回类型处理结果。 */
function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (/*
 * 变量说明：_invalidModelJson 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ _invalidModelJson) {
    return value
  }
}
