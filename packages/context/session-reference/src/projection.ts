/** Current-surface projection and byte-bounded rendering. */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】会话引用的"投影 + 字节预算"处理：把来源会话的表面快照投影成
 *             仅含用户/助手文本的对话，并在给定字节预算内裁剪到可放进提示词。
 * 【技术维度】事件流投影（跳过工具/推理/注入上下文）；TextRetainer 做
 *             头尾保留式截断；二分查找确定最大可保留字节数；所有字节按
 *             UTF-8 精确计量（Buffer.byteLength）。
 * 【产品维度】用户 @ 引用一个长会话时，这里决定"哪些消息、多少内容"能被
 *             带进当前会话：优先保消息数（砍掉非检查点消息），再保文本（截断
 *             最长消息并附"省略了多少字节"的提示）。
 * 【逻辑维度】1) projectSessionConversation：事件流 → 纯文本对话项；2)
 *             retainReferencedSession：两阶段裁剪（先丢消息、再截文本），
 *             同时产出保留统计；3) truncateWithNotice：头尾保留 + 省略提示。
 * 【关键边界】checkpoint 消息（压缩检查点）永不丢弃，因为它是之前会话的
 *             摘要锚点；固定字段（id/label/cwd）超预算时直接返回 undefined
 *             （上游抛 BUDGET_EXCEEDED）。
 * 【新手阅读建议】先读三个接口看数据结构，再读 retainReferencedSession 的
 *                 两个 while 循环（裁剪阶段），最后读 truncateWithNotice 的
 *                 二分逻辑与省略提示格式。
 * ==========================================================================
 */

import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { stringifyTagSafeJson } from './serialization.ts'
import type { ReferencedConversationItem } from './types.ts'

interface ProjectedItem extends ReferencedConversationItem {
  checkpoint: boolean
  originalText: string
  omittedBytes: number
}

/** Snapshot data serialized inside the untrusted prompt. */
export interface ReferencedSessionData {
  sessionId: string
  label: string
  cwd: string | null
  capturedThroughSeq: number | null
  conversation: ReferencedConversationItem[]
}

/** Retention facts stored beside the durable context. */
export interface ReferenceRetentionStats {
  compacted: boolean
  originalMessages: number
  retainedMessages: number
  omittedMessages: number
  omittedBytes: number
  truncated: boolean
}

/** Project current user/assistant conversation while excluding tools, reasoning, and injected context. */
function projectSessionConversation(snapshot: SessionSurfaceSnapshot): ProjectedItem[] {
  const conversation: ProjectedItem[] = []
  for (const event of snapshot.events) {
    switch (event.type) {
      case 'user/message': {
        const checkpoint = isCompactCheckpointSource(event.data.source)
        if (!checkpoint && event.data.source.kind !== 'user') break
        const text = textContent(event.data.content)
        if (text !== '') conversation.push({ role: 'user', text, checkpoint, originalText: text, omittedBytes: 0 })
        break
      }
      case 'assistant/message': {
        const text = textContent(event.data.message.content)
        if (text !== '') conversation.push({ role: 'assistant', text, checkpoint: false, originalText: text, omittedBytes: 0 })
        break
      }
      case 'tool/result':
        break
      /* v8 ignore next 2 -- SurfaceEventType is closed and every variant is handled above. */
      default:
        assertNever(event, 'session-reference surface event')
    }
  }
  return conversation
}

/**
 * Fit one projected snapshot into an exact rendered JSON-object byte cap.
 * @param snapshot - current-surface source observation.
 * @param label - host-provided display label serialized with the source.
 * @param maxBytes - maximum UTF-8 bytes for the serialized data object.
 * @returns retained data and stats, or `undefined` when fixed data cannot fit.
 */
export function retainReferencedSession(
  snapshot: SessionSurfaceSnapshot,
  label: string,
  maxBytes: number,
): { data: ReferencedSessionData; stats: ReferenceRetentionStats } | undefined {
  const original = projectSessionConversation(snapshot)
  const retained = original.map(item => ({ ...item }))
  let omittedMessages = 0
  let droppedOmittedBytes = 0
  const data = (): ReferencedSessionData => ({
    sessionId: snapshot.session.id,
    label,
    cwd: snapshot.session.cwd ?? null,
    capturedThroughSeq: snapshot.capturedThroughSeq,
    conversation: retained.map(({ role, text }) => ({ role, text })),
  })
  const size = (): number => Buffer.byteLength(stringifyTagSafeJson(data()), 'utf8')

  while (size() > maxBytes) {
    const newestIndex = retained.length - 1
    const dropIndex = retained.findIndex((item, index) => !item.checkpoint && index !== newestIndex)
    if (dropIndex < 0) break
    const removed = retained.splice(dropIndex, 1)[0]
    /* v8 ignore next 3 -- dropIndex came from this exact array and is non-negative. */
    if (removed === undefined) {
      throw new Error('session-reference retention selected a missing message')
    }
    omittedMessages += 1
    droppedOmittedBytes += Buffer.byteLength(removed.originalText, 'utf8')
  }

  while (size() > maxBytes) {
    let longestIndex = -1
    let longestBytes = 0
    for (const [index, item] of retained.entries()) {
      const bytes = Buffer.byteLength(item.text, 'utf8')
      if (bytes > longestBytes) {
        longestBytes = bytes
        longestIndex = index
      }
    }
    if (longestIndex < 0 || longestBytes === 0) return undefined
    const overflow = size() - maxBytes
    const target = Math.max(0, longestBytes - overflow)
    const item = retained[longestIndex]
    /* v8 ignore next 3 -- longestIndex was selected from this exact array's entries. */
    if (item === undefined) {
      throw new Error('session-reference retention selected a missing longest message')
    }
    const shortened = truncateWithNotice(item.originalText, target)
    /* v8 ignore next -- strictly lowering the byte target must change a complete-string retention result. */
    if (shortened.text === retained[longestIndex]?.text) return undefined
    retained[longestIndex] = { ...item, text: shortened.text, omittedBytes: shortened.omittedBytes }
  }

  const compacted = original.some(item => item.checkpoint)
  const retainedOmittedBytes = retained.reduce((sum, item) => sum + item.omittedBytes, 0)
  const omittedBytes = retainedOmittedBytes + droppedOmittedBytes
  return {
    data: data(),
    stats: {
      compacted,
      originalMessages: original.length,
      retainedMessages: retained.length,
      omittedMessages,
      omittedBytes,
      truncated: omittedMessages > 0 || omittedBytes > 0,
    },
  }
}

function textContent(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

function truncateWithNotice(text: string, maxOutputBytes: number): { text: string; omittedBytes: number } {
  /* v8 ignore next -- callers invoke this only with a target smaller than the selected original text. */
  if (Buffer.byteLength(text, 'utf8') <= maxOutputBytes) return { text, omittedBytes: 0 }
  let low = 0
  let high = maxOutputBytes
  let best = { text: '', omittedBytes: Buffer.byteLength(text, 'utf8') }
  while (low <= high) {
    const retainedBytes = Math.floor((low + high) / 2)
    const headBytes = Math.ceil(retainedBytes / 2)
    const tailBytes = Math.floor(retainedBytes / 2)
    const retainer = new TextRetainer({ kind: 'headTail', headBytes, tailBytes })
    retainer.push(text)
    const result = retainer.finish()
    // The complete source string was pushed before `finish()`, so omission is exact.
    /* v8 ignore next 3 -- complete-string TextRetainer input cannot report a lower bound. */
    if (result.omittedBytes.kind !== 'exact') {
      throw new Error('session-reference retention did not report exact omitted bytes')
    }
    const omitted = result.omittedBytes.count
    const candidate = `${result.text}\n[… omitted ${omitted} UTF-8 bytes …]`
    if (Buffer.byteLength(candidate, 'utf8') <= maxOutputBytes) {
      best = { text: candidate, omittedBytes: omitted }
      low = retainedBytes + 1
    } else {
      high = retainedBytes - 1
    }
  }
  return best
}
