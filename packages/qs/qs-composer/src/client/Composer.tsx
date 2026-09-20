/** 输入区通过官方会话输入动作提交，创建操作由挂载实例持有。 */
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { QsComposerProps } from './contract.ts'
import {
  isBlankSubmission, isHandoffReady, nextOpId, shouldSubmitOnEnter,
} from './handoff.ts'
import { QsIcon } from './Icon.tsx'
import styles from './composer.module.css'

/** 建议 chips（点击**填入草稿**，不直接发送）。 */
const SUGGESTION_KEYS = ['input.suggestion1', 'input.suggestion2', 'input.suggestion3'] as const

/** 无会话路径的在途操作。 */
interface PendingSend {
  readonly controller: AbortController
  readonly opId: string
  readonly text: string
  readonly requestedSessionId: string
}

/**
 * 渲染输入区。
 * @param props - owner、inject 与 locale 三份共享面（草稿与输入机状态来自会话座席）。
 * @returns 输入区节点。
 */
export function Composer(props: QsComposerProps): ReactNode {
  const {
    t, useInput, useSession, inputActions, sessionId, stop,
    useQsComposer, useQsQueue, createSession, reserveSessionId, setUnownedDraft, setFrozen,
    removeQueueItem, steerQueueItem, editQueueItem,
    useQsBlocked, useQsConnected, useQsNotice, useQsModel, loadModel, useSessionPendingInteraction,
  } = props

  const blocked = useQsBlocked(value => value)
  const connected = useQsConnected(value => value)
  const notice = useQsNotice(value => value)
  const model = useQsModel(value => value)
  const promptError = useSession(state => state.promptError?.error.message)
  const agentError = useSession(state => state.lastAgentError)
  const phase = useInput(state => state.phase)
  const pending = useSessionPendingInteraction(map => sessionId === undefined ? undefined : map.get(sessionId))
  const blockedReason = !connected ? t('input.disconnected') : blocked ?? (pending === undefined ? undefined : t('input.blocked'))
  const unavailable = blockedReason !== undefined || phase === 'adjudicating' || phase === 'submitting'
  useEffect(() => { loadModel() }, [loadModel])
  const local = useQsComposer(s => s)
  const inputDraft = useInput(state => state.draft)
  const queue = useQsQueue(rows => rows)
  const sessionRunning = useSession(state => state.running)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<'queue' | 'create' | undefined>(undefined)
  const sequence = useRef(0)
  const pendingRef = useRef<PendingSend | undefined>(undefined)

  const freezeAction = useRef(setFrozen)
  freezeAction.current = setFrozen
  useEffect(() => () => { pendingRef.current?.controller.abort(); pendingRef.current = undefined; freezeAction.current(undefined) }, [])
  const frozen = local.frozen
  const boundDraft = inputActions === undefined
    ? (local.unownedDraft === '' ? draft : local.unownedDraft)
    : (inputDraft ?? '')

  const writeDraft = (text: string): void => {
    setFailed(undefined)
    if (inputActions !== undefined) {
      inputActions.setDraft(text)
      return
    }
    setDraft(text)
    setUnownedDraft(text)
  }

  const submit = (): void => {
    if (pendingRef.current !== undefined || frozen || unavailable || isBlankSubmission(boundDraft)) return
    const text = boundDraft
    if (inputActions !== undefined) {
      // 有会话：交给官方输入机。运行中提交由 submit('queue') 固定成排队。
      inputActions.setDraft(text)
      inputActions.submit()
      return
    }
    const opId = nextOpId(++sequence.current)
    const requestedSessionId = reserveSessionId()
    const controller = new AbortController()
    pendingRef.current = { opId, text, requestedSessionId, controller }
    setFrozen('sending')
    void createSession(requestedSessionId, controller.signal).catch(() => undefined).then((created) => {
      if (created === undefined) {
        // 明确失败：保留草稿与同一预分配 id，解冻；不生成第二个 id。
        if (pendingRef.current?.opId !== opId) return
        pendingRef.current = undefined
        setFrozen(undefined)
        setFailed('create')
      }
    })
  }

  // 无会话路径的交接：等"请求的会话成为当前会话 + 输入动作已物化 + 操作仍有效"。
  useEffect(() => {
    const pending = pendingRef.current
    if (pending === undefined) return
    if (blockedReason !== undefined) {
      pending.controller.abort()
      pendingRef.current = undefined
      if (sessionId === pending.requestedSessionId && inputActions !== undefined) {
        inputActions.setDraft(pending.text)
        setUnownedDraft('')
      }
      setFrozen(undefined)
      return
    }
    if (!isHandoffReady({
      pendingOpId: pending.opId,
      currentOpId: pending.opId,
      requestedSessionId: pending.requestedSessionId,
      currentSessionId: sessionId,
      hasInputActions: inputActions !== undefined,
    })) return
    if (unavailable) return
    const actions = inputActions
    if (actions === undefined) return
    pendingRef.current = undefined
    actions.setDraft(pending.text)
    actions.submit()
    setDraft('')
    setUnownedDraft('')
    setFrozen(undefined)
  }, [sessionId, inputActions, setFrozen, setUnownedDraft, unavailable, blockedReason])

  const cancelPending = (): void => {
    if (pendingRef.current === undefined) return
    // 提交前取消：使本次操作失效并解冻；**不撤销**已发出的 create。
    pendingRef.current.controller.abort()
    pendingRef.current = undefined
    setFrozen(undefined)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!shouldSubmitOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    })) return
    event.preventDefault()
    submit()
  }

  const onQueueAction = async (itemId: string, work: () => Promise<boolean>): Promise<void> => {
    setFailed(undefined)
    try {
      if (!await work()) setFailed('queue')
    } catch (error) {
      // 操作失败时任务保留：不本地删除、不改排序，只提示。
      console.error('qs-composer: queue action failed', itemId, error)
      setFailed('queue')
    }
  }

  return (
    <div className={styles.shell}>
      {queue.length === 0 ? null : (
        <section className={styles.queue} data-qs-queue aria-label={t('input.queueTitle')}>
          <div className={styles.queueTitle}>{t('input.queueTitle')}</div>
          {queue.map(row => (
            <div key={row.id} className={styles.queueRow} data-qs-queue-item={row.id}>
              <input className={styles.queueText} aria-label={t('input.queueEdit')} defaultValue={row.text} readOnly={!row.editable}
                key={`${row.id}:${row.text}`} onBlur={(event) => {
                  const text = event.target.value
                  if (text.trim() !== '' && text !== row.text) void onQueueAction(row.id, () => editQueueItem(row.id, text))
                }} />
              <button
                type="button"
                className="qs-text-button"
                title={t('input.queueSteer')}
                disabled={!sessionRunning}
                onClick={() => { void onQueueAction(row.id, () => steerQueueItem(row.id)) }}
              >
                {t('input.queueSteer')}
              </button>
              <button
                type="button"
                className="qs-text-button"
                title={t('input.queueRemove')}
                onClick={() => { void onQueueAction(row.id, () => removeQueueItem(row.id)) }}
              >
                {t('input.queueRemove')}
              </button>
            </div>
          ))}
        </section>
      )}
      <div className={styles.card}>
        <label htmlFor="qs-composer-input" className="qs-sr-only">{t('input.placeholder')}</label>
        <textarea
          id="qs-composer-input"
          className={styles.input}
          placeholder={t('input.placeholder')}
          value={boundDraft}
          readOnly={frozen}
          onChange={(event) => { writeDraft(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        <div className={styles.bottom}>
          <div className={styles.left}>
            <span className={styles.model}>{model ?? t('input.model')}</span>
            <button type="button" className="qs-text-button" disabled title={t('input.attachment')}>{t('input.attachment')}</button>
          </div>
          <div className={styles.right}>
            {sessionRunning ? null : <span className={styles.hint}>{t('input.stopNote')}</span>}
            {sessionRunning ? (
              <button
                type="button"
                className={`${styles.action} ${styles.stop}`}
                aria-label={t('input.stop')}
                title={t('input.stop')}
                onClick={stop}
              >
                <QsIcon name="stop" size="sm" />
              </button>
            ) : null}
            <button
              type="button"
              className={styles.action}
              aria-label={frozen ? t('input.sending') : t('input.send')}
              title={frozen ? t('input.sending') : t('input.send')}
              disabled={frozen || unavailable || isBlankSubmission(boundDraft)}
              onClick={submit}
            >
              <QsIcon name="up" size="sm" />
            </button>
            {frozen ? (
              <button type="button" className="qs-text-button" onClick={cancelPending}>
                {t('input.cancel')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {blockedReason === undefined ? null : <p role="status">{blockedReason}</p>}
      {notice === undefined && promptError === undefined && agentError == null ? null : <p role="alert" className={styles.error}>{notice ?? promptError ?? agentError}</p>}
      {failed === undefined ? null : (
        <p className={styles.error} role="alert">
          {t(failed === 'queue' ? 'input.queueFailed' : 'input.createFailed')}
        </p>
      )}
      <div className={styles.suggestions}>
        {SUGGESTION_KEYS.map(key => (
          <button
            key={key}
            type="button"
            className={styles.suggestion}
            disabled={frozen}
            onClick={() => { writeDraft(t(key)) }}
          >
            <QsIcon name="spark" size="xs" />
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}
