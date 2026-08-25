/**
 * 文件职责：为应用内目录浏览界面的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：用环境模块声明表示 CSS Modules 类名表和普通 CSS 副作用导入。
 * 产品维度：目录列表、创建操作和选择流程可安全加载各自样式。
 * 逻辑维度：先声明模块化 CSS 默认导出，再声明无返回值的普通 CSS。
 * 关键边界：类型不验证路径或类名是否存在，实际解析由客户端构建器完成。
 * 新手阅读建议：先比较两类导入的返回差异，再对照目录浏览组件。
 */
/* 使用方式：`import styles from './Browser.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码选择器，值为构建后隔离的类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './browser.css'` 的纯样式导入，不提供可读取返回值。 */
declare module '*.css'
