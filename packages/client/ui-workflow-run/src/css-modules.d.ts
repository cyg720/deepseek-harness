/**
 * 文件职责：为工作流运行会话节点的 CSS 导入提供 TypeScript 声明。
 * 技术维度：通过环境模块声明支持局部类名表和普通样式副作用。
 * 产品维度：工作流总体状态与嵌套成员明细可使用隔离样式。
 * 逻辑维度：先声明模块化 CSS 默认导出，再声明普通 CSS 文件。
 * 关键边界：声明不影响可重放状态折叠，也不检查真实类名。
 * 新手阅读建议：先看外层运行节点，再追踪嵌套成员组件的样式引用。
 */
/* 使用方式：`import styles from './WorkflowRun.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建产生的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './workflow.css'` 的副作用导入，不导出变量。 */
declare module '*.css'
