/** Assistant reasoning disclosure, independent of Tool-call presentation. */

/*
 * 【文件职责】把助手推理内容呈现为独立可展开行，流式运行状态使用 Conversation 的本地化文案。
 */

import { useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
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
/* 中文说明：函数 ReasoningRow 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  /** 中文说明：当前组件的局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  const summary = running ? latestLine(text) : firstLine(text)

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-follow-end={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
