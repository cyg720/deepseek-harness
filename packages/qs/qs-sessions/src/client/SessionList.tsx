/**
 * 会话列表。
 *
 * 分组：置顶（本地）与最近（服务端顺序）。归档是**集合**，因此两组都要按
 * `archivedSessionIds` 过滤，否则归档后的会话仍然显示。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { QsSessionListProps, QsSessionsLocaleKey, SessionRowView } from './contract.ts'
import { groupSessions } from './pins-store.ts'
import { QsIcon } from './Icon.tsx'
import { SessionMenu } from './SessionMenu.tsx'
import styles from './sessions.module.css'

/**
 * 渲染会话列表。
 * @param props - owner、store、inject 与 locale 四份共享面。
 * @returns 列表节点。
 */
export function SessionList(props: QsSessionListProps): ReactNode {
  const {
    t, useSessions, useStore, useQsArchivedSessions, useSessionPendingInteraction,
    selectSession, createSession, renameSession, archiveSession, canArchive,
  } = props
  const creation = useRef<AbortController | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [createFailed, setCreateFailed] = useState(false)
  useEffect(() => () => { creation.current?.abort() }, [])
  const create = async (): Promise<void> => {
    if (creation.current !== undefined) return
    const controller = new AbortController()
    creation.current = controller
    setCreating(true)
    setCreateFailed(false)
    try {
      const ok = await createSession(controller.signal)
      if (!controller.signal.aborted) setCreateFailed(!ok)
    } catch {
      // A failed creation remains retryable in the mounted navigation.
      if (!controller.signal.aborted) setCreateFailed(true)
    } finally {
      creation.current = undefined
      if (!controller.signal.aborted) setCreating(false)
    }
  }
  const [menuFor, setMenuFor] = useState<SessionId | undefined>(undefined)
  const createRef = useRef(create)
  createRef.current = create
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k' || event.repeat || event.isComposing) return
      if (document.querySelector('dialog[open]') !== null) return
      event.preventDefault()
      void createRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [])

  const ids = useSessions(s => s.ids)
  const current = useSessions(s => s.current)
  const titles = useSessions((s) => {
    const map: Record<string, string> = {}
    for (const id of s.ids) map[id] = s.byId[id]?.displayTitle ?? String(id)
    return map
  })
  const running = useSessions((s) => {
    const set = new Set<SessionId>()
    for (const id of s.ids) if (s.byId[id]?.running === true) set.add(id)
    return set
  })
  const pinned = useStore(s => s.pinned)
  const actionsStore = props.actions
  const archived = useQsArchivedSessions(list => list)
  const groups = groupSessions({ ids, titles, running, pinned, archived })
  const pending = useSessionPendingInteraction(map => new Set(map.keys()))

  const section = (titleKey: QsSessionsLocaleKey, rows: readonly SessionRowView[]): ReactNode => {
    if (rows.length === 0) return null
    return (
      <div className={styles.section} key={titleKey}>
        <div className={`qs-section-heading ${styles.heading}`}>
          <span>{t(titleKey)}</span>
          <span>{String(rows.length).padStart(2, '0')}</span>
        </div>
        {rows.map(row => (
          <div key={row.id} className={`${styles.row} ${row.id === current ? styles.rowActive : ''}`}>
            <button
              type="button"
              className={styles.link}
              data-qs-session={row.id}
              aria-current={row.id === current ? 'true' : undefined}
              onClick={() => { selectSession(row.id) }}
            >
              <QsIcon name={row.pinned ? 'pin' : 'chat'} size="xs" />
              <span className={styles.linkLabel}>{row.title}</span>
              {row.running ? <span className={styles.running} aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              className={`qs-icon-button ${styles.more}`}
              aria-label={`${t('row.manage')} ${row.title}`}
              onClick={() => { setMenuFor(row.id) }}
            >
              <QsIcon name="more" size="xs" />
            </button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles.list} data-qs-session-list>
      <button type="button" className={styles.newChat} disabled={creating} onClick={() => { void create() }}>
        <QsIcon name="plus" size="xs" />
        <span className={styles.newLabel}>{t('list.new')}</span>
        <span className={styles.shortcut}>{t('list.newShortcut')}</span>
      </button>
      {createFailed ? <p role="alert" className={styles.menuError}>{t('error.generic')}</p> : null}
      {ids.length === 0 ? (
        <p className={styles.empty}>
          <strong>{t('list.empty')}</strong>
          {t('list.emptyLead')}
        </p>
      ) : (
        <>
          {section('group.pinned', groups.pinned)}
          {section('group.recent', groups.recent)}
        </>
      )}
      {menuFor === undefined ? null : (
        <SessionMenu
          key={menuFor}
          sessionId={menuFor}
          title={titles[menuFor] ?? String(menuFor)}
          pinned={pinned.includes(menuFor)}
          archivable={canArchive(menuFor, pending)}
          actions={{
            togglePin: (id) => { actionsStore.toggle(id) },
            renameSession,
            archiveSession: async (id) => {
              const ok = await archiveSession(id)
              // 归档成功的会话一并清掉本地置顶：置顶与归档冲突时以归档为准。
              if (ok) actionsStore.forget(id)
              return ok
            },
          }}
          onClose={() => { setMenuFor(undefined) }}
          t={t}
        />
      )}
    </div>
  )
}
