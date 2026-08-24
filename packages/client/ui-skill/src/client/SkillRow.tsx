// Skill toolview registrant: a domain-owned row over the keyed toolview hole.
// The compact accent row keeps loaded instructions scannable in the transcript;
// the exact durable tool output remains available in a bounded disclosure card.
/**
 * 文件职责：实现技能入口的 SkillRow 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：帮助用户查看或调整技能入口。
 * 逻辑维度：读取状态，派生展示信息并处理交互。
 * 关键边界：父子作用域、空状态、可访问性和主题同步必须正确。
 * 新手阅读建议：先读 Props，再看派生值、effect 和 JSX。
 */

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconSkillOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillRow.module.css'

/** Skill row lifecycle derived solely from the durable call slice. */
/** 中文说明：类型或类 SkillRowState 约束模块数据或组件职责。 */
type SkillRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full row props: the toolview runtime share plus this package's locale seat. */
/** 中文说明：类型或类 SkillRowProps 约束模块数据或组件职责。 */
type SkillRowProps = ToolCallViewProps & PropsLocale<'skill'>

/** Compact, replay-stable view model for the dedicated row. */
/** 中文说明：类型或类 SkillRowModel 约束模块数据或组件职责。 */
interface SkillRowModel {
  readonly name: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: SkillRowState
}

/** First physical line for the collapsed error summary and malformed-args fallback. */
/** 中文说明：函数 firstLine 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function firstLine(text: string): string {
  /** 中文说明：组件局部值 newline，由紧邻初始化决定。 */
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Skill names are the only call argument the compact row presents. */
/** 中文说明：函数 skillName 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function skillName(argsRaw: string, callId: string): string {
  try {
    /** 中文说明：组件局部值 parsed，由紧邻初始化决定。 */
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      /** 中文说明：组件局部值 name，由紧邻初始化决定。 */
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return firstLine(name)
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; its first line is still
    // more useful than replacing the call with an unrelated catalog lookup.
  }
  return argsRaw === '' ? callId : firstLine(argsRaw)
}

/** Flatten durable result blocks under the generic Tool-row text contract.
 *  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`. */
/** 中文说明：函数 resultText 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  /** 中文说明：组件局部值 parts，由紧邻初始化决定。 */
  const parts: string[] = []
  /** 中文说明：组件局部值 item，由紧邻初始化决定。 */
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** Derive display state without consulting the live skill catalog. */
/** 中文说明：函数 skillRowModel 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function skillRowModel(block: ToolCallViewProps['block']): SkillRowModel {
  /** 中文说明：组件局部值 settled，由紧邻初始化决定。 */
  const settled = 'kind' in block
  /** 中文说明：组件局部值 argsRaw，由紧邻初始化决定。 */
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  /** 中文说明：组件局部值 state，由紧邻初始化决定。 */
  const state: SkillRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  /** 中文说明：组件局部值 output，由紧邻初始化决定。 */
  const output = resultText(block)
  return {
    name: skillName(argsRaw, block.callId),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** State substitution for the collapsed leading slot. */
/** 中文说明：函数 leadingFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function leadingFor(state: SkillRowState): ReactNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconSkillOutline16 size={14} />
  }
}

/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
/** 中文说明：函数 disclosureLeading 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function disclosureLeading(state: SkillRowState, open: boolean, expandable: boolean): ReactNode {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  /** 中文说明：组件局部值 icon，由紧邻初始化决定。 */
  const icon = leadingFor(state)
  if (!expandable) return icon
  return (
    <>
      <span className={css.iconIdle}>{icon}</span>
      <IconChevronDownOutline14 className={`${css.chevron} ${css.chevronHover}`} />
    </>
  )
}

/** Visually hidden state copy for the colour-only lifecycle cues. */
/** 中文说明：函数 stateStatus 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function stateStatus(state: SkillRowState, t: SkillRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/**
 * Render one `skill` tool call as an accent summary and instructions disclosure.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated skill row.
 */
/** 中文说明：函数 SkillRow 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function SkillRow({ block, inspect, t }: SkillRowProps) {
  /** 中文说明：组件局部值 model，由紧邻初始化决定。 */
  const model = skillRowModel(block)
  /** 中文说明：组件局部值 [expanded, setExpanded]，由紧邻初始化决定。 */
  const [expanded, setExpanded] = useState(false)
  /** 中文说明：组件局部值 expandable，由紧邻初始化决定。 */
  const expandable = model.output !== null
  /** 中文说明：组件局部值 open，由紧邻初始化决定。 */
  const open = expanded && expandable
  /** 中文说明：组件局部值 status，由紧邻初始化决定。 */
  const status = stateStatus(model.state, t)
  /** 中文说明：组件局部值 summary，由紧邻初始化决定。 */
  const summary = model.errorSummary ?? model.name
  /** 中文说明：组件局部值 toggleExpand，由紧邻初始化决定。 */
  const toggleExpand = (): void => {
    setExpanded(value => !value)
  }
  /** 中文说明：组件局部值 toggleFromKeyboard，由紧邻初始化决定。 */
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  /** 中文说明：组件局部值 disclosureProps，由紧邻初始化决定。 */
  const disclosureProps = expandable ? {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': open,
    onClick: toggleExpand,
    onKeyDown: toggleFromKeyboard,
  } : {}
  /** 中文说明：组件局部值 leading，由紧邻初始化决定。 */
  const leading = disclosureLeading(model.state, open, expandable)
  return (
    <div className={css.card} data-tool="skill" data-state={model.state}>
      <div
        className={css.row}
        data-expandable={expandable || undefined}
        {...disclosureProps}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null ? <span className={css.visuallyHidden}>{status}</span> : null}
        <span className={css.title}>Skill</span>
        <span className={css.separator} aria-hidden />
        <span className={model.errorSummary === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
      </div>
      {open ? (
        <div className={css.bodyWrap}>
          <section className={css.instructionsCard} aria-label={t('row.instructions')}>
            <div className={css.instructionsHeader}>{t('row.instructions')}</div>
            <pre className={css.instructions} data-error={model.state === 'error' || undefined}>{model.output}</pre>
          </section>
          {inspect !== undefined ? (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              Inspect
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
