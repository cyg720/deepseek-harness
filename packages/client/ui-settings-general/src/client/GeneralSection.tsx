/** The General section: one column rendering feature-owned item contributions. */
/*
 * 文件职责：渲染设置页“常规”分区，并投影各功能插件贡献的设置项。
 * 技术维度：使用 React 函数组件、TypeScript 交叉类型和作用域插槽渲染 API。
 * 产品维度：让不同功能在不修改设置页核心组件的情况下加入自己的常规设置项。
 * 逻辑维度：组合分区运行时属性与条目插槽属性，再在单列容器中渲染 settings.general.item。
 * 关键边界：组件不拥有具体设置项和状态；没有贡献时插槽可以渲染为空。
 * 新手阅读建议：先看 GeneralSectionComponentProps 的两个来源，再沿 renderSlot 查找设置项注册者。
 */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus item render share. */
/* 组件完整属性：同时包含设置分区运行时属性和常规条目插槽渲染能力。 */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
/*
 * 渲染“常规”设置分区的单列内容。
 * @param props - 组合后的插槽属性；renderSlot 用于投影功能自有设置项。
 * @returns 包含所有 settings.general.item 贡献的分区元素树。
 * @example <GeneralSection {...slotProps} />
 */
export function GeneralSection({ renderSlot }: GeneralSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.general.item', {})}
    </div>
  )
}
