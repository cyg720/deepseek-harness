/**
 * 轮次过程与收尾的视图模型（纯函数）。
 *
 * 只使用官方投影给出的计数、状态与指标：缺值时保持缺失，不用 0、百分比或本地计时补齐。
 * 失败与截断由本轮自身的诊断节点（turn-error / turn-max-tokens）判定，收尾行不自行重算轮次结论。
 */
import type {
  ChatConversationViewNode, ChatTurnProcessPresentation, TurnProcessChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 过程行的视图模型。 */
export interface TurnProcessModel {
  /** 轮次序号。 */
  readonly turn: number
  /** 运行中为官方位置的最新步骤，结束后为最终答案步骤；未知时为 null。 */
  readonly step: number | null
  /** 本轮是否仍在进行。 */
  readonly running: boolean
  /** 已持久化的工具调用数（不含子代理委派）。 */
  readonly tools: number
  /** 回答承载的过程消息数。 */
  readonly messages: number
  /** 子代理委派数。 */
  readonly agents: number
  /** 投影确认存在外部过程或内联推理；这类内容不一定计入活动数量。 */
  readonly hasUncountedActivity: boolean
}

/**
 * 构建过程模型。
 *
 * 计数取自轮次投影；运行中步骤来自同轮位置，结束后采用最终答案步骤。
 * @param process - 轮次过程呈现（含 turnClosed）；未就绪时为 undefined。
 * @param data - `turn-process` 节点负载。
 * @param location - 官方节点位置；未加载时不猜测运行中步骤。
 * @returns 过程模型。
 */
export function turnProcessModel(
  process: ChatTurnProcessPresentation | undefined,
  data: TurnProcessChatData,
  location?: ConversationLocation,
): TurnProcessModel {
  const running = process?.turnClosed !== true
  // 位置必须属于本轮，防止分页或切换期间把其他轮的最新步骤显示过来。
  const currentStep = location !== undefined && (location.kind === 'turn' || location.kind === 'step')
    && location.turn.turn === data.turn ? location.turn.steps.at(-1)?.step : undefined
  return {
    turn: data.turn,
    step: (running ? currentStep : data.answerStep) ?? null,
    running,
    tools: data.toolCallCount,
    messages: data.messageCount,
    agents: data.subagentCount,
    hasUncountedActivity: process?.hasExternalProcess === true || data.inlineReasoning,
  }
}

/**
 * 过程是否有可展示的活动，包括没有计数的重试、上下文或推理。
 * @param model - 过程模型。
 * @returns 有计数活动或投影确认存在其他活动时为 true。
 */
export function hasProcessActivity(model: TurnProcessModel): boolean {
  return model.hasUncountedActivity || model.tools > 0 || model.messages > 0 || model.agents > 0
}

/** 收尾行的状态：成功、被停止、失败、截断、运行中，或没有最终回答。 */
export type TurnTailState = 'running' | 'ok' | 'stopped' | 'failed' | 'truncated' | 'empty'

/** 本轮诊断事实，由同一轮的相关节点判定。 */
export interface TurnDiagnostics {
  /** 本轮存在终态失败节点（turn-error）。 */
  readonly failed: boolean
  /** 本轮存在输出上限节点（turn-max-tokens）。 */
  readonly truncated: boolean
}

/**
 * 收尾状态判定。
 *
 * 顺序即优先级：失败与截断是本轮的终态事实，优先于收尾消息自身的状态；`closing` 为空
 * 表示本轮没有最终回答（例如被中断），此时既不声称成功也不声称失败。
 * @param data - `turn-tail` 节点负载。
 * @param diagnostics - 本轮诊断事实。
 * @returns 收尾状态。
 */
export function turnTailState(data: TurnTailChatData, diagnostics: TurnDiagnostics): TurnTailState {
  if (diagnostics.failed) return 'failed'
  if (diagnostics.truncated) return 'truncated'
  if (data.closing === null) return 'empty'
  if (data.closing.status === 'running') return 'running'
  return data.closing.status === 'interrupted' ? 'stopped' : 'ok'
}

/** 收尾行的指标：只携带已知值。 */
export interface TurnMetrics {
  /** 精确 token 合计；证据不完整时为 undefined。 */
  readonly tokens: number | undefined
  /** 首 token 延迟；证据不完整时为 undefined。 */
  readonly ttftMs: number | undefined
  /** 解码吞吐；证据不完整时为 undefined。 */
  readonly tokensPerSecond: number | undefined
}

/**
 * 读取收尾指标。
 * @param data - `turn-tail` 节点负载。
 * @returns 指标（缺项为 undefined）。
 */
export function turnMetrics(data: TurnTailChatData): TurnMetrics {
  return {
    tokens: data.tokenUsage?.totalTokens,
    ttftMs: data.ttftMs,
    tokensPerSecond: data.tokensPerSecond,
  }
}

/**
 * 是否至少有一项指标可展示。
 * @param metrics - 指标。
 * @returns 任一项存在时为 true。
 */
export function hasMetrics(metrics: TurnMetrics): boolean {
  return metrics.tokens !== undefined || metrics.ttftMs !== undefined || metrics.tokensPerSecond !== undefined
}

/**
 * 读取节点所属轮次。
 * @param location - 节点位置。
 * @returns 轮次序号；会话级或未解析位置时为 undefined。
 */
export function nodeTurn(location: ConversationLocation): number | undefined {
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
}

/** 只缓存不可变节点数组；官方 values() 在节点变化时换引用，弱键不阻止旧会话回收。 */
const diagnosticsBySnapshot = new WeakMap<
  readonly ChatConversationViewNode[], Map<number, Set<'turn-error' | 'turn-max-tokens'>>
>()

/**
 * 本轮是否出现某类诊断节点。
 *
 * 收尾行据此判定失败与截断：每份节点数组只建立一次轮次索引，后续查询不扫描历史。
 * @param nodes - 官方节点存储发布的不可变数组；节点变更时必须使用新数组。
 * @param turn - 轮次序号。
 * @param kind - 诊断节点 kind（`turn-error` 或 `turn-max-tokens`）。
 * @returns 存在该 kind 的节点时为 true。
 */
export function hasTurnDiagnostic(
  nodes: readonly ChatConversationViewNode[],
  turn: number,
  kind: 'turn-error' | 'turn-max-tokens',
): boolean {
  let index = diagnosticsBySnapshot.get(nodes)
  if (index === undefined) {
    index = new Map()
    for (const node of nodes) {
      const nodeKind = node.kind
      if (nodeKind !== 'turn-error' && nodeKind !== 'turn-max-tokens') continue
      const nodeTurnId = nodeTurn(node.location)
      if (nodeTurnId === undefined) continue
      let kinds = index.get(nodeTurnId)
      if (kinds === undefined) {
        kinds = new Set()
        index.set(nodeTurnId, kinds)
      }
      kinds.add(nodeKind)
    }
    diagnosticsBySnapshot.set(nodes, index)
  }
  return index.get(turn)?.has(kind) === true
}
