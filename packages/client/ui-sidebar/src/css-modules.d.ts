/**
 * 文件职责：为会话侧栏界面的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：用环境模块声明支持 CSS Modules 映射和普通样式导入。
 * 产品维度：多级会话树、搜索、分组和状态点可使用隔离样式。
 * 逻辑维度：先声明类名对象默认导出，再声明纯样式模块。
 * 关键边界：类型不验证层级布局或选择器拼写，需由界面测试补充。
 * 新手阅读建议：从侧栏树节点的样式引用逐层理解组件结构。
 */
/** 使用方式：`import styles from './Sidebar.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源选择器，值是构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './sidebar.css'` 的纯样式导入，不返回变量。 */
declare module '*.css'
