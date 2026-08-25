/*
 * ================================ 文件注释 ================================
 * 【文件职责】从轨迹记录投影出"可测量"的虚拟行：把分隔符类（仅请求、零高）记录挂到
 *             下一内容行上，避免虚拟化器拥有零高度条目；并给出稳定的行 key。
 * 【技术维度】纯函数 + 固定行高常量（内容 30px、折叠摘要 20px、终端边界 9px）；
 *             key 对记录身份做 encodeURIComponent 并给折叠摘要加后缀。
 * 【产品维度】轨迹列表用虚拟滚动渲染成百上千条记录时，每行必须有确定高度与稳定身份，
 *             滚动条与 DOM 复用才不会错位。
 * 【逻辑维度】1) 行高常量；2) 三个行接口；3) trajectoryVirtualRecordKey 身份；
 *             4) groupTrajectoryVirtualRows 归组（pending 积累分隔符记录）。
 * 【关键边界】末尾残留的纯分隔符记录单独成行（终端边界高度）；折叠摘要行高度不同；
 *             requestOnly 记录永远不独立成行。
 * 【新手阅读建议】先看"为什么分隔符不能自己成行"，再看 pending 累积逻辑。
 * ==========================================================================
 */
/** Pure projection from trajectory records to measurable virtual ledger rows. */

import type { TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryRecordId } from './trajectory-record.ts'

// 内容行高度（px）。
const CONTENT_ROW_HEIGHT = 30
// 折叠摘要行高度（px）。
const COLLAPSED_SUMMARY_HEIGHT = 20
// 终端边界行高度（px）：末尾纯分隔符记录成行时使用。
const TERMINAL_BOUNDARY_HEIGHT = 9

/** Minimal record shape required by the trajectory virtual-row projection. */
// 虚拟行投影所需的最小记录形态：单元格 + 可选折叠摘要标记。
export interface VirtualizableTrajectoryRecord {
  cell: TrajectoryCellProps
  collapsedSummaryKind?: 'turn' | 'assistant'
}

/** One logical record retained inside a measurable virtual row. */
// 一条被保留在某个虚拟行内的逻辑记录：带原始逻辑下标（供行内定位）。
export interface TrajectoryVirtualRowEntry<T extends VirtualizableTrajectoryRecord> {
  logicalIndex: number
  record: T
}

/** One virtualizer item, which may carry zero-height request boundaries. */
/*
 * 一个虚拟化器条目：可能包含多条记录（内容行 + 它前面的纯请求分隔符）。
 */
export interface TrajectoryVirtualRow<T extends VirtualizableTrajectoryRecord> {
  entries: readonly TrajectoryVirtualRowEntry<T>[]
  height: number
  key: string
}

/**
 * Derive the DOM-safe row identity shared by React, the virtualizer, and
 * browser scroll contracts.
 * @param record - Display record whose identity is required.
 * @returns Stable record identity with a suffix for synthetic fold summaries.
 */
/*
 * 推导 React、虚拟化器与浏览器滚动契约共享的 DOM 安全行身份。
 * @param record - 需要身份的展示记录。
 * @returns 稳定记录身份；折叠摘要（合成行）附加 \u0000summary 后缀。
 */
export function trajectoryVirtualRecordKey(
  record: VirtualizableTrajectoryRecord,
): string {
  const identity = encodeURIComponent(trajectoryRecordId(record.cell))
  return record.collapsedSummaryKind === undefined
    ? identity
    : `${identity}\u0000summary\u0000${record.collapsedSummaryKind}`
}

/**
 * Attach separator-only records to the next content row so the virtualizer
 * never owns a zero-height item. A terminal separator retains its CSS-owned
 * lower-marker clearance as a standalone item.
 * @param records - Final search/fold projection in ledger order.
 * @returns Measurable virtual rows with original logical positions retained.
 */
/*
 * 把纯分隔符记录挂到下一个内容行上，让虚拟化器永远不会拥有零高度条目；
 * 末尾残留的分隔符以"终端边界"高度单独成行。
 * 使用示例：const rows = groupTrajectoryVirtualRows(searchFilteredRecords)；
 *   再把 rows 喂给虚拟化器（每行高度固定）。
 * @param records - 按账本顺序的最终搜索 / 折叠投影。
 * @returns 可测量的虚拟行数组，保留原始逻辑位置。
 */
export function groupTrajectoryVirtualRows<T extends VirtualizableTrajectoryRecord>(
  records: readonly T[],
): readonly TrajectoryVirtualRow<T>[] {
  const rows: TrajectoryVirtualRow<T>[] = []
  // pending 累积"未附着"的分隔符记录，等下一个内容记录一起成行。
  let pending: TrajectoryVirtualRowEntry<T>[] = []

  for (const [logicalIndex, record] of records.entries()) {
    const entry = { logicalIndex, record }
    if (record.cell.requestOnly === true) {
      pending.push(entry)
      continue
    }
    const entries = [...pending, entry]
    pending = []
    rows.push({
      entries,
      height: record.collapsedSummaryKind === undefined
        ? CONTENT_ROW_HEIGHT
        : COLLAPSED_SUMMARY_HEIGHT,
      key: trajectoryVirtualRecordKey(record),
    })
  }

  // 末尾仍是纯分隔符：单独成行，高度取终端边界高度。
  if (pending.length > 0) {
    rows.push({
      entries: pending,
      height: TERMINAL_BOUNDARY_HEIGHT,
      key: pending.map(candidate => trajectoryVirtualRecordKey(candidate.record)).join('|'),
    })
  }

  return rows
}
