// Queue dock entry: renders the authoritative transient inbox snapshot and
// addresses per-row mutations through the session-scoped conversation face.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
/**
 * 文件职责：实现会话队列中的 QueueDock 组件。
 * 技术维度：React、TypeScript、Cordis 插槽、响应式状态和 CSS Modules。
 * 产品维度：支持用户查看和操作会话队列。
 * 逻辑维度：读取属性与服务，派生显示状态，处理事件并渲染界面。
 * 关键边界：空状态、禁用状态、异步取消和可访问性属性必须一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useId, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconQueueOutline14, IconSendOutline14, IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueAction, QueueItemId } from '../contract/queue.ts'
import { NS } from '../locales.ts'
import css from './QueueDock.module.css'

/** Queue operations injected by the session-scoped registration. */
/* 中文说明：类型或类 QueueDockInjected 约束本文件的数据或组件职责。 */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
/* 中文说明：类型或类 QueueDockProps 约束本文件的数据或组件职责。 */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

/**
 * Queue strip: one item renders directly; multiple items default to a
 * collapsible count header; an empty queue renders nothing.
 */
/* 中文说明：函数 QueueDock 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
export function QueueDock({ useSession, updateQueue, notify, t }: QueueDockProps) {
  /** 中文说明：组件局部值 inbox，取值由紧邻初始化决定。 */
  const inbox = useSession(s => s.queue)
  /** 中文说明：组件局部值 queue，取值由紧邻初始化决定。 */
  const queue = useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
  /** 中文说明：组件局部值 running，取值由紧邻初始化决定。 */
  const running = useSession(s => s.running)
  /** 中文说明：组件局部值 queueMutable，取值由紧邻初始化决定。 */
  const queueMutable = useSession(s => s.subagent === null)
  /** 中文说明：组件局部值 [editing, setEditing]，取值由紧邻初始化决定。 */
  const [editing, setEditing] = useState<{ id: QueueItemId; text: string } | null>(null)
  /** 中文说明：组件局部值 [busy, setBusy]，取值由紧邻初始化决定。 */
  const [busy, setBusy] = useState<QueueItemId | null>(null)
  /** 中文说明：组件局部值 [collapsed, setCollapsed]，取值由紧邻初始化决定。 */
  const [collapsed, setCollapsed] = useState(true)
  /** 中文说明：有序集合 listId，取值由紧邻初始化决定。 */
  const listId = useId()

  useEffect(() => {
    if (queue.length === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
  }, [collapsed, editing, queue, queueMutable])

  if (queue.length === 0) return null

  /** 中文说明：组件局部值 interactionActive，取值由紧邻初始化决定。 */
  const interactionActive = queueMutable && (editing !== null || busy !== null)
  /** 中文说明：组件局部值 expanded，取值由紧邻初始化决定。 */
  const expanded = !collapsed || interactionActive
  /** 中文说明：有序集合 listVisible，取值由紧邻初始化决定。 */
  const listVisible = queue.length === 1 || expanded

  /** 中文说明：组件局部值 applyAction，取值由紧邻初始化决定。 */
  const applyAction = async (
    itemId: QueueItemId,
    action: QueueAction,
    failure: string,
  ): Promise<boolean> => {
    setBusy(itemId)
    try {
      await updateQueue(itemId, action)
      return true
    } catch {
      notify('error', failure)
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }

  /** 中文说明：组件局部值 saveEdit，取值由紧邻初始化决定。 */
  const saveEdit = async (): Promise<void> => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(
      editing.id,
      { kind: 'edit', content: [{ type: 'text', text: editing.text }] },
      t('queue.editFailed'),
    )) setEditing(null)
  }

  return (
    <div className={css.dock} data-queue-dock="">
      <div className={css.panel}>
        {queue.length > 1 && (
          <button
            type="button"
            className={css.header}
            aria-controls={listId}
            aria-expanded={expanded}
            disabled={interactionActive}
            onClick={() => { setCollapsed(value => !value) }}
          >
            <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>
            <span className={css.count}>{t('queue.count', { n: queue.length })}</span>
            <span className={css.chevron} aria-hidden>
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
            </span>
          </button>
        )}
        <ul id={listId} className={css.list} hidden={!listVisible}>
          {listVisible && queue.map(row => (
            <li key={row.id} className={css.row}>
              {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
              {queue.length === 1 && <span className={css.lead} aria-hidden><IconQueueOutline14 /></span>}
              {editing?.id === row.id
                ? (
                  <input
                    autoFocus
                    className={css.editor}
                    aria-label={t('queue.edit')}
                    value={editing.text}
                    onChange={(event) => { setEditing({ id: row.id, text: event.currentTarget.value }) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setEditing(null)
                        return
                      }
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void saveEdit()
                      }
                    }}
                  />
                )
                : <span className={css.preview}>{row.preview}</span>}
              {queueMutable && <div className={css.actions}>
                {editing?.id === row.id
                  ? (
                    <>
                      <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.save')}
                          disabled={busy !== null || editing.text.trim() === ''}
                          onClick={() => { void saveEdit() }}
                        >
                          <IconCheckOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.cancelEdit')}
                          disabled={busy !== null}
                          onClick={() => { setEditing(null) }}
                        >
                          <IconCloseOutline16 size={14} />
                        </button>
                      </Tooltip>
                    </>
                  )
                  : (
                    <>
                      <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.edit')}
                          // Disabled buttons fire no hover events, so the
                          // unsupported hint stays a native title.
                          title={row.text === null ? t('queue.edit.unsupported') : undefined}
                          disabled={busy !== null || row.text === null}
                          onClick={() => {
                            if (row.text !== null) setEditing({ id: row.id, text: row.text })
                          }}
                        >
                          <IconEditOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.remove')}
                          disabled={busy !== null}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'remove' },
                              t('queue.removeFailed'),
                            )
                          }}
                        >
                          <IconTrashOutline16 size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                        <button
                          type="button"
                          className={css.action}
                          aria-label={t('queue.steer')}
                          title={running ? undefined : t('queue.steer.unavailable')}
                          disabled={busy !== null || !running}
                          onClick={() => {
                            void applyAction(
                              row.id,
                              { kind: 'steer' },
                              t('queue.steerFailed'),
                            )
                          }}
                        >
                          <IconSendOutline14 />
                        </button>
                      </Tooltip>
                    </>
                  )}
              </div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
/* 中文说明：组件局部值 queueDockEntry，取值由紧邻初始化决定。 */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions'],
  /**
   * Register the queue strip as the terminal input-dock entry (order 20).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        /** 中文说明：组件局部值 actx，取值由紧邻初始化决定。 */
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        /** 中文说明：组件局部值 conversation，取值由紧邻初始化决定。 */
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
        }
      },
    }, QueueDock))
  },
}
