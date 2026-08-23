/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义所有 ic_ds_* 图标组件共享的 props 类型（尺寸与类名）。
 * 【技术维度】纯 TypeScript 类型声明文件；className 带 `| undefined` 是为了适配
 *             exactOptionalPropertyTypes 严格选项（调用方需要转发自己的可选 prop）。
 * 【产品维度】让桌面客户端各处图标对外呈现一致的属性接口，便于统一布局与着色。
 * 【逻辑维度】单个接口 IconProps：size 控制边长，className 控制布局位置与颜色。
 * 【关键边界】颜色不设独立字段，约定由 currentColor 继承；本文件无任何运行时代码。
 * 【新手阅读建议】注意 `| undefined` 存在的意义（严格可选属性检查下转发可选 prop）。
 * ==========================================================================
 */
/** Shared props for every ic_ds_* icon component. */
/**
 * 所有 ic_ds_* 图标组件共享的 props：size 控制边长，className 控制布局与颜色。
 */
export interface IconProps {
  /** Square edge in px; defaults to the glyph's own drawn size. */
  // 图标边长（px）；缺省时使用字形自带的绘制尺寸。
  size?: number | undefined
  /** Extra class for layout placement; color rides currentColor.
   * (`| undefined` for exactOptionalPropertyTypes: callers forward their own optional prop.) */
  // 额外的布局类名；颜色一律跟随 currentColor 继承，不提供独立颜色字段。
  className?: string | undefined
}
