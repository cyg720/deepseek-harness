/**
 * ================================ 文件注释 ================================
 * 【文件职责】提供"首尾截断"高度上限算法 headTailCap：列表超过 maxLines 行时，保留前
 *             ceil(maxLines / 2) 行 + 后若干行，中间折叠，供 TerminalBlock、SearchBlock
 *             等块组件统一使用。
 * 【技术维度】纯函数（无副作用、无 React）；返回 hidden / capped / headLines / tailLines
 *             四个指标，由调用方自己切片，便于叠加各自的头部/尾部定制。
 * 【产品维度】长输出（终端日志、搜索结果）全部渲染会卡顿且没有重点；首尾截断让用户
 *             既看到开头也看到结尾，并提示隐藏行数。
 * 【逻辑维度】1) 定义 HeadTailCap 接口；2) headTailCap 计算 hidden、headLines 与
 *             tailLines；capped 由"hidden > 0 且未展开"决定。
 * 【关键边界】展开（expanded）时 capped 为 false 即不截断；长度未超限时 hidden ≤ 0，
 *             表示一行都不隐藏。
 * 【新手阅读建议】先看接口四个字段的语义，再看函数体一行式的计算方法。
 * ==========================================================================
 */
// Head/tail height-cap arithmetic shared by the block primitives (TerminalBlock,
// SearchBlock), so long results use consistent head and tail slices. The split is
// `ceil(maxLines / 2)` head rows and the remainder as tail rows; a result within
// the cap shows every row and hides none.
// 本文件实现 headTailCap：计算"首尾截断"的切分指标，供 TerminalBlock、SearchBlock 等
// 块组件统一使用——长结果保留前 ceil(maxLines / 2) 行与后若干行，中间折叠。

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
