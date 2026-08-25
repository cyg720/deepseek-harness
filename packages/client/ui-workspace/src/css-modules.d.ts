/**
 * 文件职责：为工作区选择界面的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：使用环境模块声明描述模块化类名和普通 CSS 导入。
 * 产品维度：侧栏与空白页中的 WorkspacePicker 可加载一致样式。
 * 逻辑维度：声明 CSS Modules 映射默认导出，并允许普通样式副作用。
 * 关键边界：类型不授予目录权限，也不能检查样式类名是否存在。
 * 新手阅读建议：比较选择器在两个插槽中的样式与外层布局差异。
 */
/* 使用方式：`import styles from './Workspace.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码选择器，值是构建后的类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './workspace.css'` 的纯样式导入，不返回对象。 */
declare module '*.css'
