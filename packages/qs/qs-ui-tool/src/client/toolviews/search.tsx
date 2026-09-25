/** grep / glob 视图：结构化匹配结果与截断说明。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  SearchBlock, type SearchBlockLineMatch, type SearchFileGroup,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QsToolviewProps } from '../contract.ts'
import { searchLabels } from '../primitive-labels.ts'
import { callHead, isSettled, singleText } from '../raw-tool-call.ts'
import { registerToolview, type ToolviewComponent } from '../toolview-registration.ts'
import { GenericToolCard } from './generic.tsx'
import styles from '../tool.module.css'

/** `grep`/`glob` 的视图模型：两种形状共用截断计数。 */
export type SearchCardModel =
  | { readonly kind: 'matches'; readonly files: readonly SearchFileGroup[]; readonly truncated: boolean; readonly total: number }
  | { readonly kind: 'paths'; readonly paths: readonly string[]; readonly truncated: boolean; readonly total: number }

/**
 * 校验匹配行。
 * @param value - meta 里的一个匹配项。
 * @returns 匹配行；结构不符时为 undefined。
 */
function lineMatch(value: unknown): SearchBlockLineMatch | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const match = value as { lineNumber?: unknown; line?: unknown }
  if (typeof match.lineNumber !== 'number' || !Number.isInteger(match.lineNumber) || match.lineNumber < 1) return undefined
  return typeof match.line === 'string' ? { lineNumber: match.lineNumber, line: match.line } : undefined
}

/**
 * 校验官方搜索 meta（`SearchMeta` 的两种形状）。
 * @param value - 结算结果上的 meta。
 * @returns 视图模型；结构不符时为 undefined。
 */
function searchMeta(value: unknown): SearchCardModel | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const meta = value as { shape?: unknown; truncated?: unknown; total?: unknown; files?: unknown; paths?: unknown }
  if (typeof meta.truncated !== 'boolean') return undefined
  if (typeof meta.total !== 'number' || !Number.isInteger(meta.total) || meta.total < 0) return undefined
  if (meta.shape === 'paths') {
    if (!Array.isArray(meta.paths)) return undefined
    const paths: string[] = []
    for (const path of meta.paths) {
      if (typeof path !== 'string') return undefined
      paths.push(path)
    }
    return { kind: 'paths', paths, truncated: meta.truncated, total: meta.total }
  }
  if (meta.shape !== 'matches' || !Array.isArray(meta.files)) return undefined
  const files: SearchFileGroup[] = []
  for (const file of meta.files) {
    if (typeof file !== 'object' || file === null) return undefined
    const group = file as { path?: unknown; matches?: unknown }
    if (typeof group.path !== 'string' || !Array.isArray(group.matches)) return undefined
    const matches: SearchBlockLineMatch[] = []
    for (const entry of group.matches) {
      const match = lineMatch(entry)
      if (match === undefined) return undefined
      matches.push(match)
    }
    files.push({ path: group.path, matches })
  }
  return { kind: 'matches', files, truncated: meta.truncated, total: meta.total }
}

/**
 * 构建搜索模型。
 *
 * 只有结构化 meta 才足以驱动卡片；meta 缺失或结构不符时回落兜底卡，不解析结果正文。
 * @param block - 运行头或结算结果。
 * @returns 视图模型；无法按契约呈现时为 undefined。
 */
export function searchCardModel(block: ToolCallBlock): SearchCardModel | undefined {
  if (callHead(block) === undefined || !isSettled(block) || block.isError) return undefined
  return searchMeta(block.meta)
}

/** 搜索视图组件：模型不成立时回落兜底卡。 */
export const SearchToolview: ToolviewComponent = ({ block, t }: QsToolviewProps): ReactNode => {
  const model = searchCardModel(block)
  if (model === undefined) return <GenericToolCard block={block} t={t} />
  // 截断时把结果正文（含转存路径说明）作为恢复线索贴在卡片下方。
  const recovery = isSettled(block) && model.truncated ? singleText(block) : undefined
  return (
    <div data-qs-tool-search>
      {model.kind === 'paths'
        ? <SearchBlock kind="paths" paths={[...model.paths]} truncated={model.truncated} total={model.total} labels={searchLabels(t)} />
        : <SearchBlock kind="matches" files={model.files.map(file => ({ path: file.path, matches: [...file.matches] }))} truncated={model.truncated} total={model.total} labels={searchLabels(t)} />}
      {recovery === undefined ? null : (
        <>
          <p className={styles.notice}>{t('search.recovery')}</p>
          <pre className={styles.pre}>{recovery}</pre>
        </>
      )}
    </div>
  )
}

/** 搜索视图插件：与官方 search 子插件同职责，一个插件覆盖 grep 与 glob 两个键。 */
export const searchToolview = {
  name: 'qs-search-toolview',
  inject: ['slots'],
  /** 注册 grep 与 glob 键。 */
  apply(ctx: ClientContext): void {
    registerToolview(ctx, 'grep', SearchToolview)
    registerToolview(ctx, 'glob', SearchToolview)
  },
}
