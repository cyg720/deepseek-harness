/**
 * 审批卡。
 *
 * 挂在消息流末尾的 `qs.stage.interaction`（chain）。**chain 条目崩溃不退位**：
 * 框架不会换下一个候选，所以本卡自带错误提示与重试，并保证请求在重试前一直有效。
 *
 * 详情：`callId` 经本条目 inject face 的索引座席解析回工具调用，取到工具名与原始
 * 参数；解析不到时走安全文本兜底（只显示工具名与原因），不编造命令。
 *
 * 生命周期：视图卸载**不**答复请求（切会话、HMR 都只是重建视图）；提交后立即禁用，
 * 避免快速重复点击造成二次答复。
 *
 * 请求隔离：chain 的渲染 key 是**插件条目**而不是请求 key，所以同一会话从请求 A 换成
 * 请求 B 时本组件不会卸载。内部状态放在以 `matched.key` 为 key 的内层组件上，
 * 换请求即重置——否则 B 会继承 A 的"提交中/失败"状态。
 */
import { useRef, useState, type ReactNode } from 'react'
import { deriveApprovalDetail } from './approval-detail.ts'
import type { QsApprovalCardProps } from './contract.ts'
import styles from './approval.module.css'

/**
 * 渲染审批卡。
 * @param props - chain 选举出的待答复请求、详情索引座席与语言座席。
 * @returns 审批卡节点。
 */
export function ApprovalCard(props: QsApprovalCardProps): ReactNode {
  // 以请求 key 重挂内层：换请求不继承上一条的提交中/失败/禁用状态。
  return <ApprovalCardBody key={props.matched.key} {...props} />
}

/** 单条请求的卡片主体；其状态生命周期与 `matched.key` 一致。 */
function ApprovalCardBody({ matched, useApprovalDetail, t }: QsApprovalCardProps): ReactNode {
  // 同步锁先于 React 提交状态生效，阻止同批事件重复答复。
  const submittingRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState<'allowed-once' | 'rejected' | undefined>(undefined)
  // 只读自己那个 callId：索引按会话整体发布，卡片按 id 取用。
  const callId = matched.callId === undefined ? undefined : String(matched.callId)
  const call = useApprovalDetail(index => (callId === undefined ? undefined : index.get(callId)))
  const detail = deriveApprovalDetail(matched, call)

  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFailed(undefined)
    matched.answer(outcome).catch((error: unknown) => {
      // 答复失败时请求仍然 pending，恢复可点击并提示，让用户可以重试。
      console.error('qs-approval: answer failed', error)
      setFailed(outcome)
      submittingRef.current = false
      setSubmitting(false)
    })
  }

  return (
    <section className={styles.card} data-qs-approval-card aria-labelledby="qs-approval-title">
      <div className={styles.eyebrow}>
        <span className={styles.dot} aria-hidden="true" />
        {t('card.eyebrow')}
      </div>
      <h3 id="qs-approval-title">{t('card.title')}</h3>
      <p className={styles.description}>{detail.toolName}</p>
      <div className={styles.detail} tabIndex={0} role="region" aria-label={t('card.args')}>
        <dl>
          <dt>{t('card.reason')}</dt>
          <dd>{detail.reason ?? '—'}</dd>
          <dt>{t('card.detailTarget')}</dt>
          <dd>{detail.callId ?? t('card.detailFallback')}</dd>
        </dl>
        {detail.argsRaw === undefined ? (
          <p className={styles.fallback}>{t('card.detailFallback')}</p>
        ) : (
          <>
            <p className={styles.argsLabel}>{t('card.args')}</p>
            <pre className={styles.args}>{detail.argsRaw}</pre>
          </>
        )}
      </div>
      {failed ? (
        <p className={styles.error} role="alert">{t('card.error')}</p>
      ) : (
        <p className={styles.note}>{t('card.pendingNote')}</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={`qs-btn ${styles.reject}`}
          disabled={submitting}
          onClick={() => { answer('rejected') }}
        >
          {failed === 'rejected' ? t('card.retry') : t('card.reject')}
        </button>
        <button
          type="button"
          className="qs-btn qs-btn-primary"
          disabled={submitting}
          onClick={() => { answer('allowed-once') }}
        >
          {submitting ? t('card.submitting') : t(failed === 'allowed-once' ? 'card.retry' : 'card.allow')}
        </button>
      </div>
    </section>
  )
}
