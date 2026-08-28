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

const QUEUE_PREVIEW_CHARS = 200 // 队列行预览的最大字符数，超出截断

/**
 * 把内容块折叠成单行预览文本：文本块取原文，非文本块用 [类型] 占位。
 * @param content 消息内容块列表。
 * @returns 压缩空白后的预览字符串。
 */
function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

/**
 * 当内容全是文本块时拼接纯文本；否则返回 null（有非文本块）。
 * @param content 消息内容块列表。
 * @returns 拼接后的文本，或 null。
 */
function textOf(content: readonly ContentBlock[]): string | null {
  if (!content.every(block => block.type === 'text')) return null
  return content.map(block => block.text).join('')
}

type QueueItems = readonly SessionQueuedItem[]

/** Authoritative transient queue projection and durable steering handoff. */
/* 权威的瞬时队列投影与持久化 steering 交接器。 */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = [] // 当前不可变的队列投影

  /**
   * Return the current immutable queue projection.
   * @returns current queue rows.
   */
  /*
   * 返回当前不可变的队列投影。
   * @returns 当前队列行。
   */
  snapshot(): readonly QueuedMessage[] {
    return this.current
  }

  /**
   * Replace from one authoritative stream queue frame.
   * @param items - complete host queue snapshot.
   */
  /*
   * 用一帧权威的流队列替换当前投影。
   * @param items 完整的 Host 队列快照。
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
  /*
   * 一旦持久化消息进入日志，撤下对应的瞬时 steering 行。
   * @param event 新成为连续段的持久化会话事件。
   * @returns 投影是否发生变化。
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
