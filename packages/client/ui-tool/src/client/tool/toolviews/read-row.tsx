import type { Context } from '@deepseek-ai/cordis'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type ReadRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Lets users expand a completed read result and open its reported path.
 */
/* 中文说明：函数 ReadRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
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
      title={t(model.titleKey)}
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

/** Registers the read tool's conversation row. */
export const readToolview = {
  name: 'read-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow))
  },
}
