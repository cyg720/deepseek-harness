/**
 * 文件职责：为会话目标栏的模块化和普通 CSS 导入提供类型声明。
 * 技术维度：使用 TypeScript 环境模块声明描述类名映射和副作用样式。
 * 产品维度：GoalBar 可加载局部样式并保持与其他界面类名隔离。
 * 逻辑维度：声明 `*.module.css` 默认导出，并允许直接导入 `*.css`。
 * 关键边界：声明只约束字符串类型，不检查真实选择器是否存在。
 * 新手阅读建议：先看 GoalBar 的样式导入，再回到 CSS 文件核对类名。
 */
/* 使用方式：`import styles from './GoalBar.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码类名，值是构建器生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './goal.css'` 的副作用导入；模块没有默认导出。 */
declare module '*.css'
