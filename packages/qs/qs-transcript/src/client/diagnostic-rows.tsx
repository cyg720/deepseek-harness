/**
 * 诊断行：模型重试、终态失败与输出上限。
 *
 * 三行各自独立注册（`model-retry`、`turn-error`、`turn-max-tokens`），互不合并：失败与截断
 * 是不同事实，重试行只陈述阶段。这里没有任何按钮——失败页不接历史重放或重复执行，
 * 重试等待到期也不触发发送。
 */
import type { ReactNode } from 'react'
import type { RetryChatData, TurnErrorNode, TurnMaxTokensNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { clsx } from 'clsx'
import type { QsRowProps } from './rows.tsx'
import { visibleNode } from './adapter.ts'
import { maxTokensModel, retryModel, turnErrorModel, type RetryState } from './diagnostic-view-model.ts'
import styles from './transcript.module.css'

/**
 * 重试阶段文案键。
 * @param state - 重试阶段。
 * @returns 本地化键。
 */
function retryStateKey(state: RetryState): 'diag.retryScheduled' | 'diag.retryStarted' | 'diag.retryCancelled' {
  if (state === 'scheduled') return 'diag.retryScheduled'
  if (state === 'started') return 'diag.retryStarted'
  return 'diag.retryCancelled'
}

/**
 * 重试行的进度文案：无上限策略不显示分母。
 * @param attempt - 当前尝试序号。
 * @param maximum - 策略上限。
 * @param t - 翻译座席。
 * @returns 进度文案。
 */
function retryBudget(attempt: number, maximum: number | undefined, t: QsRowProps['t']): string {
  return maximum === undefined
    ? t('diag.retryUnbounded', { retry: attempt })
    : t('diag.retryBudget', { retry: attempt, maximum })
}

/**
 * 渲染模型重试行。
 * @param props - 行座席与 locale 座席。
 * @returns 重试行；节点不可见或不是重试节点时为 null。
 */
export function RetryRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'model-retry') return null
  const model = retryModel(node.data as RetryChatData)
  return (
    <article className={clsx(styles.message, styles.diagnostic)} data-qs-model-retry data-state={model.state}>
      <header className={styles.diagHead}>
        <span className={styles.stateText}>{t('diag.retryTitle')}</span>
        <small>{retryBudget(model.attempt, model.maximum, t)}</small>
      </header>
      <p>{t(retryStateKey(model.state), { attempt: model.attempt })}</p>
      <p className={styles.muted}>
        {t('diag.provider', { provider: model.provider })} · {t('diag.delay', { seconds: Math.round(model.delayMs / 100) / 10 })}
        {model.attempts > 1 ? ` · ${t('diag.retryChain', { count: model.attempts })}` : null}
      </p>
      <details className={styles.disclosure}>
        <summary>{t('diag.reason')}</summary>
        <pre className={styles.detailBody}>
          {model.failure === undefined
            ? t('diag.noReason')
            : `${model.failure.code}${model.failure.message === '' ? '' : `: ${model.failure.message}`}`}
        </pre>
      </details>
    </article>
  )
}

/**
 * 渲染终态失败行。
 * @param props - 行座席与 locale 座席。
 * @returns 失败行；节点不可见或不是失败节点时为 null。
 */
export function TurnErrorRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'turn-error') return null
  const model = turnErrorModel(node.data as TurnErrorNode)
  return (
    <article className={clsx(styles.message, styles.diagnostic)} data-qs-turn-error role="alert">
      <header className={styles.diagHead}>
        <span>{t('diag.errorTitle')}</span>
        {model.code === undefined ? null : <code>{model.code}</code>}
      </header>
      {model.message === '' ? null : <p>{model.message}</p>}
      <p className={styles.muted}>{t('diag.errorHint')}</p>
    </article>
  )
}

/**
 * 渲染输出上限行。
 * @param props - 行座席与 locale 座席。
 * @returns 上限行；节点不可见或不是上限节点时为 null。
 */
export function MaxTokensRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'turn-max-tokens') return null
  maxTokensModel(node.data as TurnMaxTokensNode)
  return (
    <article className={clsx(styles.message, styles.diagnostic)} data-qs-turn-max-tokens>
      <header className={styles.diagHead}>
        <span>{t('diag.maxTokensTitle')}</span>
      </header>
      <p>{t('diag.maxTokensHint')}</p>
    </article>
  )
}
