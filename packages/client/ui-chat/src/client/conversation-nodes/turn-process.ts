/*
 * 【文件职责】推导轮次过程区间及最终答案分界，控制答案之前的过程内容是否展开。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type {} from '@deepseek-ai/dsh-tools/types'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import type { AssistantChatData, ChatNode, FinalAssistantChatData } from '../contract/chat-nodes.ts'
import {
  isSubagentDelegationTool, sameTurnProcessSpec, type TurnProcessSpec,
} from '../contract/turn-process.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'
import { toAssistantBlocks } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Turn-level disclosure controlling process rows before the finalized answer. */
    'turn-process': import('../contract/chat-nodes.ts').TurnProcessChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Process range and finalized answer boundary for this Turn. */
    'turn-process': TurnProcessSpec
  }
}

interface TurnProcessState {
  readonly turn: number
  readonly assistantStartByStep: ReadonlyMap<number, number>
  readonly messageCountByStep: ReadonlyMap<number, number>
  readonly otherStartSeq?: number
  readonly controlAnchorSeq?: number
  readonly messageCount: number
  readonly toolCallCount: number
  readonly subagentCount: number
}

type ConversationEvent = Parameters<ConversationNodeDefinition['match']>[0]

function eventTurn(event: ConversationEvent): number | undefined {
  /**
   * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const data = event.data as unknown as { turn?: unknown }
  return typeof data.turn === 'number' ? data.turn : undefined
}

function visibleChunk(chunk: StreamChunk): boolean {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.trim() !== ''
  if (chunk.type === 'block-start') {
    return chunk.blockType !== 'text'
        && chunk.blockType !== 'reasoning'
        && chunk.blockType !== 'tool-call'
  }
  if (chunk.type !== 'block-end') return false
  const block = chunk.block
  if (block.type === 'tool-call') return false
  if (block.type === 'text' || block.type === 'reasoning') return block.text.trim() !== ''
  return true
}

function visibleAssistantEvent(event: ConversationEvent): boolean {
  if (event.type === 'assistant/live-chunk') return visibleChunk(event.data.chunk)
  if (event.type === 'assistant/attempt') {
    return expandAssistantStream(event.data.stream).some(member => visibleChunk(member.chunk))
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return event.type === 'assistant/message'
    && isAppendSurfaceEvent(event)
    && toAssistantBlocks(event.data.message.content).some((block) => {
      if (block.kind === 'tool-call') return false
      if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
      return true
    })
}

type ProcessEvidence =
  | { readonly kind: 'assistant'; readonly seq: number; readonly step: number }
  | { readonly kind: 'other'; readonly seq: number }

/**
 * 功能说明：处理 processEvidence 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （ConversationEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns ProcessEvidence | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 processEvidence(event)，并按返回类型处理结果。
 */
function processEvidence(event: ConversationEvent): ProcessEvidence | undefined {
  if (visibleAssistantEvent(event)) {
    if (event.type !== 'assistant/live-chunk'
      && event.type !== 'assistant/message'
      && event.type !== 'assistant/attempt') return undefined
    return { kind: 'assistant', seq: event.seq, step: event.data.step }
  }
  if (event.type === 'tool/call'
    || (event.type === 'tool/result' && isAppendSurfaceEvent(event))
    || event.type === 'llm/retry') return { kind: 'other', seq: event.seq }
  return undefined
}

/**
 * 功能说明：处理 turnLocation 相关流程；使用场景由所在模块及调用位置决定。
 * @param context （ConversationNodeContext<TurnProcessState>）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @returns TurnLocation | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 turnLocation(context)，并按返回类型处理结果。
 */
function turnLocation(context: ConversationNodeContext<TurnProcessState>): TurnLocation | undefined {
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location: ConversationLocation | undefined = context.start?.location ?? context.matches.at(-1)?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
}

/**
 * 功能说明：处理 fallbackState 相关流程；使用场景由所在模块及调用位置决定。
 * @param context （ConversationNodeContext<TurnProcessState>）：提供当前 Cordis
 * 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @returns TurnProcessState | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fallbackState(context)，并按返回类型处理结果。
 */
function fallbackState(context: ConversationNodeContext<TurnProcessState>): TurnProcessState | undefined {
  /**
   * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：match（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(match)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：candidate（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(candidate)，并按返回类型处理结果。
   */
  const turn = context.matches.map(match => eventTurn(match.event)).find(candidate => candidate !== undefined)
  if (turn === undefined) return undefined
  /**
   * 变量说明：state 用于处理 state 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let state: TurnProcessState = {
    turn,
    assistantStartByStep: new Map(),
    messageCountByStep: new Map(),
    messageCount: 0,
    toolCallCount: 0,
    subagentCount: 0,
  }
  /**
   * 变量说明：match 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const match of context.matches) state = updateProcessState(state, match.event)
  return state
}

/**
 * 功能说明：判断是否为 Final Assistant 相关流程；使用场景由所在模块及调用位置决定。
 * @param data （Readonly<AssistantChatData> | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns data is Readonly<FinalAssistantChatData>；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isFinalAssistant(data)，并按返回类型处理结果。
 */
function isFinalAssistant(
  data: Readonly<AssistantChatData> | undefined,
): data is Readonly<FinalAssistantChatData> {
  return data?.finalNode !== undefined
}

/**
 * 功能说明：处理 latestAnswer 相关流程；使用场景由所在模块及调用位置决定。
 * @param turn （TurnLocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Readonly<FinalAssistantChatData> | null；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 latestAnswer(turn)，并按返回类型处理结果。
 */
function latestAnswer(turn: TurnLocation): Readonly<FinalAssistantChatData> | null {
  /**
   * 常量说明：latestStep 用于处理 latestStep 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const latestStep = turn.steps.at(-1)
  /**
   * 常量说明：data 用于处理 data 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const data: Readonly<AssistantChatData> | undefined = latestStep?.data.get('assistant-step')
  if (!isFinalAssistant(data) || !hasAssistantReplyContent(data.blocks)) return null
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  return data.blocks.some(block => block.kind === 'tool-call') ? null : data
}

/**
 * 功能说明：处理 processSpec 相关流程；使用场景由所在模块及调用位置决定。
 * @param state （TurnProcessState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param turn （TurnLocation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns TurnProcessSpec | null；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 processSpec(state, turn)，并按返回类型处理结果。
 */
function processSpec(state: TurnProcessState, turn: TurnLocation): TurnProcessSpec | null {
  const controlAnchorSeq = state.controlAnchorSeq
  if (controlAnchorSeq === undefined) return null
  const answer = latestAnswer(turn)
  /**
   * 常量说明：counts 用于处理 counts 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：total（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：count（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(total, count)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[step]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([step])，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：total（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：[, count]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(total, [, count])，
   * 并按返回类型处理结果。
   */
  const counts = {
    messageCount: answer === null
      ? state.messageCount
      : [...state.messageCountByStep]
        .filter(([step]) => step < answer.step)
        .reduce((total, [, count]) => total + count, 0),
    toolCallCount: state.toolCallCount,
    subagentCount: state.subagentCount,
  }
  if (answer === null) {
    return {
      turn: turn.turn,
      controlAnchorSeq,
      processStartSeq: controlAnchorSeq,
      answerAnchorSeq: null,
      answerStep: null,
      inlineReasoning: false,
      ...counts,
    }
  }
  /**
   * 常量说明：inlineReasoning 用于处理 inlineReasoning 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
   */
  const inlineReasoning = answer.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '')
  /**
   * 常量说明：earlierAssistantSeq 用于处理 earlierAssistantSeq 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[step]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([step])，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：[, seq]（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调([, seq])，并按返回类型处理结果。
   */
  const earlierAssistantSeq = Math.min(
    ...[...state.assistantStartByStep]
      .filter(([step]) => step < answer.step)
      .map(([, seq]) => seq),
  )
  /**
   * 常量说明：externalProcessSeq 用于处理 externalProcessSeq 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const externalProcessSeq = Math.min(
    state.otherStartSeq ?? Number.POSITIVE_INFINITY,
    earlierAssistantSeq,
  )
  return {
    turn: turn.turn,
    controlAnchorSeq,
    processStartSeq: turn.start?.seq
      ?? (Number.isFinite(externalProcessSeq) ? externalProcessSeq : answer.finalNode.seq),
    answerAnchorSeq: answer.finalNode.seq,
    answerStep: answer.step,
    inlineReasoning,
    ...counts,
  }
}

/**
 * 功能说明：更新 Process State 相关流程；使用场景由所在模块及调用位置决定。
 * @param state （TurnProcessState）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param event （ConversationEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns TurnProcessState；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 updateProcessState(state, event)，并按返回类型处理结果。
 */
function updateProcessState(state: TurnProcessState, event: ConversationEvent): TurnProcessState {
  /**
   * 变量说明：current 用于处理 current 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let current = state
  if (event.type === 'assistant/message'
    && isAppendSurfaceEvent(event)
    && hasAssistantReplyContent(toAssistantBlocks(event.data.message.content))) {
    /**
     * 常量说明：messageCountByStep 用于处理 messageCountByStep 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const messageCountByStep = new Map(current.messageCountByStep)
    messageCountByStep.set(event.data.step, (messageCountByStep.get(event.data.step) ?? 0) + 1)
    current = { ...current, messageCountByStep, messageCount: current.messageCount + 1 }
  }
  if (event.type === 'tool/call') {
    /**
     * 常量说明：subagent 用于处理 subagent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const subagent = isSubagentDelegationTool(event.data.name)
    current = {
      ...current,
      toolCallCount: current.toolCallCount + (subagent ? 0 : 1),
      subagentCount: current.subagentCount + (subagent ? 1 : 0),
    }
  }
  /**
   * 常量说明：evidence 用于处理 evidence 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const evidence = processEvidence(event)
  if (evidence === undefined) return current
  if (evidence.kind === 'other') {
    return current.otherStartSeq === undefined
      ? {
        ...current,
        otherStartSeq: evidence.seq,
        controlAnchorSeq: Math.min(current.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq),
      }
      : current
  }
  if (current.assistantStartByStep.has(evidence.step)) return current
  /**
   * 常量说明：assistantStartByStep 用于处理 assistantStartByStep 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const assistantStartByStep = new Map(current.assistantStartByStep)
  assistantStartByStep.set(evidence.step, evidence.seq)
  return {
    ...current,
    assistantStartByStep,
    controlAnchorSeq: Math.min(current.controlAnchorSeq ?? Number.POSITIVE_INFINITY, evidence.seq),
  }
}

/** Turn-scoped process range and answer-boundary Definition.
 * @remarks 中文说明：常量说明：turnProcessDefinition 用于处理 turnProcessDefinition 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_context（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：match（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_context, match)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：match（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context, match)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：match（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(match)，并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：scope（由
 * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context, scope)，
 * 并按返回类型处理结果。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
 * 并按返回类型处理结果。
 */
export const turnProcessDefinition: ConversationNodeDefinition<TurnProcessState> = {
  kind: 'turn-process',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    /**
     * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const turn = eventTurn(event)
    if (turn === undefined) return null
    if (event.type === 'assistant/live-chunk'
      || event.type === 'assistant/message'
      || event.type === 'assistant/attempt'
      || event.type === 'tool/call'
      || event.type === 'tool/result'
      || event.type === 'llm/retry'
      || event.type === 'step/start'
      || event.type === 'step/end'
      || event.type === 'turn/end') {
      return { id: String(turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('turn-process start requires turn/start')
    return {
      turn: match.event.data.turn,
      assistantStartByStep: new Map(),
      messageCountByStep: new Map(),
      messageCount: 0,
      toolCallCount: 0,
      subagentCount: 0,
    }
  },
  update: (context, match) => updateProcessState(context.state, match.event),
  publication: (match) => {
    if (match.event.type === 'assistant/live-chunk') {
      const type = match.event.data.chunk.type
      return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame'
    }
    return 'immediate'
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn') return null
    /**
     * 常量说明：state 用于处理 state 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    /**
     * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const turn = turnLocation(context)
    if (turn === undefined) return null
    const current = context.current.get('chat') as ChatNode | null | undefined
    const latestStep = turn.steps.at(-1)
    if (previous?.kind === 'turn'
      && previous.key === 'turn-process'
      && current?.kind === 'turn-process'
      && current.data.answerAnchorSeq === null
      && current.data.controlAnchorSeq === state.controlAnchorSeq
      && current.data.messageCount === state.messageCount
      && current.data.toolCallCount === state.toolCallCount
      && current.data.subagentCount === state.subagentCount
      && turn.status !== 'closed'
      && latestStep?.status !== 'closed') return previous
    const spec = processSpec(state, turn)
    if (spec === null) return null
    if (previous?.kind === 'turn'
      && previous.turn === spec.turn
      && previous.key === 'turn-process'
      && sameTurnProcessSpec(previous.value, spec)) return previous
    return {
      kind: 'turn',
      turn: turn.turn,
      key: 'turn-process',
      value: spec,
    }
  },
  buildViewNode: (context) => {
    /**
     * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const turn = turnLocation(context)
    const data = turn?.data.get('turn-process')
    if (turn === undefined || data === undefined) return null
    const current = context.current.get('chat') as ChatNode | null | undefined
    const state = context.state
    if (current?.kind === 'turn-process'
      && state !== undefined
      && current.data.answerAnchorSeq === null
      && current.data.controlAnchorSeq === state.controlAnchorSeq
      && current.data.messageCount === state.messageCount
      && current.data.toolCallCount === state.toolCallCount
      && current.data.subagentCount === state.subagentCount
      && turn.status !== 'closed'
      && turn.steps.at(-1)?.status !== 'closed'
      && current.location === (context.start?.location ?? context.matches[0]?.location)) return current
    return chatNode(
      context,
      'turn-process',
      data.controlAnchorSeq + CHAT_SYNTHETIC_SEQ_OFFSETS.processControl,
      data,
    )
  },
}

/**
 * Register the Turn-scoped process disclosure projection.
 * @param ctx - owning UI Conversation context.
 * @remarks 中文说明：功能说明：注册 Turn Process 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 registerTurnProcess(ctx)，
 * 并按返回类型处理结果。
 */
export function registerTurnProcess(ctx: Context): void {
  ctx.uiConversation.events.register(turnProcessDefinition)
}
