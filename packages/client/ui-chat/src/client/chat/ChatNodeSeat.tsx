/**
 * 文件职责：实现 client/ui-chat 中 ChatNodeSeat 模块的职责，并向相邻模块提供可复用能力。
 * 技术维度：主要使用TypeScript、React 与项目的插件化客户端组件体系，通过当前文件中的类型、函数与数据结构完成实现。
 * 产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，使上层功能能够稳定组合和扩展。
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */
import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatNodeStore } from '../contract/snapshot.ts'
import {
  decodeTurnProcess, TURN_PROCESS_INDEPENDENT_KINDS, turnProcessGeneration,
  type TurnProcessSpec,
} from '../contract/turn-process.ts'
import { storedTurnProcessEntry } from '../stores.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly historyIncomplete: boolean
  readonly compactTranscript: boolean
  readonly useChat: ChatViewSlotProps['useChat']
  readonly useStore: ChatViewSlotProps['useStore']
  readonly actions: ChatViewSlotProps['actions']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/**
 * 常量说明：EMPTY_PROCESS_KEYS 用于处理 EMPTY_PROCESS_KEYS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const EMPTY_PROCESS_KEYS: readonly string[] = []

interface TurnProcessLayout {
  readonly hasExternalProcess: boolean
  readonly compactAnswer: boolean
}

/**
 * 功能说明：处理 turnProcessOpeningHumanAnchor 相关流程；使用场景由所在模块及调用位置决定。
 * @param keys （readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param nodes （ChatNodeStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param spec （TurnProcessSpec）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 turnProcessOpeningHumanAnchor(keys, nodes, spec)，
 * 并按返回类型处理结果。
 */
function turnProcessOpeningHumanAnchor(
  keys: readonly string[],
  nodes: ChatNodeStore,
  spec: TurnProcessSpec,
): number | undefined {
  /**
   * 变量说明：anchor 用于处理 anchor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let anchor: number | undefined
  /**
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const key of keys) {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = nodes.get(key) as ChatNode | undefined
    if ((node?.kind === 'user' || node?.kind === 'steering')
      && node.anchorSeq < spec.controlAnchorSeq) {
      anchor = Math.min(anchor ?? node.anchorSeq, node.anchorSeq)
    }
  }
  return anchor
}

/** Derive disclosure facts from one content-revisioned Turn index.
 * @remarks 中文说明：功能说明：处理 turnProcessLayout 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：keys（readonly string[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：nodes（ChatNodeStore）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：spec（TurnProcessSpec）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：TurnProcessLayout；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * turnProcessLayout(keys, nodes, spec)，并按返回类型处理结果。 */
function turnProcessLayout(
  keys: readonly string[],
  nodes: ChatNodeStore,
  spec: TurnProcessSpec,
): TurnProcessLayout {
  /**
   * 变量说明：hasExternalProcess 用于判断是否包含 External Process 相关数据，作用于当前作用域；
   * 其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let hasExternalProcess = false
  /**
   * 变量说明：compactAnswer 用于处理 compactAnswer 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let compactAnswer = true
  /**
   * 常量说明：openingHumanAnchor 用于处理 openingHumanAnchor 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const openingHumanAnchor = turnProcessOpeningHumanAnchor(keys, nodes, spec)
  /**
   * 变量说明：key 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (const key of keys) {
    /**
     * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || node.kind === 'turn-process') continue
    if ((node.kind === 'user' || node.kind === 'steering')
      && (openingHumanAnchor === undefined || node.anchorSeq > openingHumanAnchor)
      && (spec.answerAnchorSeq === null || node.anchorSeq < spec.answerAnchorSeq)) {
      compactAnswer = false
    }
    if (TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)
      || node.anchorSeq < spec.processStartSeq
      || (spec.answerAnchorSeq !== null && node.anchorSeq >= spec.answerAnchorSeq)) continue
    if (node.kind !== 'assistant-step' || spec.answerStep === null || node.data.step !== spec.answerStep) {
      hasExternalProcess = true
    }
  }
  return { hasExternalProcess, compactAnswer }
}

/** Subscribe, apply Turn-process visibility, and dispatch one stable Context key.
 * @remarks 中文说明：常量说明：ChatNodeSeat 用于处理 ChatNodeSeat 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ nodeKey, historyIncomplete,
 * compactTr…（ChatNodeSeatProps）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由
 * TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({
 * nodeKey, historyI…)，并按返回类型处理结果。
 */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, historyIncomplete, compactTranscript,
  selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, useChat, useStore, actions, renderSlot, t,
}: ChatNodeSeatProps) {
  /**
   * 常量说明：node 用于处理 node 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
   */
  const node = useChat(snapshot => snapshot.nodes.get(nodeKey))
  /**
   * 常量说明：processSignature 用于处理 processSignature 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
   */
  const processSignature = useChat((snapshot) => {
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = snapshot.nodes.get(nodeKey)
    /**
     * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const location = current?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.data.get('turn-process')
      : undefined
  })
  /**
   * 常量说明：processSpec 用于处理 processSpec 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const processSpec = useMemo(
    () => processSignature === undefined ? undefined : decodeTurnProcess(processSignature),
    [processSignature],
  )
  /**
   * 常量说明：nodeStore 用于处理 nodeStore 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
   */
  const nodeStore = useChat(snapshot => snapshot.nodes)
  /**
   * 常量说明：processLayoutKeys 用于处理 processLayoutKeys 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：snapshot（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(snapshot)，并按返回类型处理结果。
   */
  const processLayoutKeys = useChat((snapshot) => {
    if (!compactTranscript || historyIncomplete || processSpec === undefined) return EMPTY_PROCESS_KEYS
    /**
     * 常量说明：current 用于处理 current 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const current = snapshot.nodes.get(nodeKey) as ChatNode | undefined
    /**
     * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const location = current?.location
    if (current === undefined
      || (location?.kind !== 'turn' && location?.kind !== 'step')
      || location.turn.status !== 'closed'
      || location.turn.turn !== processSpec.turn) return EMPTY_PROCESS_KEYS
    /**
     * 常量说明：ownsLayout 用于处理 ownsLayout 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const ownsLayout = current.kind === 'turn-process'
      || (current.kind === 'assistant-step' && current.data.step === processSpec.answerStep)
    return ownsLayout ? snapshot.locations.getTurn(processSpec.turn) : EMPTY_PROCESS_KEYS
  })
  /**
   * 常量说明：processLayout 用于处理 processLayout 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const processLayout = useMemo(
    () => processSpec === undefined || processLayoutKeys.length === 0
      ? undefined
      : turnProcessLayout(processLayoutKeys, nodeStore, processSpec),
    [nodeStore, processLayoutKeys, processSpec],
  )
  /**
   * 常量说明：processGeneration 用于处理 processGeneration 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const processGeneration = useMemo(
    () => processSpec === undefined ? undefined : turnProcessGeneration(processSpec),
    [processSpec],
  )
  /**
   * 常量说明：storedEntry 用于处理 storedEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
   */
  const storedEntry = useStore(state => processSpec === undefined
    ? undefined
    : storedTurnProcessEntry(state, processSpec.turn))
  /**
   * 常量说明：processEntry 用于处理 processEntry 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processEntry = storedEntry?.generation === processGeneration ? storedEntry : undefined
  /**
   * 常量说明：processOpen 用于处理 processOpen 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processOpen = processEntry !== undefined
  /**
   * 常量说明：setOpen 用于设置 Open 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：open（boolean）：提供本次调用所需的数据；
   * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 典型用法：在完成前置校验后调用 匿名回调(open)，并按返回类型处理结果。
   */
  const setOpen = useCallback((open: boolean) => {
    if (processGeneration !== undefined && processSpec !== undefined) {
      actions.setTurnProcessOpen(processSpec.turn, processGeneration, open)
    }
  }, [actions, processGeneration, processSpec])
  /**
   * 常量说明：routedNode 用于处理 routedNode 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const routedNode = node as ChatNode | undefined
  /**
   * 常量说明：sameTurn 用于处理 sameTurn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sameTurn = routedNode !== undefined
    && processSpec !== undefined
    && (routedNode.location.kind === 'turn' || routedNode.location.kind === 'step')
    && routedNode.location.turn.turn === processSpec.turn
  /**
   * 常量说明：turnClosed 用于处理 turnClosed 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const turnClosed = sameTurn
    && routedNode.location.turn.status === 'closed'
  /**
   * 常量说明：processWindowReady 用于处理 processWindowReady 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processWindowReady = processSpec !== undefined
    && compactTranscript
    && processSpec.answerAnchorSeq !== null
    && turnClosed
    && !historyIncomplete
  /**
   * 常量说明：processMember 用于处理 processMember 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processMember = sameTurn
    && processWindowReady
    && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)
    && routedNode.anchorSeq >= processSpec.processStartSeq
    && routedNode.anchorSeq < processSpec.answerAnchorSeq
  /**
   * 常量说明：processAnswer 用于处理 processAnswer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processAnswer = sameTurn
    && processWindowReady
    && routedNode.kind === 'assistant-step'
    && routedNode.data.step === processSpec.answerStep
  /**
   * 常量说明：ownsDisclosure 用于处理 ownsDisclosure 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const ownsDisclosure = routedNode?.kind === 'turn-process' || processAnswer
  /**
   * 常量说明：foldable 用于处理 foldable 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const foldable = processWindowReady
    && (processMember || (ownsDisclosure
      && ((processLayout?.hasExternalProcess ?? false) || processSpec.inlineReasoning)))
  /**
   * 常量说明：turnProcess 用于处理 turnProcess 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const turnProcess = useMemo(() => processGeneration === undefined || processSpec === undefined
    ? undefined
    : {
      spec: processSpec,
      foldable,
      open: processOpen,
      setOpen,
    }, [
    foldable, processGeneration, processOpen, processSpec, setOpen,
  ])
  /**
   * 常量说明：controllerInactive 用于处理 controllerInactive 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const controllerInactive = routedNode?.kind === 'turn-process'
    && !foldable
  /**
   * 常量说明：compactAnswer 用于处理 compactAnswer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const compactAnswer = processAnswer
    && foldable
    && processLayout?.compactAnswer === true
    && !processOpen
  /**
   * 常量说明：processHidden 用于处理 processHidden 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const processHidden = controllerInactive || (foldable && processMember && !processOpen)
  /**
   * 常量说明：revealProcess 用于处理 revealProcess 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const revealProcess = useCallback(() => {
    if (processMember) setOpen(true)
  }, [processMember, setOpen])
  /**
   * 常量说明：wrapperRef 用于处理 wrapperRef 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const wrapperRef = useSearchableHidden(processHidden, revealProcess)
  /**
   * 常量说明：owner 用于处理 owner 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
      turnProcess,
    }, [
    node, selectedCallId, cwd, openFile, inspectCall, forkAt,
    renderMessageImages, fileMentions, turnProcess,
  ])
  if (routedNode === undefined || owner === null) return null
  /**
   * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const location = routedNode.location
  /**
   * 常量说明：turn 用于处理 turn 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const turn = location.kind === 'turn' || location.kind === 'step'
    ? location.turn.turn
    : undefined
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  /**
   * 常量说明：routedOwner 用于处理 routedOwner 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：total（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(total)，并按返回类型处理结果。
   */
  return (
    <div
      ref={wrapperRef}
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-turn-process-member={processMember || undefined}
      data-turn-process-hidden={processHidden || undefined}
      data-turn-process-answer={compactAnswer || undefined}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
