/**
 * 文件职责：为附件界面包的模块化和普通 CSS 导入提供 TypeScript 声明。
 * 技术维度：用环境模块声明区分类名映射和不导出值的全局样式。
 * 产品维度：附件组件可使用隔离类名，并在需要时加载整张普通样式表。
 * 逻辑维度：声明模块化 CSS 的默认导出，再声明普通 CSS 的副作用导入。
 * 关键边界：类型不验证文件与选择器是否存在，最终结果取决于构建器。
 * 新手阅读建议：先看模块化导入怎样返回对象，再看普通 CSS 为何没有返回值。
 */
/** 使用方式：`import styles from './Attachment.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码类名，值是构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './attachment.css'` 的纯样式副作用导入，不导出变量。 */
declare module '*.css'
