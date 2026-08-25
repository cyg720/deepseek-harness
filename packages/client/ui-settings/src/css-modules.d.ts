/**
 * 文件职责：为设置领域基础插件的 CSS 导入提供 TypeScript 声明。
 * 技术维度：使用环境模块声明表示局部类名映射和普通样式表。
 * 产品维度：设置外壳与通用插槽可加载一致且隔离的样式。
 * 逻辑维度：声明模块化 CSS 默认导出，并允许导入无返回值的 CSS。
 * 关键边界：类型只描述导入结果，不定义设置插槽或命名空间行为。
 * 新手阅读建议：先区分设置基础组件与功能设置页，再查看样式引用。
 */
/* 使用方式：`import styles from './Settings.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键和值均为字符串，值由构建阶段生成。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './settings.css'` 的副作用导入，不提供默认导出。 */
declare module '*.css'
