/**
 * 工具行外壳：状态点、标题、摘要与展开区。
 *
 * 状态同时用颜色与文字表达（颜色点 + 本地化状态文本），不只用红绿区分；
 * 展开/收起走官方 `DisclosureRow`，键盘与 aria-expanded 由它维护。
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { DisclosureRow, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { clsx } from 'clsx'
import type { QsToolState } from './tool-view-model.ts'
import styles from './tool.module.css'

/**
 * 呈现状态到状态点语义的映射：进行中、失败、警告（已中断）、完成。
 * @param state - 工具呈现状态。
 * @returns 状态点语义。
 */
export function dotState(state: QsToolState): StateDotState {
  if (state === 'running') return 'ongoing'
  if (state === 'error') return 'error'
  if (state === 'stopped') return 'warning'
  return 'done'
}

/** 工具行外壳的输入。 */
export interface QsToolRowChromeProps {
  /** 呈现状态。 */
  readonly state: QsToolState
  /** 已本地化的状态文本。 */
  readonly stateLabel: string
  /** 行标题：工具名或兜底标题。 */
  readonly title: string
  /** 折叠行摘要。 */
  readonly summary?: string | undefined
  /** 折叠行尾部指标（例如改动行数或耗时）。 */
  readonly meta?: string | undefined
  /** 展开区内容；缺席表示本行不可展开。 */
  readonly body?: ReactNode
  /** 是否为子调用（缩进显示）。 */
  readonly nested?: boolean | undefined
  /** 初值是否展开。 */
  readonly defaultOpen?: boolean | undefined
}

/**
 * 渲染一个工具行。
 * @param props - 状态、标题、摘要与展开区。
 * @returns 工具行节点。
 */
export function QsToolRowChrome({
  state, stateLabel, title, summary, meta, body, nested = false, defaultOpen = false,
}: QsToolRowChromeProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen)
  const collapsed = (
    <>
      <span className={styles.state} data-qs-tool-state={state}>{stateLabel}</span>
      {summary === undefined ? null : <span className={styles.summary}>{summary}</span>}
      {meta === undefined ? null : <span className={styles.meta}>{meta}</span>}
    </>
  )
  return (
    <div className={clsx(styles.row, nested && styles.nested)} data-qs-tool data-state={state}>
      <DisclosureRow
        icon={<StateDot state={dotState(state)} />}
        title={title}
        open={open}
        expandable={body !== undefined}
        onToggle={() => { setOpen(!open) }}
        expandOnRowClick
        keepContentWhenOpen
        collapsedContent={collapsed}
      >
        <div className={styles.body}>{body}</div>
      </DisclosureRow>
    </div>
  )
}
