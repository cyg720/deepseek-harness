import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import { planSummary, type PlanItemLike } from './plan-summary.ts'

type TodoRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** 中文说明：函数 isItem 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function isItem(value: unknown): value is PlanItemLike {
  return typeof value === 'object' && value !== null
}

/**
 * The row's summary split at the ellipsis boundary: `text` truncates, `extra`
 * is the parallel-active count that must not, so a narrow row never clips the
 * one part that says several tasks are running.
 */
/* 中文说明：类型或类 RowSummary 约束工具或轨迹数据职责。 */
interface RowSummary {
  text: string
  extra: number
}

/** 中文说明：函数 summarize 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
function summarize(argsRaw: string, t: TodoRowProps['t']): RowSummary | null {
  /** 中文说明：视图局部值 parsed: unknown，由紧邻初始化决定。 */
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    // Mid-stream truncation or malformed model JSON: fall back to the generic summary.
    return null
  }
  // Valid JSON with invalid todo fields (null root, non-array todos, null items —
  // a rejected tool/call retains such args verbatim): same generic fallback.
  if (typeof parsed !== 'object' || parsed === null) return null
  /** 中文说明：视图局部值 todos，由紧邻初始化决定。 */
  const todos = (parsed as { todos?: unknown }).todos
  if (!Array.isArray(todos) || !todos.every(isItem)) return null
  /** 中文说明：视图局部值 解构结果，由紧邻初始化决定。 */
  const { done, total, activeContent, activeExtra } = planSummary(todos)
  /** 中文说明：视图局部值 head，由紧邻初始化决定。 */
  const head = t('todo.completed', { done, total })
  return {
    text: activeContent === null ? head : `${head} · ${activeContent}`,
    extra: activeExtra,
  }
}

/** Summarizes a plan update without presenting a cancelled call as completed. */
export function TodoRow({ toolName, block, inspect, t }: TodoRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block)
  /** 中文说明：视图局部值 argsRaw，由紧邻初始化决定。 */
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  /** 中文说明：视图局部值 summary，由紧邻初始化决定。 */
  const summary = summarize(argsRaw, t) ?? { text: model.summary, extra: 0 }
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconChecklistOutline14 />}
      title={t('todo.rowTitle')}
      summary={summary.text}
      summarySuffix={summary.extra > 0 ? `+${summary.extra}` : null}
      body={model.body}
      output={model.output}
      errorSummary={model.errorSummary}
      state={model.state}
      inspect={inspect}
    />
  )
}

/** Registers the todo conversation row. */
export const todoToolview = {
  name: 'todo-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'todo_write', locale: NS }, TodoRow))
  },
}
