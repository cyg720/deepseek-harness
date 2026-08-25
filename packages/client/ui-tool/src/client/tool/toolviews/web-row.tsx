// Web toolview registrant: the keyed toolview hole for the `web_search` and
// `web_fetch` tools. Registered under BOTH, since both declare the one `web`
// render intent and render through the one WebBlock family; the row
// discriminates on the toolName only to pick its icon and title. The row
// composes the shared ToolRow (chrome, running sweep, whole-row expand) and
// feeds it the completed retrieval as ToolRow's `web` card material, so it
// renders through WebBlock in the collapsed-by-default expanded body — the same
// unified interaction every other card row has. Until the call settles there is
// no web card (the tools keep a generic pending view), so a running row is the
// summary line alone.
/**
 * 文件职责：实现工具调用的 web-row 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
/* 中文说明：类型或类 WebRowProps 约束工具或轨迹数据职责。 */
type WebRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** web_fetch reads one URL; web_search queries. Titles are figma literals. */
/* 中文说明：视图局部值 WEB_TITLES，由紧邻初始化决定。 */
const WEB_TITLES: Record<string, string> = {
  web_search: 'Search',
  web_fetch: 'Fetch',
}

/**
 * Web row: icon + Search/Fetch · {summary} in the shared ToolRow chrome, with
 * the completed retrieval's web card as the row's collapsed-by-default card
 * body. The row discriminates on `toolName` only to pick its icon and title.
 */
/* 中文说明：函数 WebRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function WebRow({ toolName, block, inspect, t }: WebRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block)
  /** 中文说明：视图局部值 web，由紧邻初始化决定。 */
  const web = webCardModel(block)
  // Web search uses a globe; local grep/glob keep the magnifier family.
  /** 中文说明：视图局部值 icon，由紧邻初始化决定。 */
  const icon = toolName === 'web_fetch' ? <IconBrowseOutline16 size={14} /> : <IconGlobeOutline14 size={14} />
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={icon}
      title={WEB_TITLES[toolName] ?? model.title}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      web={web}
      state={model.state}
      inspect={inspect}
    />
  )
}

/**
 * The web rows follow the atomic Tool-view declaration across activation and
 * reload. One WebRow component registers under both web tool names.
 */
/* 中文说明：视图局部值 webToolview，由紧邻初始化决定。 */
export const webToolview = {
  name: 'web-toolview',
  inject: ['slots'],
  /**
   * Register the web row under both web tool names' keyed toolview holes.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_search', locale: NS }, WebRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_fetch', locale: NS }, WebRow)
    })
  },
}
