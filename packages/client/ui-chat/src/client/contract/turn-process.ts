/**
 * 文件职责：实现 client/ui-chat 中 turn process 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import type { ChatNode } from './chat-nodes.ts'

/** Turn-local process window encoded as a reference-stable Location-data scalar. */
export type TurnProcessSignature = string

/** Stable identity of one finalized answer generation, independent of its exact ordering anchor. */
export type TurnProcessGeneration = string

/** Current process range and finalized answer boundary derived from one Turn. */
export interface TurnProcessSpec {
  readonly turn: number
  /** Stable control-node anchor source, including currently ineligible evidence. */
  readonly controlAnchorSeq: number
  readonly processStartSeq: number
  readonly answerAnchorSeq: number | null
  readonly answerStep: number | null
  readonly inlineReasoning: boolean
  /** Reply-bearing durable Assistant messages before the final answer. */
  readonly messageCount: number
  /** Durable non-subagent Tool calls recorded by this Turn. */
  readonly toolCallCount: number
  /** Tool calls whose configured name identifies a subagent delegation. */
  readonly subagentCount: number
}

/**
 * 常量说明：TURN_PROCESS_INDEPENDENT_KIND_LIST 用于处理
 * TURN_PROCESS_INDEPENDENT_KIND_LIST 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const TURN_PROCESS_INDEPENDENT_KIND_LIST = [
  'system-prompt',
  'user',
  'steering',
  'turn-process',
  'turn-error',
  'turn-max-tokens',
  'turn-tail',
] as const satisfies readonly ChatNode['kind'][]

/** Chat Node kinds that remain independent of a Turn's process disclosure.
 * @remarks 中文说明：常量说明：TURN_PROCESS_INDEPENDENT_KINDS 用于处理
 * TURN_PROCESS_INDEPENDENT_KINDS 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TURN_PROCESS_INDEPENDENT_KINDS: ReadonlySet<string> = new Set(
  TURN_PROCESS_INDEPENDENT_KIND_LIST,
)

/**
 * Identify one finalized answer generation without using its ordering anchor.
 * @param spec - current Turn process specification.
 * @returns stable identity until the finalized answer Step is withdrawn or replaced.
 * @remarks 中文说明：功能说明：处理 turnProcessGeneration 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：spec（TurnProcessSpec）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnProcessGeneration；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * turnProcessGeneration(spec)，并按返回类型处理结果。
 */
export function turnProcessGeneration(spec: TurnProcessSpec): TurnProcessGeneration {
  return `${String(spec.turn)}|${spec.answerStep === null ? '' : String(spec.answerStep)}`
}

/**
 * Encode one process specification as a primitive Location-data value.
 * @param spec - current Turn process specification.
 * @returns reference-stable scalar for equal specifications.
 * @remarks 中文说明：功能说明：编码 Turn Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：spec（TurnProcessSpec）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnProcessSignature；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * encodeTurnProcess(spec)，并按返回类型处理结果。
 */
export function encodeTurnProcess(spec: TurnProcessSpec): TurnProcessSignature {
  return [
    spec.turn,
    spec.controlAnchorSeq,
    spec.processStartSeq,
    spec.answerAnchorSeq ?? '',
    spec.answerStep ?? '',
    spec.inlineReasoning ? 1 : 0,
    spec.messageCount,
    spec.toolCallCount,
    spec.subagentCount,
  ].join('|')
}

/**
 * Decode a same-process signature produced by {@link encodeTurnProcess}.
 * @param signature - encoded Turn process value.
 * @returns decoded process specification.
 * @remarks 中文说明：功能说明：解码 Turn Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：signature（TurnProcessSignature）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnProcessSpec；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * decodeTurnProcess(signature)，并按返回类型处理结果。
 */
export function decodeTurnProcess(signature: TurnProcessSignature): TurnProcessSpec {
  /**
   * 常量说明：turn、controlAnchorSeq、processStartSeq、answerAnchorSeq、answerStep、in
   * lineReasoning、messageCount、toolCallCount、subagentCount 用于处理
   * turn、controlAnchorSeq、processStartSeq、answerAnchorSeq、answerStep、inlineR
   * easoning、messageCount、toolCallCount、subagentCount 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const [
    turn, controlAnchorSeq, processStartSeq, answerAnchorSeq, answerStep, inlineReasoning,
    messageCount, toolCallCount, subagentCount,
  ] = signature.split('|')
  return {
    turn: Number(turn),
    controlAnchorSeq: Number(controlAnchorSeq),
    processStartSeq: Number(processStartSeq),
    answerAnchorSeq: answerAnchorSeq === '' ? null : Number(answerAnchorSeq),
    answerStep: answerStep === '' ? null : Number(answerStep),
    inlineReasoning: inlineReasoning === '1',
    messageCount: Number(messageCount),
    toolCallCount: Number(toolCallCount),
    subagentCount: Number(subagentCount),
  }
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 * @remarks 中文说明：功能说明：判断是否为 Subagent Delegation Tool 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：name（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 isSubagentDelegationTool(name)，
 * 并按返回类型处理结果。
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}
