import { useState, type ReactNode } from 'react'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import a11yCss from './accessibility.module.css'
import css from './GenericCommandCard.module.css'

/** 中文说明：类型或类 CommandRowState 约束本文件的数据或组件职责。 */
type CommandRowState = 'running' | 'ok' | 'error'

/** Node state → row state semantic (running while unsettled; outcome kind after). */
/* 中文说明：函数 stateOf 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

/** 中文说明：函数 leadingFor 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function leadingFor(state: CommandRowState): ReactNode {
  return state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
/* 中文说明：类型或类 GenericCommandCardProps 约束本文件的数据或组件职责。 */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

/** 中文说明：函数 GenericCommandCard 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
export function GenericCommandCard({ node, t, runningSummary }: GenericCommandCardProps) {
  /** 中文说明：当前组件的局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  /** 中文说明：当前组件的局部值 text，由紧邻初始化决定。 */
  const text = node.outcome?.text
  /** 中文说明：当前组件的局部值 summary，由紧邻初始化决定。 */
  const summary = node.outcome === null
    ? runningSummary ?? t('command.running')
    : text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
  // The summary already carries the settlement text, so the title is the bare
  // command name.
  const title = node.name ?? t('command.title')
  /** 中文说明：当前组件的局部值 state，由紧邻初始化决定。 */
  const state = stateOf(node.outcome)
  /** 中文说明：当前组件的局部值 body，由紧邻初始化决定。 */
  const body = text !== undefined && text.includes('\n') ? text : null
  /** 中文说明：当前组件的局部值 open，由紧邻初始化决定。 */
  const open = expanded && body !== null
  return (
    <div className={css.root} data-variant="others" data-state={state}>
      {state === 'running' && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      {state === 'error' && <span className={a11yCss.visuallyHidden}>{t('row.failed')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={leadingFor(state)}
        title={title}
        open={open}
        expandable={body !== null}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-error={state === 'error' || undefined}>{summary}</span>
          </>
        )}
      >
        <pre className={css.body} data-error={state === 'error' || undefined}>{body}</pre>
      </DisclosureRow>
    </div>
  )
}
