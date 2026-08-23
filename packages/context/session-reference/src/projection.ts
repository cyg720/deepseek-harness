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

/** Current-surface projection and byte-bounded rendering. */

import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import type { SessionSurfaceSnapshot } from '@deepseek-ai/dsh-session-query'
import { assertNever } from '@deepseek-ai/dsh-llm'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'
import { stringifyTagSafeJson } from './serialization.ts'
import type { ReferencedConversationItem } from './types.ts'

/** 投影过程的内部条目：比公开类型多出 checkpoint 标记与原始文本/省略字节。 */
interface ProjectedItem extends ReferencedConversationItem {
  /** 是否为压缩检查点消息（永不丢弃）。 */
  checkpoint: boolean
  /** 裁剪前的原始文本（用于统计被省略的字节）。 */
  originalText: string
  /** 该条消息在文本截断阶段被省略的字节数。 */
  omittedBytes: number
}

/** Snapshot data serialized inside the untrusted prompt. */
/** 序列化进不可信提示词封套的快照数据：会话元信息 + 对话投影。 */
export interface ReferencedSessionData {
  sessionId: string
  label: string
  cwd: string | null
  capturedThroughSeq: number | null
  conversation: ReferencedConversationItem[]
}

/** Retention facts stored beside the durable context. */
/** 保留统计：与持久化上下文一起存放，供日志与诊断使用。 */
export interface ReferenceRetentionStats {
  compacted: boolean
  originalMessages: number
  retainedMessages: number
  omittedMessages: number
  omittedBytes: number
  truncated: boolean
}

/** Project current user/assistant conversation while excluding tools, reasoning, and injected context. */
/** 把表面快照投影成用户/助手纯文本对话：工具结果、推理与注入上下文一律排除。 */
function projectSessionConversation(snapshot: SessionSurfaceSnapshot): ProjectedItem[] {
  const conversation: ProjectedItem[] = []
  for (const event of snapshot.events) {
    switch (event.type) {
      case 'user/message': {
        // 压缩检查点消息要保留（它是会话摘要锚点）；其余非用户来源（注入上下文）跳过
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
/**
 * 把一份投影快照塞进精确的渲染 JSON 字节上限：第一阶段优先丢弃
 * 非检查点消息（保留最新消息），第二阶段对剩余最长消息做头尾保留式截断。
 * @param snapshot 当前表面的来源观测（事件流 + 会话元信息）
 * @param label 宿主办的展示标签，随来源一起序列化
 * @param maxBytes 序列化数据对象的最大 UTF-8 字节数
 * @returns 保留的数据与统计；固定字段本身就超预算时返回 undefined
 */
export function retainReferencedSession(
  snapshot: SessionSurfaceSnapshot,
  label: string,
  maxBytes: number,
): { data: ReferencedSessionData; stats: ReferenceRetentionStats } | undefined {
  const original = projectSessionConversation(snapshot)
  // retained 是可变工作副本，原始投影 original 保留用于最终统计
  const retained = original.map(item => ({ ...item }))
  let omittedMessages = 0
  let droppedOmittedBytes = 0
  // data()/size() 做成函数：每次裁剪后都要重新序列化量尺寸
  const data = (): ReferencedSessionData => ({
    sessionId: snapshot.session.id,
    label,
    cwd: snapshot.session.cwd ?? null,
    capturedThroughSeq: snapshot.capturedThroughSeq,
    conversation: retained.map(({ role, text }) => ({ role, text })),
  })
  const size = (): number => Buffer.byteLength(stringifyTagSafeJson(data()), 'utf8')

  // 第一阶段：超预算就丢消息——优先丢非检查点的（最新一条永远保留）
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

  // 第二阶段：仍超预算就截断文本——每次砍当前最长的一条，头尾保留并附省略提示
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

/**
 * 提取内容块中的全部文本并换行连接：只取 type 为 text 的块，其他类型跳过。
 * @param content 消息内容块数组（含文本/图片等类型）
 * @returns 拼接后的纯文本（可能为空字符串）
 */
function textContent(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

/**
 * 头尾保留式截断文本：保留开头与结尾（headTail 模式），中间省略的部分
 * 用省略提示标注；二分查找能放进预算的最大保留字节数。
 * @param text 原始完整文本
 * @param maxOutputBytes 截断结果的字节上限（含省略提示本身）
 * @returns 截断后的文本与省略的字节数
 */
function truncateWithNotice(text: string, maxOutputBytes: number): { text: string; omittedBytes: number } {
  /* v8 ignore next -- callers invoke this only with a target smaller than the selected original text. */
  if (Buffer.byteLength(text, 'utf8') <= maxOutputBytes) return { text, omittedBytes: 0 }
  let low = 0
  let high = maxOutputBytes
  // best 保存"能放进预算"的最大候选；omittedBytes 初值 = 全文字节数（最坏全删）
  let best = { text: '', omittedBytes: Buffer.byteLength(text, 'utf8') }
  while (low <= high) {
    const retainedBytes = Math.floor((low + high) / 2)
    // headTail 模式：头部多留一个字节，尾部少留一个（对称取整）
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
    // 候选文本 = 保留部分 + 省略字节数提示（提示本身也占预算）
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
