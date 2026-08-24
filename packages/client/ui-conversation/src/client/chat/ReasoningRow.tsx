/** Assistant reasoning disclosure, independent of Tool-call presentation. */
/**
 * 文件职责：实现会话聊天界面的 ReasoningRow 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示并操作会话聊天相关状态。
 * 逻辑维度：读取属性与状态，派生展示数据并响应交互。
 * 关键边界：异步状态、可访问性标签和空数据分支必须保持一致。
 * 新手阅读建议：先读 Props，再看局部状态、effect 和 JSX。
 */
import { useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

/** 中文说明：函数 firstLine 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function firstLine(text: string): string {
  /** 中文说明：当前组件的局部值 newline，由紧邻初始化决定。 */
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** 中文说明：函数 latestLine 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function latestLine(text: string): string {
  /** 中文说明：当前组件的局部值 visible，由紧邻初始化决定。 */
  const visible = text.trimEnd()
  /** 中文说明：当前组件的局部值 newline，由紧邻初始化决定。 */
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
/** 中文说明：函数 ReasoningRow 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  /** 中文说明：当前组件的局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  /** 中文说明：当前组件的局部值 summaryRef，由紧邻初始化决定。 */
  const summaryRef = useRef<HTMLSpanElement>(null)
  /** 中文说明：当前组件的局部值 summary，由紧邻初始化决定。 */
  const summary = running ? latestLine(text) : firstLine(text)
  /** 中文说明：当前组件的局部值 scheduleSummaryScroll，由紧邻初始化决定。 */
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    /** 中文说明：当前组件的局部值 element，由紧邻初始化决定。 */
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
