
/**
 * Durable projection state for dynamic runtime context.
 * @module @deepseek-ai/dsh-agent-loop/runtime-context
 */

/*
 * 【文件职责】跟踪动态运行上下文最后保留的快照，投影状态本身不拥有日志提交操作。
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'

// 归属标识：只有 source.plugin 等于这个值的用户消息才被本投影追踪（即由 dsh-system-prompt 生成的快照）。
const SOURCE = '@deepseek-ai/dsh-system-prompt'
// 清空标记文案：当动态上下文变为空时写入这条消息，告诉模型“之前的所有运行时上下文快照均已失效”。
const CLEARED = 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.'

// 判断一条用户消息是否由本投影所属的插件（dsh-system-prompt）生成。
function isOwned(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === SOURCE
}

// 提取单文本块消息的文本内容：仅当消息恰好由一段 text 构成时返回，否则返回 undefined。
function textOf(message: UserMessage): string | undefined {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

/** Tracks the last retained runtime-context snapshot without owning its commit. */
// 运行时上下文投影：只追踪“最近一次被保留的快照”，不负责把它提交进会话（提交由调用方 preStep 决定）。
export class RuntimeContextProjection {
  /** `undefined` means no snapshot ever existed; `null` means none is retained. */
  private retained: { seq: SessionSeq; text: string | undefined } | null | undefined

  /**
   * Restore projection state once, then follow authoritative session events.
   * @param ctx - agent-scoped event context.
   * @param session - session receiving projected messages.
   */
  // 构造函数：先倒序重放会话日志恢复初始投影状态，再订阅后续事件增量维护。
  constructor(ctx: Context, session: Session) {
    // 当前仍在“表面”（surface，即对模型可见的最终消息序列）中的节点 seq 集合，用于判断快照是否仍存活。
    const surface = new Set(session.surface.nodes)
    for (let index = session.seq - 1; index >= 0; index -= 1) {
      const event = session.eventAt(SessionSeq(index))
      if (event?.type !== 'user/message' || !isOwned(event.data)) continue
      this.retained ??= null
      if (surface.has(event.seq)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
        break
      }
    }

    // 增量维护：新快照到来则更新 retained；已保留快照被“替换型表面事件”覆盖（不再对模型可见）则置空。
    ctx.on('session/event', (subject, event) => {
      if (subject !== session) return
      if (event.type === 'user/message' && isOwned(event.data)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
      } else if (this.retained
        && isReplacementSurfaceEvent(event)
        && event.sourceEventSeqs?.includes(this.retained.seq) === true) {
        this.retained = null
      }
    })
  }

  /**
   * Create an uncommitted snapshot only when the retained value differs.
   * @param current - fully rendered dynamic context.
   * @param sections - named contributions that formed the current snapshot.
   * @returns a candidate user message, or `undefined` when no update is needed.
   */
  // 投影计算：与保留值比较，内容有变化才产出候选消息；无变化返回 undefined 表示“无需更新”。
  project(current: string, sections: readonly ContextSnapshotSection[]): UserMessage | undefined {
    // 从未有过快照且当前内容为空：无事可记，直接跳过。
    if (this.retained === undefined && current.length === 0) return
    // 当前为空时用 CLEARED 标记取代空串，使“清空”本身也成为一条可见的上下文消息。
    const snapshot = current.length === 0 ? CLEARED : current
    // 与保留值相同则无需更新（避免每个步骤重复刷同样的上下文）。
    if (this.retained?.text === snapshot) return
    return createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      // The cleared marker has no contributions left to attribute.
      // 清空标记没有可归属的贡献段；非空快照则带上各命名贡献段供回放与审计。
      source: sections.length === 0
        ? { kind: 'plugin', plugin: SOURCE }
        : { kind: 'plugin', plugin: SOURCE, form: 'snapshot', sections },
    })
  }
}
