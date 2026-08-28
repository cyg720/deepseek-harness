// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.
// 文件职责：渲染每轮轨迹的粘性标题栏和四个固定指标列标签。
// 技术维度：使用 React 函数组件、只读常量元组、数组映射和 CSS Modules。
// 产品维度：用户滚动长轨迹时仍能识别当前轮次及输入、输出、思考、耗时列。
// 逻辑维度：显示 Turn N 标题，再遍历 COLUMN_LABELS 生成仅作视觉说明的列标签。
// 关键边界：turn 从 1 开始；指标标签标记 aria-hidden，实际数据需要其他可访问文本说明。
// 新手阅读建议：先看 COLUMN_LABELS 如何映射为 span，再看 aria-hidden 为何放在列容器上。

import css from './TrajectoryTurnHeader.module.css'
import type { TrajectoryKey, TrajectoryTranslate } from './locales.ts'

const COLUMN_LABEL_KEYS: readonly TrajectoryKey[] = [
  'column.input', 'column.output', 'column.think', 'column.time',
]

/** 每轮粘性标题栏属性，只包含从 1 开始的轮次序号。 */
export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  /* 从 1 开始并显示为 Turn N 的轮次序号。 */
  turn: number
  /** Trajectory locale seat. */
  t: TrajectoryTranslate
}

/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn, t }: TrajectoryTurnHeaderProps) {
  return (
    <div className={css.root}>
      <div className={css.inner}>
        <span className={css.title}>{t('turn.label', { turn })}</span>
        <div className={css.columns} aria-hidden="true">
          {COLUMN_LABEL_KEYS.map(key => (
            <span key={key} className={css.column}>{t(key)}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
