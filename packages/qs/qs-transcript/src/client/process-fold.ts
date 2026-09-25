/**
 * 已完成轮的过程折叠状态。
 *
 * 折叠只影响「已结束轮的过程成员是否显示」：运行中的轮不折叠，最终答案行永远不是成员。
 * 状态按「会话 + 轮次 + 答案步骤」隔离，因此实时转完成、切换会话或同轮重建都不会串台；
 * 展开状态只存在于本次页面生命周期，不写本地存储。
 */
import type { ChatTurnProcessPresentation } from '@deepseek-ai/dsh-client-ui-chat/client'
import { hasProcessActivity, turnProcessModel } from './turn-view-model.ts'

/** 过程折叠状态的读写面：会话宿主注入给行，行不自行持有全局状态。 */
export interface QsProcessFold {
  /**
   * 读取展开状态。
   * @param key - 折叠键。
   * @returns 已显式展开时为 true；未记录或已收起时为 false。
   */
  isOpen(key: string): boolean
  /**
   * 写入展开状态并通知订阅者。
   * @param key - 折叠键。
   * @param open - 是否展开。
   */
  set(key: string, open: boolean): void
  /**
   * 订阅变化。
   * @param listener - 变化回调。
   * @returns 取消订阅函数。
   */
  subscribe(listener: () => void): () => void
}

/**
 * 建立一个过程折叠状态存储（每个会话一个）。
 * @returns 折叠状态读写面。
 */
export function createProcessFold(): QsProcessFold {
  const open = new Map<string, boolean>()
  const listeners = new Set<() => void>()
  return {
    isOpen: key => open.get(key) === true,
    set: (key, value) => {
      if ((open.get(key) === true) === value) return
      open.set(key, value)
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * 组装折叠键。
 * @param sessionId - 会话标识。
 * @param turn - 轮次序号。
 * @param answerStep - 最终答案步骤；未知时用 `-`（答案确定后键随之变化，重新按默认收起）。
 * @returns 折叠键。
 */
export function processFoldKey(sessionId: string, turn: number, answerStep: number | null): string {
  return `${sessionId}|${turn}|${answerStep ?? '-'}`
}

/**
 * 与官方一致的「过程独立 kind」：这些行不属于轮过程的可折叠内容。
 *
 * 最终答案行不在窗口内（窗口右端是 `answerAnchorSeq`），因此展开过程也不会重复最终答案。
 */
export const PROCESS_INDEPENDENT_KINDS: readonly string[] = [
  'system-prompt', 'user', 'steering', 'turn-process', 'turn-error', 'turn-max-tokens', 'turn-tail',
]

/** 过程成员的判定输入。 */
export interface ProcessMemberInput {
  /** 节点 kind。 */
  readonly kind: string
  /** 节点锚点序号。 */
  readonly anchorSeq: number
  /** 该节点的轮次呈现；不在任何轮次过程内时为 undefined。 */
  readonly presentation: ChatTurnProcessPresentation | undefined
  /** 所属轮的折叠键当前是否已展开。 */
  readonly open: boolean
  /** 未加载完整历史时控制行可能缺席，已有成员必须保持可见。 */
  readonly historyIncomplete: boolean
}

/**
 * 判断本轮是否已具备可用的过程折叠窗口。
 * @param presentation - 官方投影中的轮次呈现。
 * @param historyIncomplete - 是否还有未加载历史。
 * @returns 本轮已结束、答案锚点确定且有过程内容时为 true。
 */
export function canFoldProcess(
  presentation: ChatTurnProcessPresentation | undefined,
  historyIncomplete: boolean,
): presentation is ChatTurnProcessPresentation & { spec: { answerAnchorSeq: number } } {
  if (historyIncomplete) return false
  if (presentation === undefined || !presentation.turnClosed) return false
  // 控制行和成员共用就绪条件，避免按钮存在但内容不受它控制。
  if (!hasProcessActivity(turnProcessModel(presentation, presentation.spec))) return false
  if (presentation.turn !== presentation.spec.turn) return false
  return presentation.spec.answerAnchorSeq !== null
}

/**
 * 该行是否应因过程折叠而隐藏。
 *
 * 折叠只在轮次已结束且最终答案位置已确定时生效：运行中或答案未定就隐藏内容，
 * 会让用户误以为过程为空。
 * @param input - 成员判定输入。
 * @returns 应隐藏时为 true。
 */
export function isProcessMemberHidden(input: ProcessMemberInput): boolean {
  const { kind, anchorSeq, presentation, open } = input
  if (!canFoldProcess(presentation, input.historyIncomplete)) return false
  if (PROCESS_INDEPENDENT_KINDS.includes(kind)) return false
  if (anchorSeq < presentation.spec.processStartSeq || anchorSeq >= presentation.spec.answerAnchorSeq) return false
  return !open
}
