/** 未知工具的兜底卡：只展示持久参数与结果，并给出可见限制说明。 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { DisclosureRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { callHead, contentSummary, isSettled, parseArgs } from '../raw-tool-call.ts'
import { errorOf } from '../tool-view-model.ts'
import styles from '../tool.module.css'

/** 兜底卡输入：该调用的持久块与翻译座席。 */
export interface GenericToolCardProps {
  /** 运行头或结算结果。 */
  readonly block: ToolCallBlock
  /** 翻译座席。 */
  readonly t: TranslateNS<'qs-ui-tool'>
}

/** 子组件只在展开后挂载，避免父组件创建 JSX 时就解析和序列化原始载荷。 */
function RawDetail({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  return <DisclosureRow icon={null} title={title} open={open} expandable expandOnRowClick
    onToggle={() => { setOpen(!open) }}>{children}</DisclosureRow>
}

/** 参数格式化归已展开的组件所有；断行不修改正文，无效 JSON 仍完整显示原文。 */
function ArgumentContent({ raw }: { readonly raw: string }): ReactNode {
  const args = parseArgs(raw)
  return <pre className={`${styles.pre} ${styles.argumentsPre}`}>{args === undefined ? raw : JSON.stringify(args, null, 2)}</pre>
}

/** 非文本结果只作转义后的 JSON 展示，不装载其中的媒体或执行内容。 */
function NonTextContent({ values }: { readonly values: readonly unknown[] }): ReactNode {
  return <pre className={styles.pre} data-qs-tool-nontext>{JSON.stringify(values, null, 2)}</pre>
}

/**
 * 渲染兜底卡。
 *
 * 参数只在可解析时结构化展示，否则按原始文本展示；非文本结果给出类型说明并以
 * 转义文本给出原始内容，绝不执行或解析其中任何内容。
 * @param props - 调用块与翻译座席。
 * @returns 兜底卡节点。
 */
export function GenericToolCard({ block, t }: GenericToolCardProps): ReactNode {
  const head = callHead(block)
  const summary = isSettled(block) ? contentSummary(block.content) : undefined
  const error = errorOf(block)
  return (
    <div className={styles.card} data-qs-tool-generic>
      {head === undefined ? <p className={styles.notice}>{t('row.orphan')}</p> : null}
      {error === undefined ? null : (
        <p role="alert" className={styles.error}>
          {t('row.error', { name: error.name, code: error.code })}
        </p>
      )}
      {summary === undefined ? <p className={styles.notice}>{t('row.noResult')}</p> : null}
      {summary !== undefined && summary.text !== '' ? <pre className={styles.pre} data-qs-tool-result>{summary.text}</pre> : null}
      {summary !== undefined && summary.text === '' && summary.nonTextKinds.length === 0
        ? <p className={styles.notice}>{t('row.emptyResult')}</p>
        : null}
      {summary === undefined || summary.nonTextKinds.length === 0
        ? null
        : <p className={styles.notice} data-qs-tool-nontext-kind>{summary.nonTextKinds.map(kind => t('row.nonText', { kind })).join(' ')}</p>}
      {summary === undefined || summary.nonTextRaw.length === 0
        ? null
        : <RawDetail title={t('row.result')}><NonTextContent values={summary.nonTextRaw} /></RawDetail>}
      {head === undefined || head.argsRaw === '' ? null : (
        <RawDetail title={t('row.argsRaw')}><ArgumentContent raw={head.argsRaw} /></RawDetail>
      )}
    </div>
  )
}
