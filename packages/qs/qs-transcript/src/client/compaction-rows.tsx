/** 压缩展示只读官方关联投影，不重放命令，也不隐藏原始转写历史。 */
import { useState, type ReactNode } from 'react'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { QsRowProps } from './rows.tsx'
import { visibleNode } from './adapter.ts'
import styles from './transcript.module.css'

/** 已落地摘要按需挂载；缺窗与真实零值保持不同含义。 */
function CompactionSummary({ data, t }: { data: CompactionSummaryNode; t: QsRowProps['t'] }): ReactNode {
  const [open, setOpen] = useState(false)
  return <section className={styles.message} data-qs-compaction>
    <strong>{t('compact.landed')}</strong>
    <p>{data.shadowedItemCount !== null && data.shadowedTokenCount !== null
      ? t('compact.counts', { items: data.shadowedItemCount, tokens: data.shadowedTokenCount })
      : t('compact.noCounts')}</p>
    <p>{t('compact.historyRetained')}</p>
    {data.summary === null ? <p>{t('compact.unavailable')}</p> : <>
      <button type="button" className="qs-text-button" aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}>{t('compact.expand')}</button>
      {open ? <div className={styles.detailBody}>{data.summary}</div> : null}
    </>}
  </section>
}

/**
 * 显示官方已落地的自动压缩摘要，不读取 checkpoint 的模型指令信封。
 * @param props - 转写行座席。
 * @returns 压缩标记；种类变化或隐藏后为空。
 */
export function CompactionRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'compaction') return null
  const data = node.data as ChatNode<'compaction'>['data']
  return <CompactionSummary data={data} t={t} />
}

/**
 * 使用官方 command/checkpoint 关联结果呈现一次手动压缩。
 * @param props - 转写行座席。
 * @returns 命令状态和至多一个落地标记。
 */
export function ManualCompactionRow({ nodeKey, useNode, t }: QsRowProps): ReactNode {
  const node = useNode(nodeKey, visibleNode)
  if (node?.kind !== 'manual-compaction') return null
  const { command, compaction } = node.data as ChatNode<'manual-compaction'>['data']
  // 有结算但缺 checkpoint 时不宣称压缩成功；错误文本始终保留，取消原因由 Host 结算提供。
  const outcome = command.outcome
  return <div data-qs-manual-compaction>
    {compaction === null || outcome?.kind === 'error' ? <section className={styles.message}>
      <strong>{t(outcome === null ? 'compact.running' : outcome.kind === 'error' ? 'compact.failed' : 'compact.noCheckpoint')}</strong>
      {outcome?.text === undefined ? null : <div className={styles.detailBody}>{outcome.text}</div>}
    </section> : null}
    {compaction === null ? null : <CompactionSummary data={compaction} t={t} />}
  </div>
}
