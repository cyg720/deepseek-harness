/**
 * 文件职责：为后台任务列表界面的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：用环境模块声明区分类名映射和普通 CSS 副作用导入。
 * 产品维度：会话头部的任务状态列表可安全引用模块化样式。
 * 逻辑维度：声明模块化 CSS 默认对象，再允许加载普通样式表。
 * 关键边界：声明不验证实际样式内容，视觉结果仍需界面测试确认。
 * 新手阅读建议：先看任务列表组件引用哪些类，再对照模块化 CSS。
 */
/* 使用方式：`import styles from './Jobs.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建后的实际类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './jobs.css'` 的副作用导入，不提供导出值。 */
declare module '*.css'
