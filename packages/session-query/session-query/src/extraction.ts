/*
 * ================================ 文件注释 ================================
 * 【文件职责】会话查询消费者的第一方语义文本提取：从会话事件中抽出可搜索的
 *   纯文本（结构性边界、流式块、请求信封与未知合并事件不贡献文本）。
 * 【技术维度】按事件类型分派；对工具调用/结果、todo 写入、回合结束原因等做
 *   字段级拼接；未知类型走 default 返回空串（合并可扩展纪律）。
 * 【产品维度】决定"哪些事件内容能进全文索引"的唯一规则。
 * 【逻辑维度】extractSessionEventText → turnEndText/contentText/blockText/joinText。
 * 【关键边界】语义与结构刻意区分：结构事件不索引，未知事件不因载荷碰巧含字符串
 *   而变得可搜索。
 * 【新手阅读建议】对照各 case 理解"什么算语义文本"。
 * ==========================================================================
 */

/** First-party semantic text extraction for session-query consumers. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Extract searchable semantic text from one first-party session event.
 *
 * Structural boundaries, raw stream chunks, request envelopes, and unknown
 * declaration-merged events contribute no text.
 * @param event - event to inspect.
 * @returns newline-joined semantic text, or an empty string when non-searchable.
 */
// 中文：从单条会话事件抽出可搜索语义文本：按类型分派到各字段拼接；
// 结构边界/流式块/请求信封/未知类型返回空串。
export function extractSessionEventText(event: SessionEvent): string {
  switch (event.type) {
    case 'user/message':
      return contentText(event.data.content)
    case 'assistant/message':
      return contentText(event.data.message.content)
    case 'tool/call':
      return joinText([event.data.name, event.data.arguments])
    case 'tool/result':
      return joinText([
        contentText(event.data.message.content),
        event.data.error?.name ?? '',
        event.data.error?.code ?? '',
      ])
    case 'todo/write':
      return joinText(event.data.todos.flatMap(todo => [todo.status, todo.content]))
    case 'turn/end':
      return turnEndText(event.data.reason)
    case 'turn/start':
    case 'step/start':
    case 'step/end':
    case 'assistant/chunk':
    case 'request/header':
      return ''
    // SessionEventMap is merge-extensible. Unknown events remain
    // non-searchable until a concrete first-party consumer defines semantics.
    default:
      return ''
  }
}

function turnEndText(reason: SessionEvent<'turn/end'>['data']['reason']): string {
  switch (reason.kind) {
    case 'error':
      return joinText(['error', reason.error.message])
    case 'aborted':
      return 'aborted'
    case 'max-tokens':
    case 'interrupted':
      return reason.kind
    case 'completed':
      return ''
    // TurnEndReasonMap is merge-extensible. Unknown outcomes stay out until
    // their owner defines which detail is semantic rather than structural.
    default:
      return ''
  }
}

type SessionContentBlock = SessionEvent<'user/message'>['data']['content'][number]

function contentText(content: readonly SessionContentBlock[]): string {
  return joinText(content.flatMap(blockText))
}

function blockText(block: SessionContentBlock): string[] {
  switch (block.type) {
    case 'text':
      return [block.text]
    case 'reasoning':
      return []
    case 'tool-call':
      return [block.name, block.arguments]
    case 'tool-result':
      return block.content.flatMap(blockText)
    // ContentBlockMap is merge-extensible. Unknown blocks do not become
    // searchable merely because their payload happens to contain strings.
    default:
      return []
  }
}

function joinText(parts: readonly string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join('\n')
}
