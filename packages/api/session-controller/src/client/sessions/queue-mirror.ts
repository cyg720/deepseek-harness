/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话队列（queue）的权威瞬时投影 + 持久化 steering 交接：
 *   把 Host 流式队列帧镜像为客户端队列行，并在持久化消息进入日志后
 *   撤下对应的瞬时行。
 * 【技术维度】纯类：replace 用一整帧替换投影；acceptDurable 按 messageId
 *   匹配 steering 行并移除；snapshot 返回不可变当前投影。
 * 【产品维度】用户发送的多条消息进入排队（queue）或插话（steering）时，
 *   界面需要立即显示"待处理"行；消息真正入日志后这些行必须消失，
 *   避免重复展示。
 * 【逻辑维度】previewOf/textOf 分别生成展示预览与纯文本；reset 丢弃过期
 *   世代；replace 吸收新基线；acceptDurable 交接给持久化消息。
 * 【关键边界】只有 placement 为 steering 的行参与持久化交接；acceptDurable
 *   只认 user/message 事件。
 * 【新手阅读建议】先理解会话对话模型中 QueuedMessage 的字段含义。
 * ==========================================================================
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionQueuedItem } from '../../types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { QueuedMessage } from '../contract/snapshot.ts'

const QUEUE_PREVIEW_CHARS = 200

// Image blocks are excluded: queue presentation renders them as thumbnails
// from `content`, so the text preview covers only what has no visual form.
function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .filter(block => block.type !== 'image')
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

function textOf(content: readonly ContentBlock[]): string | null {
  if (!content.every(block => block.type === 'text')) return null
  return content.map(block => block.text).join('')
}

type QueueItems = readonly SessionQueuedItem[]

/** Authoritative transient queue projection and durable steering handoff. */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = []

  /**
   * Return the current immutable queue projection.
   * @returns current queue rows.
   */
  snapshot(): readonly QueuedMessage[] {
    return this.current
  }

  /**
   * Replace from one authoritative stream queue frame.
   * @param items - complete host queue snapshot.
   */
  replace(items: QueueItems): void {
    this.current = items.map((item) => {
      const content = item.message.content as unknown as readonly ContentBlock[]
      return {
        id: item.id,
        messageId: item.message.id,
        placement: item.placement,
        ...(item.rpcId === undefined ? {} : { rpcId: item.rpcId }),
        content,
        preview: previewOf(content),
        text: textOf(content),
      }
    })
  }

  /**
   * Retire a transient steering row once its durable message enters the log.
   * @param event - newly contiguous durable Session event.
   * @returns whether the projection changed.
   */
  acceptDurable(event: SessionEvent): boolean {
    if (event.type !== 'user/message') return false
    const messageId = event.data.id
    const index = this.current.findIndex(item =>
      item.placement === 'steering' && item.messageId === messageId)
    if (index < 0) return false
    this.current = this.current.filter((_item, candidate) => candidate !== index)
    return true
  }
}
