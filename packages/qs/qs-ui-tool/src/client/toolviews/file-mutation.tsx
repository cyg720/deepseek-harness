/** write / edit 视图：目标路径与改动对照（落盘记录优先，缺记录时明确标注为参数对照）。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { DiffBlock, diffTotals, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QsToolviewProps } from '../contract.ts'
import { diffLabels } from '../primitive-labels.ts'
import { callHead, isSettled, parseArgs, stringArg } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/**
 * 写入/编辑类调用的视图模型。
 *
 * 目标路径不作为独立字段：分块自身带路径，官方 `DiffBlock` 会把它画成分块标题，
 * 额外一行路径既重复又需要为「分块为空」造一个不可达的兜底分支。
 */
export interface FileMutationModel {
  /** 已落盘分块；`intended` 为真时是参数推导出的对照。 */
  readonly diffs: readonly DiffHunk[]
  /** 对照来自参数而非落盘记录，卡片必须显式标注。 */
  readonly intended: boolean
}

/**
 * 校验落盘 meta（官方 `FsDiffMeta`：`{ diffs: FileDiff[] }`）。
 * @param meta - 结算结果上的 meta。
 * @returns 分块数组；空数组表示工具明确没有分块，结构不符时返回 undefined。
 */
function appliedDiffs(meta: unknown): readonly DiffHunk[] | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const diffs = (meta as { readonly diffs?: unknown }).diffs
  if (!Array.isArray(diffs)) return undefined
  const hunks: DiffHunk[] = []
  for (const diff of diffs) {
    if (typeof diff !== 'object' || diff === null) return undefined
    const hunk = diff as { path?: unknown; oldText?: unknown; newText?: unknown }
    if (typeof hunk.path !== 'string' || typeof hunk.newText !== 'string') return undefined
    if (hunk.oldText !== null && typeof hunk.oldText !== 'string') return undefined
    hunks.push({ path: hunk.path, oldText: hunk.oldText, newText: hunk.newText })
  }
  return hunks
}

/**
 * 由参数推导的对照。
 * @param name - Wire 工具名（`write` 或 `edit`）。
 * @param args - 已解析的参数。
 * @returns 参数对照；必需参数缺失时为 undefined。
 */
function intendedDiff(name: string, args: Record<string, unknown> | undefined): DiffHunk | undefined {
  const path = stringArg(args, 'file_path')
  if (path === undefined) return undefined
  if (name === 'write') {
    const content = args?.content
    return typeof content === 'string' ? { path, oldText: null, newText: content } : undefined
  }
  const oldText = args?.old_string
  const newText = args?.new_string
  return typeof oldText === 'string' && typeof newText === 'string' ? { path, oldText, newText } : undefined
}

/**
 * 构建写入/编辑模型。
 *
 * 与官方一致：`write` 在落盘记录为空（新建或覆盖）时回落到参数对照，`edit` 则回落
 * 兜底卡；失败结算一律回落兜底卡，不从失败调用上展示“改动”。
 * @param name - Wire 工具名。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function fileMutationModel(name: string, block: ToolCallBlock): FileMutationModel | undefined {
  const head = callHead(block)
  if (head === undefined) return undefined
  const intended = intendedDiff(name, parseArgs(head.argsRaw))
  if (!isSettled(block)) {
    return intended === undefined ? undefined : { diffs: [intended], intended: true }
  }
  if (block.isError) return undefined
  const applied = appliedDiffs(block.meta)
  if (applied === undefined || applied.length === 0) {
    if (name !== 'write' || intended === undefined) return undefined
    return { diffs: [intended], intended: true }
  }
  return { diffs: applied, intended: false }
}

/** 写入/编辑视图组件：模型不成立时回落兜底卡。 */
export const FileMutationToolview: ToolviewComponent = ({ block, toolName, t }: QsToolviewProps): ReactNode => {
  const model = fileMutationModel(toolName, block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  const totals = diffTotals([...model.diffs])
  return (
    <div data-qs-tool-file-mutation>
      {model.intended ? <p className={styles.notice}>{t('fileMutation.intended')}</p> : null}
      <DiffBlock diffs={[...model.diffs]} labels={diffLabels(t)} />
      <p className={styles.meta}>+{totals.added} -{totals.removed}</p>
    </div>
  )
}

/** 写入/编辑视图插件：与官方 file-mutation 子插件同职责，一个插件覆盖 write 与 edit 两个键。 */
export const fileMutationToolview = {
  name: 'qs-file-mutation-toolview',
  inject: ['slots'],
  /** 注册 write 与 edit 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'write', FileMutationToolview)
    registerToolview(ctx, 'edit', FileMutationToolview)
  },
}
