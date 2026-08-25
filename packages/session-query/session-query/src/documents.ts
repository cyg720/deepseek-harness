/*
 * ================================ 文件注释 ================================
 * 【文件职责】共享的事件元数据与语义文档投影：把原始日志投影成轻量"表面感知"
 *   事件记录与可搜索的语义文档。
 * 【技术维度】用 dsh-session 的 foldSurface 对事件做"当前/被遮蔽/仅日志"三态分类；
 *   语义文本经 extraction.ts 提取（结构性事件被剔除）。
 * 【产品维度】全文检索与事件过滤共用的第一方文档形状。
 * 【逻辑维度】buildSessionEventRecords → buildSessionEventSearchDocuments → classifySurface。
 * 【关键边界】表面折叠失败映射为 SESSION_QUERY_INVALID_SURFACE。
 * 【新手阅读建议】对照 types.ts 的 SessionEventSurface 三态阅读 classifySurface。
 * ==========================================================================
 */

/** Shared event metadata and semantic-document projection. */

import { foldSurface } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventRecord, SessionEventSearchDocument, SessionEventSurface } from './types.ts'
import { SessionQueryError } from './config.ts'
import { extractSessionEventText } from './extraction.ts'

/**
 * Project a raw log into lightweight surface-aware event records.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns one record per event in ascending seq order.
 */
// 中文：把原始日志投影为轻量"表面感知"事件记录（升序）；表面三态经一次折叠得到。
export function buildSessionEventRecords(
  sessionId: SessionId,
  events: readonly SessionEvent[],
): SessionEventRecord[] {
  const surfaceBySeq = classifySurface(events)
  return events.map(event => ({
    sessionId,
    seq: event.seq,
    type: event.type,
    time: event.time,
    surface: surfaceBySeq.get(event.seq) ?? 'log-only',
  }))
}

/**
 * Build first-party semantic documents for one complete raw event log.
 * @param sessionId - session that owns the log.
 * @param events - complete contiguous raw event log.
 * @returns searchable documents in ascending seq order; structural events are omitted.
 */
export function buildSessionEventSearchDocuments(
  sessionId: SessionId,
  events: readonly SessionEvent[],
): SessionEventSearchDocument[] {
  const surfaceBySeq = classifySurface(events)
  const documents: SessionEventSearchDocument[] = []
  for (const event of events) {
    const text = extractSessionEventText(event)
    if (text.length === 0) continue
    documents.push({
      sessionId,
      seq: event.seq,
      type: event.type,
      time: event.time,
      surface: surfaceBySeq.get(event.seq) ?? 'log-only',
      text,
    })
  }
  return documents
}

function classifySurface(events: readonly SessionEvent[]): Map<number, SessionEventSurface> {
  let folded: ReturnType<typeof foldSurface>
  try {
    folded = foldSurface(events)
  } catch (error: unknown) {
    throw new SessionQueryError(
      /* v8 ignore next -- foldSurface throws Error instances */
      `invalid session surface: ${error instanceof Error ? error.message : 'unknown error'}`,
      'SESSION_QUERY_INVALID_SURFACE',
      { cause: error },
    )
  }
  const result = new Map<number, SessionEventSurface>()
  for (const seq of folded.nodes) result.set(seq, 'current')
  for (const replacement of folded.replacements) {
    for (const seq of replacement.shadowedSeqs) result.set(seq, 'shadowed')
  }
  return result
}
