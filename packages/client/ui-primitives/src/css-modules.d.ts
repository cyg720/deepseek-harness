/**
 * 文件职责：为通用 React 原子组件的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：使用环境模块声明支持 CSS Modules 类名表和普通 CSS。
 * 产品维度：按钮、图标、Markdown 与 JSON 查看器可统一使用类型明确的样式。
 * 逻辑维度：声明模块化样式默认导出，再允许无返回值的普通样式导入。
 * 关键边界：本声明不依赖 Cordis，也不验证具体组件选择器的存在性。
 * 新手阅读建议：先查看一个简单原子组件，再理解它如何从映射中读取类名。
 */
/** 使用方式：`import styles from './Button.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码类名，值是构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './primitives.css'` 的纯样式导入，不提供导出值。 */
declare module '*.css'
