/**
 * 文件职责：为模型设置和引导对话框的 CSS 导入提供类型声明。
 * 技术维度：用环境模块声明支持类名映射与普通样式副作用导入。
 * 产品维度：模型列表、凭据状态和引导弹窗可使用隔离样式。
 * 逻辑维度：声明模块化 CSS 默认对象，再声明普通 CSS 模块。
 * 关键边界：声明不接触凭据数据，也不验证具体类名是否存在。
 * 新手阅读建议：先看设置表单，再看引导弹窗如何复用样式类型。
 */
/** 使用方式：`import styles from './Models.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源类名，值是构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './models.css'` 的副作用导入，不导出变量。 */
declare module '*.css'
