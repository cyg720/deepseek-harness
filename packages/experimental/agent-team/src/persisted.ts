/** Short-lived read-handle access to persisted Team member Sessions. */

/*
 * 【文件职责】通过短期持久化读句柄读取团队成员会话，返回脱离句柄的头部及完整已提交日志。
 */

import type { SessionEvent, SessionHeader, SessionId , SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** One persisted Session's detached header and complete committed event log. */
export interface PersistedSessionView {
  /** Exact fork-inherited event count paired with `header`. */
  readonly inheritedEventCount: SessionLogOffset
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
}

/**
 * Read one stored session's header and complete event log through a
 * short-lived read handle, closing the handle before returning.
 * @param persistence - the durable session store.
 * @param id - the stored session to read.
 * @param signal - cancellation observed by open and read.
 * @returns the stored header and every committed event.
 */
export async function readPersistedSession(
  persistence: SessionPersistence,
  id: SessionId,
  signal: AbortSignal,
): Promise<PersistedSessionView> {
  const handle = await persistence.open(id, 'read', { signal })
  try {
    return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, events: await handle.read(0, undefined, { signal }) }
  } finally {
    await handle.close()
  }
}
