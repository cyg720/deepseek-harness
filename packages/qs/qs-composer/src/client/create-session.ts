/** Cancellable first-send navigation over the official Session service. */
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Create or adopt an identity without overriding a newer navigation intent.
 * @param sessions - Authoritative creation, selection, and list feed.
 * @param id - Reserved identity reused after failure.
 * @param signal - Local cancellation; it does not revoke Host creation.
 * @param disposed - Whether the owning plugin has unloaded.
 * @returns The opened identity, or undefined when its navigation was cancelled.
 * @throws The original creation failure; an error carrying an id is not success.
 */
export async function createForSend(
  sessions: Pick<ISessions, 'list' | 'create' | 'open'>,
  id: SessionId,
  signal: AbortSignal,
  disposed: () => boolean,
): Promise<SessionId | undefined> {
  const cancelled = (): boolean => signal.aborted || disposed()
  if (cancelled()) return undefined
  const initial = sessions.list.getSnapshot().current
  const navigation = { changed: false }
  const detach = sessions.list.subscribe(() => {
    if (sessions.list.getSnapshot().current !== initial) navigation.changed = true
  })
  try {
    const created = await sessions.create({ sessionId: id })
    if (cancelled() || navigation.changed) return undefined
    detach()
    sessions.open(created)
    return created
  } finally {
    detach()
  }
}
