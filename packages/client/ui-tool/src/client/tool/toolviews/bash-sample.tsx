// Bash toolview registrant: third-party posture over the keyed toolview hole
// (ctx.slots.register + ToolRowProps only — never imports the chat domain).
// Product chrome matches ToolRow / Think (figma: Bash · {description}).
//
// A bash call normally declares the terminal render intent, so this row renders
// the command's own output through TerminalBlock. Execution failures that
// settle without terminal material use the bounded generic IN/OUT fallback —
// both are expand-gated exactly like
// ToolRow's unified interaction: collapsed by default, the whole summary row
// is the toggle (click / Enter / Space, icon→chevron hover preview; the
// summary stays inline while open),
// and the expanded card max-height-scrolls inside its own surface with the
// full output (maxLines Infinity — no middle collapse). An error row's
// collapsed summary is the failure's first line in the error color.
/**
 * 文件职责：实现工具调用的 bash-sample 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import { useState, type KeyboardEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import clsx from 'clsx'
import {
  IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { terminalBlockLabels, terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './bash-sample.module.css'

/** Bash row props: the toolview runtime share plus the standard locale seat. */
/* 中文说明：类型或类 BashRowProps 约束工具或轨迹数据职责。 */
type BashRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** 中文说明：函数 leadingFor 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function leadingFor(state: ToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    // Running keeps the icon — the row sweep carries the in-flight signal.
    default: return <IconApiOutline14 size={14} />
  }
}

/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
/* 中文说明：函数 stateStatus 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function stateStatus(state: ToolRowState, t: BashRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('bash.running')
    case 'error': return t('bash.failed')
    case 'stopped': return t('bash.stopped')
    default: return null
  }
}

/**
 * Bash row: icon + Bash · {description} in the shared ToolRow chrome, the
 * whole row toggling the command's terminal or generic error card (ToolRow's unified
 * expand interaction, replicated locally per the registrant posture).
 */
/* 中文说明：函数 BashRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t }: BashRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block)
  // Session workspace root: the terminal view's cwd resolves against it (an
  // omitted workdir IS the workspace), which the pure presenter cannot do.
  /** 中文说明：视图局部值 cwd，由紧邻初始化决定。 */
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  /** 中文说明：视图局部值 terminal，由紧邻初始化决定。 */
  const terminal = terminalCardModel(block, cwd)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  /** 中文说明：视图局部值 state，由紧邻初始化决定。 */
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  /** 中文说明：视图局部值 status，由紧邻初始化决定。 */
  const status = stateStatus(state, t)
  /** 中文说明：视图局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  // Execution failures (for example cancellation before the process reports a
  // terminal result) use the generic presenter. Keep their recorded args and
  // full error reachable instead of collapsing the row to the first line.
  /** 中文说明：视图局部值 genericError，由紧邻初始化决定。 */
  const genericError = terminal === null
    && model.state === 'error'
    && (model.body !== null || model.output !== null)
  /** 中文说明：视图局部值 expandable，由紧邻初始化决定。 */
  const expandable = terminal !== null || genericError
  /** 中文说明：视图局部值 open，由紧邻初始化决定。 */
  const open = expanded && expandable
  /** 中文说明：视图局部值 failureLine，由紧邻初始化决定。 */
  const failureLine = model.state === 'error' ? model.errorSummary : null
  /** 中文说明：视图局部值 toggleExpand，由紧邻初始化决定。 */
  const toggleExpand = () => {
    setExpanded(v => !v)
  }
  /** 中文说明：视图局部值 toggleFromKeyboard，由紧邻初始化决定。 */
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  /** 中文说明：视图局部值 leading，由紧邻初始化决定。 */
  const leading = open
    ? <IconChevronDownOutline14 className={css.chevron} />
    : expandable
      ? (
        <>
          <span className={css.iconIdle}>{leadingFor(state)}</span>
          <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />
        </>
      )
      : leadingFor(state)
  return (
    <div className={css.card}>
      <div
        className={css.root}
        data-sample="bash"
        data-variant="bash"
        data-state={state}
        data-expandable={expandable || undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? toggleExpand : undefined}
        onKeyDown={expandable ? toggleFromKeyboard : undefined}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null && <span className={css.visuallyHidden}>{status}</span>}
        <span className={css.title}>{model.title}</span>
        <span className={css.sep} aria-hidden />
        {/* The terminal presenter's description is the contractual
            above-card summary; a failure's first line outranks both. */}
        <span className={clsx(css.summary, failureLine !== null && css.errorSummary)}>
          {failureLine ?? terminal?.description ?? model.summary}
        </span>
      </div>
      {open && (
        /* Same hover-Inspect posture as ToolRow's expanded body, replicated
           locally per the registrant posture. */
        <div className={css.bodyWrap}>
          {terminal !== null
            ? (
              <TerminalBlock
                {...terminal.card}
                maxLines={Infinity}
                labels={terminalBlockLabels(t)}
                className={css.terminal}
              />
            )
            : (
              <div className={css.ioCard}>
                {model.body !== null && (
                  <div className={css.ioSection}>
                    <span className={css.ioLabel}>IN</span>
                    <span className={css.ioText}>{model.body}</span>
                  </div>
                )}
                {model.body !== null && model.output !== null && (
                  <span className={css.ioDivider} aria-hidden />
                )}
                {model.output !== null && (
                  <div className={css.ioSection}>
                    <span className={css.ioLabel}>OUT</span>
                    <span className={css.ioText} data-error>
                      {model.output}
                    </span>
                  </div>
                )}
              </div>
            )}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The sample as a plain registrant plugin. Slot injection follows the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
/* 中文说明：视图局部值 bashToolviewSample，由紧邻初始化决定。 */
export const bashToolviewSample = {
  name: 'bash-toolview-sample',
  inject: ['slots'],
  /**
   * Register the bash row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow))
  },
}
