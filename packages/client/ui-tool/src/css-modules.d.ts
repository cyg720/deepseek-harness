/**
 * 文件职责：为工具调用界面包的 CSS Modules 导入提供 TypeScript 类型。
 * 技术维度：通过环境模块声明把局部样式导入表示为字符串映射。
 * 产品维度：调用树和专用工具视图可共享类型明确的模块化样式用法。
 * 逻辑维度：声明 `*.module.css` 模块并默认导出类名映射。
 * 关键边界：类型不会枚举真实选择器，重命名 CSS 类时仍需同步修改组件。
 * 新手阅读建议：先找工具组件中的 `styles.xxx`，再对照同目录样式文件。
 */
/** 使用方式：`import styles from './Tool.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键和值为字符串，值由构建器哈希处理后生成。 */
  const classes: Record<string, string>
  export default classes
}
