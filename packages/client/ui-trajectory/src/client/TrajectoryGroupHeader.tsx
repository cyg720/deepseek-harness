// TrajectoryGroupHeader: "Message" or "Step N" row with optional description.
// 文件职责：渲染轨迹正文中“Message”或“Step N”分组标题及可选摘要。
// 技术维度：使用 React 条件渲染、TypeScript 属性接口和 CSS Modules。
// 产品维度：帮助用户区分模型消息与各工具步骤，并快速浏览耗时等摘要。
// 逻辑维度：始终显示 title；description 只有在已定义且非空时才创建次要文本节点。
// 关键边界：空字符串等同于没有摘要；组件不格式化标题或描述内容。
// 新手阅读建议：重点看 description 的双重条件，理解为何避免渲染空 span。

import css from './TrajectoryGroupHeader.module.css'

/** 轨迹分组标题属性，包含必需标题和可选次要摘要。 */
export interface TrajectoryGroupHeaderProps {
  /** Group title (`Message`, `Step 1`, …). */
  /** 分组主标题，例如 Message 或 Step 1。 */
  title: string
  /** Secondary summary (`49 s`, `2.2 s skill`, …). */
  /** 可选次要摘要，例如耗时或技能名称；空字符串不会显示。 */
  description?: string
}

/**
 * Render a Message/Step group header inside a turn body.
 * @param props - title and optional description.
 * @returns the group header element.
 */
/**
 * 渲染一条消息或步骤分组标题。
 * @param props - title 是必需主标题；description 是可选且非空时显示的摘要。
 * @returns 包含主标题和可选描述的分组标题元素。
 * @example <TrajectoryGroupHeader title="Step 1" description="2.2 s skill" />
 */
export function TrajectoryGroupHeader({ title, description }: TrajectoryGroupHeaderProps) {
  return (
    <div className={css.root}>
      <span className={css.title}>{title}</span>
      {description !== undefined && description !== ''
        ? <span className={css.description}>{description}</span>
        : null}
    </div>
  )
}
