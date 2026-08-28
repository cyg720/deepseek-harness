import type { ReactNode } from 'react'
import {
  IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16, IconSearchOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { toolRowModel, type ToolRowVariant } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
/* 中文说明：视图局部值 VARIANT_ICONS，由紧邻初始化决定。 */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
/* 中文说明：类型或类 GenericToolCardProps 约束工具或轨迹数据职责。 */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
}

/** 中文说明：函数 GenericToolCard 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function GenericToolCard({ toolName, block, cwd, home, openFile, inspect, t }: GenericToolCardProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block, cwd, home)
  /** 中文说明：视图局部值 terminal，由紧邻初始化决定。 */
  const terminal = terminalCardModel(block, cwd)
  /** 中文说明：视图局部值 read，由紧邻初始化决定。 */
  const read = readCardModel(block, cwd, home)
  /** 中文说明：视图局部值 diff，由紧邻初始化决定。 */
  const diff = diffCardModel(block)
  /** 中文说明：视图局部值 search，由紧邻初始化决定。 */
  const search = searchCardModel(block)
  /** 中文说明：视图局部值 web，由紧邻初始化决定。 */
  const web = webCardModel(block)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  /** 中文说明：视图局部值 state，由紧邻初始化决定。 */
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  /** 中文说明：视图局部值 singleFile，由紧邻初始化决定。 */
  const singleFile = model.filePath !== undefined
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={VARIANT_ICONS[model.variant]}
      title={t(model.titleKey)}
      summary={model.summary}
      // Single-file tools never expose an args body — the path link is the only
      // args interaction. A card is not an args body: a read/write/edit row is
      // single-file AND carries a card, so the card expands under the path link.
      body={singleFile ? null : model.body}
      output={model.output}
      errorSummary={model.errorSummary}
      terminal={terminal}
      diff={diff}
      read={read}
      search={search}
      web={web}
      state={state}
      filePath={model.filePath}
      onOpenFile={singleFile ? openFile : undefined}
      inspect={inspect}
    />
  )
}
