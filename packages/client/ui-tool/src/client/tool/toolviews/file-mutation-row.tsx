import type { Context } from '@deepseek-ai/cordis'
import { IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type FileMutationRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Lets users expand an applied file diff and open the reported path.
 */
/* 中文说明：函数 FileMutationRow 的参数见签名，返回结果供展示流程使用；示例见本文件。 */
export function FileMutationRow({ toolName, block, cwd, home, openFile, inspect, t }: FileMutationRowProps) {
  /** 中文说明：视图局部值 model，由紧邻初始化决定。 */
  const model = toolRowModel(toolName, block, cwd, home)
  /** 中文说明：视图局部值 diff，由紧邻初始化决定。 */
  const diff = diffCardModel(block)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconEditOutline16 size={14} />}
      title={t(model.titleKey)}
      summary={model.summary}
      body={null}
      output={model.output}
      errorSummary={model.errorSummary}
      diff={diff}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/** Registers the edit and write conversation rows. */
export const fileMutationToolview = {
  name: 'file-mutation-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow)
    })
  },
}
