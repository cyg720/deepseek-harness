// Read toolview registrant: the keyed toolview hole for the read tool. The row
// composes the shared ToolRow (chrome, running sweep, whole-row expand) and
// feeds it the file's line-numbered, syntax-highlighted content as ToolRow's
// `read` card material, so it renders through ReadBlock in the collapsed-by-
// default expanded body — the same unified interaction every other card row
// has. The summary path is an openable host link. A running read (no result
// yet) and a non-read result render the summary row alone: the read intent is
// result-side only, so there is no running-state read card to draw.
/**
 * 文件职责：实现工具调用的 read-row 组件。
 * 技术维度：React、TypeScript、Cordis 插槽和 CSS Modules。
 * 产品维度：向用户展示工具调用参数、结果和状态。
 * 逻辑维度：接收类型化数据，选择专用视图并渲染层级与详情。
 * 关键边界：组件不执行工具；未知或失败结果必须保留可诊断信息。
 * 新手阅读建议：先读 Props，再看视图选择、派生值和 JSX。
 */

import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Full row props: the toolview runtime share plus the standard locale seat. */
/** 中文说明：类型或类 ReadRowProps 约束工具或轨迹数据职责。 */
type ReadRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Read row: icon + Read · {path} in the shared ToolRow chrome, with the file's
 * read card as the row's collapsed-by-default card body. The summary path is an
 * openable host link when the row names a single file.
 */
/** 中文说明：函数 ReadRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function ReadRow({ toolName, block, cwd, home, openFile, inspect, t }: ReadRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block, cwd, home)
  /** 中文说明：视图局部值 read，由紧邻初始化决定。 */
  const read = readCardModel(block, cwd, home)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconBrowseOutline16 size={14} />}
      title={model.title}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      read={read}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/**
 * The read row as a plain registrant plugin following the atomic Tool-view
 * declaration across independent activation and reload lifetimes.
 */
/** 中文说明：视图局部值 readToolview，由紧邻初始化决定。 */
export const readToolview = {
  name: 'read-toolview',
  inject: ['slots'],
  /**
   * Register the read row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow))
  },
}
