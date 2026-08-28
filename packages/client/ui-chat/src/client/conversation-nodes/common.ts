/**
 * ================================ 文件注释 ================================
 * 【文件职责】聊天业务节点共用的工具：合成序偏移（把中断 / 通知等安排在稳定事件的
 *             seq 邻域内）、Context 位置解析、最终聊天节点封装与坐标校验。
 * 【技术维度】纯函数 + 常量；chatNode 用引擎持有的 key 构建 chat 目标节点。
 * 【产品维度】各业务状态机产出统一形态的聊天节点，渲染器按 kind 分发。
 * 【逻辑维度】1) 合成序偏移表；2) contextLocation；3) chatNode 封装；4) coordinate 校验。
 * 【关键边界】max-tokens 通知的偏移设计保证回合尾保持回合最后节点（分支动作可用）。
 * 【新手阅读建议】先看 CHAT_SYNTHETIC_SEQ_OFFSETS 的取值意图。
 * ==========================================================================
 */
import type {
  ConversationLocation, ConversationNodeContext,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ChatNode, ChatNodeDataMap, ChatNodeKind,
} from '../contract/chat-nodes.ts'

/**
 * Relative positions in one durable event's seq neighborhood: interrupted
 * Assistant, its follow-up Nodes, then follow-ups to an ordinary final. The
 * max-tokens notice sits between a closing Assistant and the turn-tail so the
 * tail stays the turn's last node and keeps its branch action enabled.
 */
export const CHAT_SYNTHETIC_SEQ_OFFSETS = {
  interruptedAssistant: -0.9,
  interruptedFollowup: -0.8,
  processControl: -0.1,
  maxTokensNotice: 0.05,
  finalizedFollowup: 0.1,
} as const

/**
 * Resolve one Context's best currently loaded event Location.
 * @param context - assembled business Context.
 * @returns start or first-match Location, otherwise unresolved.
 */
export function contextLocation(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

/**
 * Build one final Chat target Node with the engine-owned stable key.
 * @param context - assembled business Context.
 * @param kind - Chat renderer dispatch key.
 * @param anchorSeq - sortable render position.
 * @param data - renderer-owned payload.
 * @param options - optional Location and visibility overrides.
 * @returns final Chat view Node.
 */
export function chatNode<Kind extends ChatNodeKind>(
  context: ConversationNodeContext,
  kind: Kind,
  anchorSeq: number,
  data: ChatNodeDataMap[Kind],
  options: {
    readonly location?: ConversationLocation
    readonly visibility?: 'visible' | 'hidden'
  } = {},
): ChatNode<Kind> {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: options.location ?? contextLocation(context),
    visibility: options.visibility ?? 'visible',
    data,
  }
}

/**
 * Read a finite non-negative integer from a structurally narrowed payload.
 * @param value - untrusted payload field.
 * @returns valid coordinate, otherwise undefined.
 */
export function coordinate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
