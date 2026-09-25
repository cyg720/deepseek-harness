/** 输入区通过官方会话输入动作提交，创建操作由挂载实例持有。 */
import type { KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { QsComposerProps, QsCommandInputBridge } from './contract.ts'
import {
  isBlankSubmission, isHandoffReady, nextOpId, shouldSubmitOnEnter,
} from './handoff.ts'
import { QsIcon } from './Icon.tsx'
import styles from './composer.module.css'
import { ContextPressure } from './ContextPressure.tsx'

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
    useQsBlocked, useQsPreparation, useQsConnected, useQsNotice, useQsModel, loadModel, useSessionPendingInteraction,
  } = props

  const inputElement = useRef<HTMLTextAreaElement | null>(null)
  const composing = useRef(false)
  const commandBridge = useRef<QsCommandInputBridge | undefined>(undefined)
  const bindCommandInput = useCallback((bridge: QsCommandInputBridge): (() => void) => {
    commandBridge.current = bridge
    return () => { if (commandBridge.current === bridge) commandBridge.current = undefined }
  }, [])
  useLayoutEffect(() => props.acquireTriggerConsumer?.(), [props.acquireTriggerConsumer])
  // 引用与附件保留结构身份；纯文本命令的 claim 由官方输入机随草稿更新和提交。
  const structured = useInput(state => state.occurrences.length > 0 || state.attachmentIds.length > 0)
  const blocked = useQsBlocked(value => value)
  const preparation = useQsPreparation(value => value)
  const connected = useQsConnected(value => value)
  const notice = useQsNotice(value => value)
  const model = useQsModel(value => value)
  const promptError = useSession(state => state.promptError?.error.message)
  const agentError = useSession(state => state.lastAgentError)
  const phase = useInput(state => state.phase)
  const pending = useSessionPendingInteraction(map => sessionId === undefined ? undefined : map.get(sessionId))
  // 与官方一致：可续聊子会话只有父级明确可用时才能输入；未知不表述为离线。
  const childInputBlocked = useSession(state => state.subagent?.address.mode === 'continuable' && state.subagent.parentAvailable !== true)
  const blockedReason = structured ? t('input.structuredDraft') : !connected ? t('input.disconnected') : blocked ?? (childInputBlocked ? t('input.childParentRequired') : pending === undefined ? undefined : t('input.blocked'))
  const unavailable = blockedReason !== undefined || preparation !== undefined || phase === 'adjudicating' || phase === 'submitting'
  useEffect(() => { loadModel() }, [loadModel])
  const local = useQsComposer(s => s)
  const inputDraft = useInput(state => state.draft)
  const queue = useQsQueue(rows => rows)
  const sessionRunning = useSession(state => state.running)
  const primaryMode = props.useQsSubmitMode(value => value)
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<'queue' | 'create' | undefined>(undefined)
  const [queueBusy, setQueueBusy] = useState(false)
  const queueBusyRef = useRef(false)
  const sequence = useRef(0)
  const pendingRef = useRef<PendingSend | undefined>(undefined)

  const freezeAction = useRef(setFrozen)
  freezeAction.current = setFrozen
  useEffect(() => () => { pendingRef.current?.controller.abort(); pendingRef.current = undefined; freezeAction.current(undefined) }, [])
  const frozen = local.frozen
  const creating = frozen && local.freezeReason === 'sending'
  const sendLabel = creating ? t('input.sending') : !sessionRunning ? t('input.send')
    : t(primaryMode === 'steer' ? 'input.sendSteer' : 'input.sendQueue')
  const boundDraft = inputActions === undefined
    ? (local.unownedDraft === '' ? draft : local.unownedDraft)
    : (inputDraft ?? '')

  const writeDraft = (text: string): void => {
    if (structured || frozen) return
    setFailed(undefined)
    if (inputActions !== undefined) {
      inputActions.setDraft(text)
      return
    }
    setDraft(text)
    setUnownedDraft(text)
  }

  const submit = (gesture: Parameters<QsComposerProps['submitGesture']>[0] = 'enter'): void => {
    if (pendingRef.current !== undefined || frozen || unavailable) return
    if (isBlankSubmission(boundDraft)) {
      // 空草稿的加速手势交给官方整队引导，普通发送仍是空操作。
      if (gesture === 'accelerated' && inputActions !== undefined && sessionRunning) props.submitGesture(gesture)
      return
    }
    const text = boundDraft
    if (inputActions !== undefined) {
      // 有会话时按共享偏好解析投递；输入机仍负责命令仲裁及最终提交。
      inputActions.setDraft(text)
      props.submitGesture(gesture)
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
    if (blockedReason !== undefined || preparation?.pending === false) {
      pending.controller.abort()
      pendingRef.current = undefined
      if (sessionId === pending.requestedSessionId && inputActions !== undefined) {
        inputActions.setDraft(pending.text)
        setUnownedDraft('')
      }
      setFrozen(undefined)
      return
    }
    // 会话组成尚在准备时保留同一次交接；成功更新准备源后再提交原草稿。
    if (preparation !== undefined) return
    // 先收窄动作类型；未物化时继续保留交接操作。
    const actions = inputActions
    if (actions === undefined) return
    if (!isHandoffReady({
      pendingOpId: pending.opId,
      currentOpId: pending.opId,
      requestedSessionId: pending.requestedSessionId,
      currentSessionId: sessionId,
      hasInputActions: true,
    })) return
    if (unavailable) return
    pendingRef.current = undefined
    actions.setDraft(pending.text)
    actions.submit()
    setDraft('')
    setUnownedDraft('')
    setFrozen(undefined)
  }, [sessionId, inputActions, setFrozen, setUnownedDraft, unavailable, blockedReason, preparation])

  const cancelPending = (): void => {
    if (pendingRef.current === undefined) return
    // 提交前取消：使本次操作失效并解冻；**不撤销**已发出的 create。
    pendingRef.current.controller.abort()
    pendingRef.current = undefined
    setFrozen(undefined)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // 菜单已经消费的按键不能再次落到普通发送；修饰键保留浏览器/换行语义。
    if (!frozen && !structured && !unavailable && !event.shiftKey && (event.key === 'Enter' || (!event.ctrlKey && !event.metaKey && !event.altKey))) {
      const keys: Partial<Record<string, Parameters<QsCommandInputBridge['arbitrate']>[0]>> = { ArrowUp: 'up', ArrowDown: 'down', Enter: 'enter', Escape: 'escape', Tab: 'tab' } as const
      const key = keys[event.key]
      const isComposing = composing.current || event.nativeEvent.isComposing
      if (key !== undefined && commandBridge.current !== undefined) {
        if (commandBridge.current.arbitrate(key, isComposing) !== 'pass') { event.preventDefault(); return }
      }
      if (event.key === ' ' && !isComposing && commandBridge.current?.space()) { event.preventDefault(); return }
    }

    if (!shouldSubmitOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: composing.current || event.nativeEvent.isComposing,
    })) return
    event.preventDefault()
    // 与官方编辑器一致：长按 Enter 的重复事件不再次发送同一草稿。
    if (event.repeat) return
    submit(event.ctrlKey || event.metaKey ? 'accelerated' : 'enter')
  }

  const onQueueAction = async (itemId: string, work: () => Promise<boolean>): Promise<void> => {
    // 与官方队列一致串行提交；同步锁覆盖失焦与点击在同一次渲染前连续触发的情况。
    if (queueBusyRef.current) return
    queueBusyRef.current = true
    setQueueBusy(true)
    setFailed(undefined)
    try {
      if (!await work()) setFailed('queue')
    } catch (error) {
      // 操作失败时任务保留：不本地删除、不改排序，只提示。
      console.error('qs-composer: queue action failed', itemId, error)
      setFailed('queue')
    } finally {
      queueBusyRef.current = false
      setQueueBusy(false)
    }
  }

  return (
    <div className={styles.shell}>
      {queue.length === 0 ? null : (
        <section className={styles.queue} data-qs-queue aria-label={t('input.queueTitle')}>
          <div className={styles.queueTitle}>{t('input.queueTitle')}</div>
          {queue.map(row => (
            <div key={row.id} className={styles.queueRow} data-qs-queue-item={row.id}>
              <input className={styles.queueText} aria-label={t('input.queueEdit')} defaultValue={row.text} readOnly={!row.editable || queueBusy}
                key={`${row.id}:${row.text}`} onBlur={(event) => {
                  const text = event.target.value
                  if (text.trim() !== '' && text !== row.text) void onQueueAction(row.id, () => editQueueItem(row.id, text))
                }} />
              <button
                type="button"
                className="qs-text-button"
                title={t('input.queueSteer')}
                disabled={!sessionRunning || queueBusy}
                onClick={() => { void onQueueAction(row.id, () => steerQueueItem(row.id)) }}
              >
                {t('input.queueSteer')}
              </button>
              <button
                type="button"
                className="qs-text-button"
                title={t('input.queueRemove')}
                disabled={queueBusy}
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
        {sessionId === undefined ? null : props.renderSlot('qs.composer.overlay', {
          inputElement, composing, frozen, bindCommandInput, acquireFreeze: props.acquireFreeze,
        })}
        <textarea
          id="qs-composer-input"
          ref={inputElement}
          className={styles.input}
          placeholder={t('input.placeholder')}
          value={boundDraft}
          readOnly={frozen || structured}
          disabled={childInputBlocked}
          onChange={(event) => {
            writeDraft(event.target.value)
            commandBridge.current?.track(event.currentTarget.selectionEnd, composing.current || frozen)
          }}
          onSelect={(event) => { commandBridge.current?.track(event.currentTarget.selectionEnd, composing.current || frozen) }}
          onCompositionStart={(event) => { composing.current = true; commandBridge.current?.track(event.currentTarget.selectionEnd, true) }}
          onCompositionEnd={(event) => {
            composing.current = false
            commandBridge.current?.track(event.currentTarget.selectionEnd, frozen)
          }}
          onKeyDown={onKeyDown}
        />
        <ContextPressure useProjection={props.useProjection} t={t} />
        <div className={styles.bottom}>
          <div className={styles.left}>
            {sessionId === undefined ? <span className={styles.model}>{model ?? t('input.model')}</span>
              : props.renderSlot('qs.composer.model', { locked: frozen || unavailable || structured === true })}
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
              aria-label={sendLabel}
              title={sendLabel}
              disabled={frozen || unavailable || isBlankSubmission(boundDraft)}
              onClick={() => { submit() }}
            >
              <QsIcon name="up" size="sm" />
            </button>
            {creating ? (
              <button type="button" className="qs-text-button" onClick={cancelPending}>
                {t('input.cancel')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {blockedReason === undefined ? null : <p role="status">{blockedReason}</p>}
      {preparation === undefined ? null : <p role="status">{preparation.reason}</p>}
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
