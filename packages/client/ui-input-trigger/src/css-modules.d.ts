/**
 * 文件职责：为输入触发候选菜单的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：通过环境模块声明支持 CSS Modules 和普通样式文件。
 * 产品维度：`/` 与 `@` 候选菜单可使用隔离类名和必要的共享样式。
 * 逻辑维度：先描述类名映射默认导出，再声明纯样式模块。
 * 关键边界：类型无法发现拼写错误的样式键，重命名时需要同步组件。
 * 新手阅读建议：从候选菜单组件的 `styles` 用法反查 CSS 选择器。
 */
/** 使用方式：`import styles from './Menu.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键和值均为字符串，值由 CSS Modules 构建步骤生成。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './trigger.css'` 的纯样式导入，不返回变量。 */
declare module '*.css'
