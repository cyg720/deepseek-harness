/**
 * 文件职责：为子代理会话界面的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：使用环境模块声明支持模块化类名和普通 CSS 文件。
 * 产品维度：子会话目录、续接控件和引用候选可使用隔离样式。
 * 逻辑维度：先声明类名映射默认导出，再声明普通样式副作用。
 * 关键边界：类型不涉及子代理生命周期，也不检查样式选择器存在性。
 * 新手阅读建议：按目录、续接、引用三个界面入口查看样式使用。
 */
/* 使用方式：`import styles from './Subagent.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源类名，值是构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './subagent.css'` 的副作用导入，不返回对象。 */
declare module '*.css'
