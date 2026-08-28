/** Shared narrowing for raw Tool call and result fields consumed by card models.
 * @remarks 文件说明：文件职责：实现 client/ui-tool 中 raw tool call 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-tool 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'

/** A parsed, in-window Tool call whose arguments are a JSON object. */
export interface ParsedToolCall {
  name: string
  args: Record<string, unknown>
}

/**
 * 常量说明：parsedCalls 用于处理 parsedCalls 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const parsedCalls = new WeakMap<ToolCallBlock, ParsedToolCall | null>()

/**
 * Parse the call head paired with one immutable Tool block.
 * @param block - running or settled Tool block.
 * @returns the Tool name and object arguments, or null when the call head or valid JSON object is unavailable.
 * @remarks 中文说明：功能说明：处理 parsedToolCall 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolCallBlock）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ParsedToolCall | null；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * parsedToolCall(block)，并按返回类型处理结果。
 */
export function parsedToolCall(block: ToolCallBlock): ParsedToolCall | null {
  /**
   * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const cached = parsedCalls.get(block)
  if (cached !== undefined || parsedCalls.has(block)) return cached ?? null
  /**
   * 常量说明：call 用于处理 call 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const call = 'kind' in block ? block.call : block
  if (call === null) {
    parsedCalls.set(block, null)
    return null
  }
  /**
   * 变量说明：value 用于处理 value 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let value: unknown
  try {
    value = JSON.parse(call.argsRaw)
  } catch {
    parsedCalls.set(block, null)
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    parsedCalls.set(block, null)
    return null
  }
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = { name: call.name, args: value as Record<string, unknown> }
  parsedCalls.set(block, parsed)
  return parsed
}

/**
 * Read the exact single text block consumed by first-party card derivations.
 * @param block - settled Tool result.
 * @returns its text, or undefined for any other content layout.
 * @remarks 中文说明：功能说明：处理 singleResultText 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：block（ToolResultNode）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
 * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * singleResultText(block)，并按返回类型处理结果。
 */
export function singleResultText(block: ToolResultNode): string | undefined {
  if (block.content.length !== 1) return undefined
  /**
   * 常量说明：only 用于处理 only 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const only = block.content[0]
  return only?.type === 'text' ? only.text : undefined
}

/**
 * Validate the optional escalation pair shared by first-party shell and file
 * mutation tools.
 * @param args - parsed open-root Tool arguments.
 * @returns whether the declared escalation fields form a valid pair.
 * @remarks 中文说明：功能说明：处理 validEscalationFields 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：args（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * validEscalationFields(args)，并按返回类型处理结果。
 */
export function validEscalationFields(args: Record<string, unknown>): boolean {
  /**
   * 常量说明：permission 用于处理 permission 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const permission = args.sandbox_permissions
  /**
   * 常量说明：justification 用于处理 justification 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const justification = args.justification
  if (permission === undefined && justification === undefined) return true
  if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
  return typeof justification === 'string' && justification.trim() !== ''
}
