/**
 * ================================ 文件注释 ================================
 * 【文件职责】自动压缩生命周期与落定检查点状态机：跟踪 compaction/start、summary、end
 *             与自动检查点事件，产出压缩标记节点。
 * 【技术维度】ConversationNodeDefinition（target: 'chat'）；复用 command.ts 的
 *             compactSource / compactSummary / updateCompactionState；手动 /compact 命令
 *             由 command.ts 处理（带 sourceCommandId 的事件这里不匹配）。
 * 【产品维度】自动上下文压缩在消息流中显示为一行标记（可展开摘要）。
 * 【逻辑维度】1) 数据映射扩充；2) fallbackState；3) 状态机；4) 注册函数。
 * 【关键边界】sourceCommandId 存在（手动命令触发）时本定义不认领；checkpoint 缺失时
 *             不产出节点。
 * 【新手阅读建议】与 command.ts 的压缩部分对照阅读。
 * ==========================================================================
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type { CompactionSummaryNode } from '../contract/snapshot.ts'
import { chatNode } from './common.ts'
import { compactSource, compactSummary, updateCompactionState } from './command.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Automatic compaction checkpoint marker. */
    compaction: CompactionSummaryNode
  }
}

interface CompactionState {
  readonly summary?: ConversationMatch
  readonly checkpoint?: ConversationMatch
}

function fallbackState(context: ConversationNodeContext<CompactionState>): CompactionState {
  const summary = context.matches.find(match => match.event.type === 'compaction/summary')
  const checkpoint = context.matches.find(match => compactSource(match.event) !== undefined)
  return {
    ...summary === undefined ? {} : { summary },
    ...checkpoint === undefined ? {} : { checkpoint },
  }
}

/** Automatic compaction lifecycle and landed checkpoint Definition. */
export const compactionDefinition: ConversationNodeDefinition<CompactionState> = {
  kind: 'compaction',
  target: 'chat',
  match: (event) => {
    const checkpoint = compactSource(event)
    if (checkpoint !== undefined && checkpoint.sourceCommandId === undefined) {
      return { id: checkpoint.compactionId, role: 'update' }
    }
    if (event.type === 'compaction/start'
      || event.type === 'compaction/summary'
      || event.type === 'compaction/end') {
      if (event.data.sourceCommandId !== undefined) return null
      const compactionId: unknown = event.data.compactionId
      if (typeof compactionId !== 'string' || compactionId === '') return null
      return { id: compactionId, role: event.type === 'compaction/start' ? 'start' : 'update' }
    }
    return null
  },
  start: () => ({}),
  update: (context, match) => updateCompactionState(context.state, match),
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state.checkpoint === undefined) return null
    const marker = compactSummary(state.summary, state.checkpoint)
    return chatNode(context, 'compaction', marker.seq, marker)
  },
}

/**
 * Register the automatic-compaction business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerCompactionConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(compactionDefinition)
}
