// ask_user_question toolview: question-flavored summary row replacing the
// generic "Tool call" card, registered into the keyed
// 'tool.call.toolview' hole like todo-row. The row composes ToolRow
// (chrome, running sweep, whole-row expand) and swaps in the interaction
// outcome — `waiting` while pending, answered-count once settled, `cancelled`
// when the user dismissed the whole set — because the questions themselves
// render in the composer takeover.
/**
 * 文件职责：实现工具调用的 ask-question-row 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import { IconQuestionOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** One parsed answer entry, shape-checked (result JSON crosses the wire). */
/** 中文说明：类型或类 AnswerEntry 约束工具或轨迹数据职责。 */
interface AnswerEntry { selected?: unknown; custom?: unknown }

/** 中文说明：函数 isAnswer 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function isAnswer(value: unknown): value is AnswerEntry {
  return typeof value === 'object' && value !== null
}

/** Answered-count summary from the result JSON (a skipped question has
 *  empty `selected` and no `custom`); null when answer fields are invalid. */
/** 中文说明：函数 answeredSummary 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function answeredSummary(text: string, t: AskQuestionRowProps['t']): string | null {
  /** 中文说明：视图局部值 parsed: unknown，由紧邻初始化决定。 */
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  /** 中文说明：视图局部值 answers，由紧邻初始化决定。 */
  const answers = (parsed as { answers?: unknown }).answers
  if (!Array.isArray(answers) || !answers.every(isAnswer)) return null
  /** 中文说明：视图局部值 answered，由紧邻初始化决定。 */
  const answered = answers.filter(a =>
    (Array.isArray(a.selected) && a.selected.length > 0)
    || (typeof a.custom === 'string' && a.custom !== '')).length
  return t('ask.answered', { answered, total: answers.length })
}

/** Full row props: the toolview runtime share plus the standard locale seat. */
/** 中文说明：类型或类 AskQuestionRowProps 约束工具或轨迹数据职责。 */
type AskQuestionRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** One-line question-interaction row (the whole row toggles the call's
 *  Input/Output sections, ToolRow's unified expand). */
/** 中文说明：函数 AskQuestionRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function AskQuestionRow({ toolName, block, inspect, t }: AskQuestionRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block)
  // Composer verdicts settle the call as specific UserQuestionErrors
  // (apiproxy ask_user_question handler): 'ASK_CANCELLED' is the user's own
  // dismissal of the set, 'ASK_ABORTED' is a turn interrupt landing while the
  // question was pending. Both name their verdict instead of the generic
  // failed shape, and the abort keeps the shared stopped (amber) semantics of
  // any other interrupted tool call.
  /** 中文说明：视图局部值 code，由紧邻初始化决定。 */
  const code = 'kind' in block ? block.error?.code : undefined
  /** 中文说明：视图局部值 summary，由紧邻初始化决定。 */
  let summary = model.summary
  /** 中文说明：视图局部值 state，由紧邻初始化决定。 */
  let state = model.state
  if (code === 'ASK_CANCELLED') {
    summary = t('ask.cancelled')
  } else if (code === 'ASK_ABORTED') {
    summary = t('ask.interrupted')
    state = 'stopped'
  } else if (model.state === 'running') {
    summary = t('ask.waiting')
  } else if ('kind' in block && model.state === 'ok') {
    /** 中文说明：视图局部值 text，由紧邻初始化决定。 */
    const text = block.content.filter(b => b.type === 'text').map(b => b.text).join('')
    summary = answeredSummary(text, t) ?? model.summary
  }
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconQuestionOutline14 />}
      title={t('ask.rowTitle')}
      summary={summary}
      body={model.body}
      output={model.output}
      state={state}
      inspect={inspect}
    />
  )
}

/**
 * The ask-question row as a plain registrant plugin following the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
/** 中文说明：视图局部值 askQuestionToolview，由紧邻初始化决定。 */
export const askQuestionToolview = {
  name: 'ask-question-toolview',
  inject: ['slots'],
  /**
   * Register the ask-question row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview', key: 'ask_user_question', locale: NS,
    }, AskQuestionRow))
  },
}
