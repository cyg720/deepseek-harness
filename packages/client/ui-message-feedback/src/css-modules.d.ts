/**
 * 文件职责：为消息反馈控件的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：通过环境模块声明支持模块化类名映射和普通样式导入。
 * 产品维度：点赞、点踩等消息操作控件可使用隔离的样式类名。
 * 逻辑维度：声明模块 CSS 的默认对象，并允许导入无返回值的普通 CSS。
 * 关键边界：声明不验证类名或交互状态样式，组件测试仍需覆盖视觉状态。
 * 新手阅读建议：从反馈按钮的 `styles` 引用反查对应样式规则。
 */
/** 使用方式：`import styles from './Feedback.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码选择器，值是哈希隔离后的类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './feedback.css'` 的副作用导入，不产生导出变量。 */
declare module '*.css'
