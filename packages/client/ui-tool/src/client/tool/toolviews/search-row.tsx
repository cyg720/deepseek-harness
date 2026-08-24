// Search toolview registrant: the keyed toolview hole for the `grep` and `glob`
// tools. One SearchRow component registered under both, since both declare the
// same `card: 'search'` render intent and render as one visual object; the
// derived model's `kind` decides the card shape (grouped matches or a path
// list). The row composes the shared ToolRow (chrome, running sweep, whole-row
// expand) and feeds it the completed search as ToolRow's `search` card
// material, so it renders through SearchBlock in the collapsed-by-default
// expanded body — with a capped search's recovery footer below the card. A
// search declares its render intent result-time only, so a running row is the
// summary line alone; a settled call with no search card (an errored search, a
// nested run_code sub-dispatch, a legacy generic result) surfaces its
// model-facing text through ToolRow's Output section instead.
/**
 * 文件职责：实现工具调用的 search-row 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import type { Context } from '@deepseek-ai/cordis'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
/** 中文说明：类型或类 SearchRowProps 约束工具或轨迹数据职责。 */
type SearchRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** 中文说明：视图局部值 SEARCH_TITLES，由紧邻初始化决定。 */
const SEARCH_TITLES: Record<string, string> = {
  grep: 'Grep',
  glob: 'Glob',
}

/**
 * Search row: icon + Grep/Glob · {summary} in the shared ToolRow chrome, with the
 * completed search's card as the row's collapsed-by-default card body (a capped
 * search's recovery footer rides below it, inside ToolRow). Registered under
 * both `grep` and `glob`; the derived model's `kind` decides the card shape. A
 * settled call with no search card surfaces its model-facing text through
 * ToolRow's Output section, since the keyed SearchRow owns this render slot.
 */
/** 中文说明：函数 SearchRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function SearchRow({ toolName, block, inspect, t }: SearchRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block)
  /** 中文说明：视图局部值 search，由紧邻初始化决定。 */
  const search = searchCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconSearchOutline16 size={14} />}
      title={SEARCH_TITLES[toolName] ?? model.title}
      // The result view's replacement title outranks the args-derived summary,
      // matching the terminal card's description precedence.
      summary={search?.title ?? model.summary}
      body={null}
      // A settled call with no search card (errored search, nested run_code
      // sub-dispatch, legacy generic result) has its text nowhere else to go;
      // ToolRow's Output section carries it, and errorSummary its first line.
      // When a card is present ToolRow renders it instead of the output, so
      // model.output passes unconditionally and the four card rows stay
      // symmetric.
      output={model.output}
      errorSummary={model.errorSummary}
      search={search}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The search view follows the atomic Tool-view declaration across activation
 * and reload. One component registers under both keys because `grep` and
 * `glob` are the same visual object discriminated by the result view's `kind`.
 */
/** 中文说明：视图局部值 searchToolview，由紧邻初始化决定。 */
export const searchToolview = {
  name: 'search-toolview',
  inject: ['slots'],
  /**
   * Register the search row into the Tool-owned keyed view slot under both
   * the `grep` and `glob` tool names.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'glob', locale: NS }, SearchRow)
    })
  },
}
