/** The head/tail split metrics for a capped list. */
/*
 * 截断切分指标：调用方按 headLines / tailLines 自行切片自己的行数组。
 */
export interface HeadTailCap {
  /** Rows beyond the cap (list length − maxLines); ≤ 0 means nothing is hidden. */
  // 超出上限的行数（列表长度 − maxLines）；≤0 表示没有任何行被隐藏。
  hidden: number
  /** Whether the list is over the cap and not expanded, so it shows a head/tail slice. */
  // 是否处于"超限且未展开"状态——是则展示首尾切片。
  capped: boolean
  /** Head-slice row count: `ceil(maxLines / 2)`. */
  // 头部切片行数：ceil(maxLines / 2)。
  headLines: number
  /** Tail-slice row count: the remainder after the head. */
  // 尾部切片行数：上限减去头部后的余量。
  tailLines: number
}

/**
 * Compute the head/tail cap metrics for a list of `total` rows against `maxLines`,
 * given whether the surface is expanded. Pure arithmetic; the caller slices its
 * own rows with `headLines`/`tailLines` so a block can layer its own concerns
 * (SearchBlock restores a tail file header) on top.
 * @param total - the list's row count.
 * @param maxLines - the collapsed-height cap in rows.
 * @param expanded - whether the surface is expanded (uncaps the list).
 * @returns the split metrics.
 */
/*
 * 计算列表的"首尾截断"指标。纯算术函数、无副作用；调用方自己负责切片，
 * 以便在切分逻辑之上叠加自己的定制（如 SearchBlock 恢复尾部文件头）。
 * 使用示例：const { headLines, tailLines, capped } = headTailCap(rows.length, 20, expanded)。
 * @param total - 列表总行数。
 * @param maxLines - 折叠状态下允许显示的行数上限。
 * @param expanded - 是否已展开（展开即不截断）。
 * @returns 切分指标（hidden / capped / headLines / tailLines）。
 */
export function headTailCap(total: number, maxLines: number, expanded: boolean): HeadTailCap {
  // hidden 为负数或 0 时 capped 为 false，表示没有行被隐藏。
  const hidden = total - maxLines
  // 头部行数向上取整，保证短列表时头部占比稳定。
  const headLines = Math.ceil(maxLines / 2)
  return { hidden, capped: hidden > 0 && !expanded, headLines, tailLines: maxLines - headLines }
}
