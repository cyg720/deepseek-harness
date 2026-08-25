/**
 * ================================ 文件注释 ================================
 * 【文件职责】轨迹账本的增量全文索引 TrajectorySearchIndex：为每条记录建立可搜索文本，
 *             只有单条记录的来源变化时才重新解析 Markdown，支持空格分隔的多词匹配。
 * 【技术维度】类实现；条目缓存（Map id → sources + 小写文本）；update 对比 sources
 *             是否变化决定是否重建文本；search 做大小写不敏感的多词 AND 匹配。
 * 【产品维度】轨迹工具栏的搜索框能跨消息 / 工具 / 详情 / 源块全文检索，且流式更新
 *             时不必全量重建索引。
 * 【逻辑维度】1) 内部 SearchEntry；2) 各来源收集（recordSources）；3) Markdown 预览 /
 *             结果预览辅助；4) update 增量同步；5) search 匹配。
 * 【关键边界】只索引 requestOnly 之外的记录；更新只增删改，未出现的 id 会被删除；
 *             查询为空返回 null（表示"无查询"而非"无结果"）。
 * 【新手阅读建议】理解 sameSources 如何避免不必要的重解析是核心。
 * ==========================================================================
 */
/** Incremental full-text index for the trajectory ledger. */

import type { TrajectoryTurnModel } from './layout.ts'
import type { TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { trajectoryPreviewText } from './trajectory-preview.ts'

// 一条索引条目：sources 是参与检索的原文片段（用于比较是否变化），text 是拼好的小写检索文本。
interface SearchEntry {
  readonly sources: readonly string[]
  readonly text: string
}

// 把任意值安全地序列化成可检索的 JSON 字符串；失败（循环引用等）返回空串。
function searchableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

// 两个来源数组是否逐项相同（决定是否需要重建检索文本）。
function sameSources(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

// 单元格的 Markdown 预览文本；与既有 text 以 " · " 拼接。
function markdownPreview(cell: TrajectoryCellProps): string {
  if (cell.previewMarkdown === undefined) return ''
  const preview = trajectoryPreviewText(cell.previewMarkdown)
  if (cell.text === '') return preview
  return preview === '' ? cell.text : `${cell.text} · ${preview}`
}

// 工具结果摘要：优先投影 resultPreviewMarkdown，否则用原始 result 字段。
function resultPreview(cell: TrajectoryCellProps): string {
  return cell.resultPreviewMarkdown === undefined
    ? cell.result ?? ''
    : trajectoryPreviewText(cell.resultPreviewMarkdown)
}

// 收集一条记录参与检索的全部来源：回合 / 组 / 种类 / 文本 / 详情 / 源块 / 序列化对象。
function recordSources(
  turn: number | null,
  group: string,
  cell: TrajectoryCellProps,
): readonly string[] {
  const blocks = [
    ...(cell.sourceBlocks ?? []),
    ...(cell.outputBlocks ?? []),
  ]
  return [
    turn === null ? 'between turns' : `turn ${turn}`,
    group,
    cell.kind,
    cell.kind === 'message' ? 'assistant' : '',
    cell.text,
    cell.previewMarkdown ?? '',
    cell.inputDetail ?? '',
    cell.outputDetail ?? '',
    cell.thinkingDetail ?? '',
    cell.schemaDetail ?? '',
    cell.result ?? '',
    cell.resultPreviewMarkdown ?? '',
    cell.callId ?? '',
    ...blocks.flatMap(block => [
      block.type,
      block.content,
      block.callId ?? '',
      block.toolName ?? '',
      block.imageAlt ?? '',
    ]),
    searchableJson(cell.messageSource),
    searchableJson(cell.promptDetail),
    searchableJson(cell.previousPromptDetail),
  ]
}

/** Session-view-local index that reparses Markdown only when one record's source changes. */
/*
 * 会话视图局部的搜索索引：只有单条记录的来源变化时才重解析 Markdown。
 * 使用示例：const index = new TrajectorySearchIndex()；update(layouts) 后 search(query)。
 */
export class TrajectorySearchIndex {
  // 记录 id → 索引条目 的缓存。
  private readonly entries = new Map<string, SearchEntry>()
  // 上一次 update 的布局引用（同一引用直接跳过）。
  private layouts: readonly (readonly TrajectoryTurnModel[])[] | undefined

  /**
   * Incrementally synchronize one or more current trajectory layout slices.
   * @param layouts - Finalized and optional streaming layouts from the same view.
   * @returns Whether the indexed layout version changed.
   */
  /*
   * 增量同步一个或多个当前轨迹布局切片。
   * @param layouts - 同一视图的定稿布局与可选的流式布局。
   * @returns 索引的布局版本是否变化。
   */
  update(layouts: readonly (readonly TrajectoryTurnModel[])[]): boolean {
    if (this.layouts === layouts) return false
    this.layouts = layouts
    const seen = new Set<string>()
    // 逐条记录：id 相同且 sources 逐项相同则复用旧条目，否则重建检索文本。
    for (const turns of layouts) {
      for (const turn of turns) {
        for (const group of turn.groups) {
          for (const cell of group.cells) {
            if (cell.requestOnly === true) continue
            const id = trajectoryRecordId(cell)
            const sources = recordSources(turn.turn, group.title, cell)
            const previous = this.entries.get(id)
            const entry = previous !== undefined && sameSources(previous.sources, sources)
              ? previous
              : {
                sources,
                text: [
                  ...sources,
                  markdownPreview(cell),
                  resultPreview(cell),
                ].join('\n').toLocaleLowerCase(),
              }
            this.entries.set(id, entry)
            seen.add(id)
          }
        }
      }
    }
    // 删除本次未出现的旧条目（记录被移除）。
    for (const id of this.entries.keys()) {
      if (!seen.has(id)) this.entries.delete(id)
    }
    return true
  }

  /**
   * Match a query against the latest committed index version.
   * @param query - Space-separated case-insensitive search terms.
   * @returns Matching stable record identities, or `null` without a query.
   */
  /*
   * 用查询串匹配最新提交的索引版本（空格分隔、大小写不敏感、多词 AND）。
   * @param query - 空格分隔的检索词。
   * @returns 命中的稳定记录身份集合；无查询时返回 null（区别于"无结果"）。
   */
  search(query: string): ReadonlySet<string> | null {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return null
    const matches = new Set<string>()
    // 所有检索词都必须出现在条目的检索文本里（AND 语义）。
    for (const [id, entry] of this.entries) {
      if (terms.every(term => entry.text.includes(term))) matches.add(id)
    }
    return matches
  }
}
