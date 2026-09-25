/**
 * 轮次过程行与收尾行。
 *
 * 过程行给出「第 N 轮（· 步骤 M）」坐标与已知活动计数，并按会话+轮次保存展开状态；
 * 收尾行只陈述本轮事实：成功、被停止、失败、截断、没有最终回答，指标缺值时不补 0。
 */
import type { ReactNode } from 'react'
import { useCallback, useSyncExternalStore } from 'react'
import type {
  ChatTurnProcessPresentation, TurnProcessChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { clsx } from 'clsx'
import { processFoldKey } from './process-fold.ts'
import type { QsRowProps } from './rows.tsx'
import { visibleNode } from './adapter.ts'
import {
  hasMetrics, hasProcessActivity, hasTurnDiagnostic, nodeTurn, turnMetrics, turnProcessModel,
  turnTailState, type TurnTailState,
} from './turn-view-model.ts'
import styles from './transcript.module.css'

/** 活动计数的展示项。 */
interface ActivityItem {
  readonly key: string
  readonly label: string
  readonly value: number
}

/**
 * 收尾状态的文案键。
 * @param state - 收尾状态。
 * @returns 本地化键。
 */
function tailStateKey(state: TurnTailState): 'row.running' | 'row.settled' | 'row.interrupted' | 'row.turnFailed' | 'row.turnTruncated' | 'row.turnNoAnswer' {
  if (state === 'ok') return 'row.settled'
  if (state === 'stopped') return 'row.interrupted'
  if (state === 'failed') return 'row.turnFailed'
  if (state === 'truncated') return 'row.turnTruncated'
  if (state === 'empty') return 'row.turnNoAnswer'
  return 'row.running'
}

/**
 * 渲染轮次过程行。
 * @param props - 行座席、会话身份与折叠状态。
 * @returns 过程行；节点不可见或不是过程节点时为 null。
 */
export function ProcessRow({ nodeKey, useNode, useProcess, sessionId, fold, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  // 非过程节点用 -1 占位：只有 turn-process 行会渲染折叠按钮，占位值不会被写入存储。
  const turn = useNode(nodeKey, value => (value?.kind === 'turn-process' ? (value.data as TurnProcessChatData).turn : -1))
  const process: ChatTurnProcessPresentation | undefined = useProcess(nodeKey, value => value)
  const key = processFoldKey(sessionId, turn, process?.spec.answerStep ?? null)
  const subscribe = useCallback((listener: () => void) => fold.subscribe(listener), [fold])
  const open = useSyncExternalStore(subscribe, () => fold.isOpen(key))
  if (node?.kind !== 'turn-process') return null
  const data = node.data as TurnProcessChatData
  const model = turnProcessModel(process, data, node.location)
  const items: ActivityItem[] = []
  if (model.tools > 0) items.push({ key: 'tools', label: t('row.tools'), value: model.tools })
  if (model.messages > 0) items.push({ key: 'messages', label: t('row.messages'), value: model.messages })
  if (model.agents > 0) items.push({ key: 'agents', label: t('row.agents'), value: model.agents })
  const expandable = hasProcessActivity(model)
  return (
    <div className={clsx(styles.message, styles.processSummary)} data-qs-process data-turn={model.turn}>
      <button
        type="button"
        className="qs-text-button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => { fold.set(key, !open) }}
      >
        {t('row.turn', { turn: model.turn })}
        {model.step === null ? null : ` · ${t('row.step', { step: model.step })}`}
      </button>
      <span className={styles.muted}>{t(model.running ? 'row.running' : 'row.settled')}</span>
      {open && expandable ? (
        <ul className={styles.activity}>
          {items.map(item => (
            <li key={item.key}>{item.label}：{item.value}</li>
          ))}
          <li className={styles.muted}>{t('row.processDetailHint')}</li>
        </ul>
      ) : (
        <span className={styles.muted}>
          {expandable
            ? items.map(item => `${item.label} ${item.value}`).join(' · ')
            : t('row.noActivity')}
        </span>
      )}
    </div>
  )
}

/**
 * 渲染轮次收尾行。
 * @param props - 行座席与 locale 座席。
 * @returns 收尾行；节点不可见、不是收尾节点或没有最终回答时为 null。
 */
export function TailRow({ nodeKey, useNode, useChat, renderSlot, renderSlotChain, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  const turn = node === undefined ? undefined : nodeTurn(node.location)
  const failed = useChat(snapshot => (turn === undefined ? false : hasTurnDiagnostic(snapshot.nodes.values(), turn, 'turn-error')))
  const truncated = useChat(snapshot => (turn === undefined ? false : hasTurnDiagnostic(snapshot.nodes.values(), turn, 'turn-max-tokens')))
  if (node?.kind !== 'turn-tail') return null
  const data = node.data as TurnTailChatData
  const state = turnTailState(data, { failed, truncated })
  const metrics = turnMetrics(data)
  const location = node.location
  const turnLocation = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
  return (
    <footer className={clsx(styles.message, styles.processSummary)} data-qs-turn-tail data-state={state}>
      {turnLocation === undefined ? null : renderSlotChain('qs.chat.turn-tail', {
        turn: turnLocation, seq: data.closing?.finalNode.seq ?? data.seq,
      })}
      <span>{t(tailStateKey(state))}</span>
      {hasMetrics(metrics) ? (
        <>
          {metrics.tokens === undefined ? null : <span>{t('row.tokens')}: {metrics.tokens}</span>}
          {/* 单位与数值布局归本地化字典，避免在 JSX 中固定语言。 */}
          {metrics.ttftMs === undefined ? null : <span>{t('row.ttft')}: {t('row.milliseconds', { value: Math.round(metrics.ttftMs) })}</span>}
          {metrics.tokensPerSecond === undefined ? null : <span>{t('row.tps')}: {Math.round(metrics.tokensPerSecond)}</span>}
        </>
      ) : <span className={styles.muted}>{t('row.noMetrics')}</span>}
      {data.branchUnavailable ? <span className={styles.muted}>{t('row.branchUnavailable')}</span> : null}
      {data.closing?.finalNode.messageId === undefined ? null : renderSlot('qs.chat.assistant-actions', { messageId: data.closing.finalNode.messageId })}
    </footer>
  )
}
