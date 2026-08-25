/**
 * 文件职责：为权限预设界面包的 CSS Modules 导入补充 TypeScript 类型。
 * 技术维度：使用环境模块声明，把模块化样式表示为字符串类名映射。
 * 产品维度：权限设置和命令界面可获得类型安全的样式对象。
 * 逻辑维度：匹配所有 `*.module.css` 导入并默认导出类名集合。
 * 关键边界：类型只保证键值为字符串，不能证明某个类名真实存在。
 * 新手阅读建议：先看组件的样式导入，再回到 CSS 文件核对对应类选择器。
 */
/* 使用方式：`import styles from './Permission.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键和值均为字符串，内容由 CSS Modules 构建步骤生成。 */
  const classes: Record<string, string>
  export default classes
}
