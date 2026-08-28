// TrajectoryTurn: sticky Turn header plus the padded Message/Step body.
// 文件职责：渲染一轮轨迹的粘性标题和消息/步骤正文容器。
// 技术维度：使用 React 函数组件、TypeScript 属性接口和 CSS Modules 组合子组件。
// 产品维度：把长任务轨迹按轮次分组，滚动时仍能看到当前轮次编号。
// 逻辑维度：section 标记轮次，先渲染 TrajectoryTurnHeader，再在 body 中投影子内容。
// 关键边界：turn 从 1 开始；children 只负责消息或步骤行，标题由本组件固定生成。
// 新手阅读建议：先看 data-turn 和 Header 如何共享 turn，再看 children 被放入哪个样式容器。

import type { ReactNode } from 'react'
import { TrajectoryTurnHeader } from './TrajectoryTurnHeader.tsx'
import type { TrajectoryTranslate } from './locales.ts'
import css from './TrajectoryTurn.module.css'

/** 单轮轨迹组件属性，包含从 1 开始的轮次号和可选正文节点。 */
export interface TrajectoryTurnProps {
  /** 1-based turn index for the sticky header. */
  /* 从 1 开始的轮次序号，用于粘性标题和 data-turn 属性。 */
  turn: number
  /** Message / Step headers and TrajectoryCell rows. */
  /* 可选的消息组、步骤组标题和 TrajectoryCell 行。 */
  children?: ReactNode
  /** Trajectory locale seat. */
  t: TrajectoryTranslate
}

/**
 * Render one turn section (sticky header + body).
 * @param props - turn index and body children.
 * @returns the turn section element.
 */
export function TrajectoryTurn({ turn, children, t }: TrajectoryTurnProps) {
  return (
    <section className={css.root} data-turn={turn}>
      <TrajectoryTurnHeader turn={turn} t={t} />
      <div className={css.body}>{children}</div>
    </section>
  )
}
