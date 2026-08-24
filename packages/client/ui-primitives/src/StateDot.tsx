// StateDot: session state indicator (figma nodes 14:3303/3305/3312, 122:9182).
// done/warning/error: 10x10 halo (same color, 10% opacity) around a 6x6 solid
// core. ongoing: a pixel-art chase — the 8 outer cells of a 3x3 matrix light
// up clockwise with a stepped trail. Colors resolve through --dsw-* tokens only.
// 中文：完成、警告、错误状态使用光晕加实心圆；进行中状态让 3×3 外圈八格顺时针追逐，颜色只取设计令牌。
/**
 * 中文说明：
 * - 文件职责：渲染完成、需关注、进行中和错误四种会话状态点。
 * - 技术维度：使用 React、CSS Modules、clsx、SVG 像素矩阵和错相动画。
 * - 产品维度：以紧凑图形提示会话或任务当前状态，适合列表和标题等狭窄位置。
 * - 逻辑维度：进行中分支绘制八个 SVG 单元，其他状态渲染由 CSS 着色的 span。
 * - 关键边界：组件 aria-hidden，必须与可读文字搭配；默认尺寸和 SVG viewBox 均以 10px 设计。
 * - 新手阅读建议：先看 StateDotState 与 MATRIX_CELLS，再比较 ongoing 和静态状态的两个返回分支。
 */

import clsx from 'clsx'
import css from './StateDot.module.css'

/** Four-color state semantic (green done / amber user-attention / blue running ring / red error). */
/** 中文：四种颜色语义：绿色完成、琥珀需关注、蓝色运行、红色错误。 */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'

/** Outer 3x3 matrix cells (2px pixels on a 10px grid), clockwise from top-left. */
/** 中文：10px 网格中 3×3 外圈八个 2px 单元坐标，从左上开始顺时针排列。 */
const MATRIX_CELLS: readonly (readonly [number, number])[] = [
  [0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4],
]

/**
 * Render a state dot.
 * @param props.state - which of the four states to show.
 * @param props.size - outer diameter in px (default 10, the figma size).
 * @param props.className - extra class for layout placement.
 * @returns the dot element (aria-hidden; pair with text for accessibility).
 */
/** 中文：渲染状态点；state 必填，size 默认 10，className 可扩展布局，返回装饰性元素。示例：<StateDot state="ongoing" />。 */
export function StateDot({ state, size = 10, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  if (state === 'ongoing') {
    return (
      <svg
        className={clsx(css.matrix, className)}
        data-state="ongoing"
        width={size}
        height={size}
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {MATRIX_CELLS.map(([x, y], index) => (
          <rect
            key={`${x}-${y}`}
            className={css.cell}
            x={x}
            y={y}
            width="2"
            height="2"
            /* Negative delay phases the chase so every cell animates from mount. */
            /* 中文：负延迟让每个单元挂载时立即位于不同动画相位。 */
            style={{ animationDelay: `${(index - MATRIX_CELLS.length) * 125}ms` }}
          />
        ))}
      </svg>
    )
  }
  return (
    <span
      className={clsx(css.dot, className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
