/**
 * 文件职责：为计划模式界面包中的 CSS Modules 导入提供类型声明。
 * 技术维度：借助 TypeScript 环境模块声明表示构建生成的类名映射。
 * 产品维度：计划模式控件可安全引用局部样式而不暴露全局类名。
 * 逻辑维度：声明文件匹配规则，并把字符串映射作为默认导出。
 * 关键边界：声明覆盖任意模块化 CSS，无法在编译期检查单个选择器拼写。
 * 新手阅读建议：先看 `styles` 的导入类型，再查看计划控件对应的 CSS Modules 文件。
 */
/** 使用方式：`import styles from './Plan.module.css'`，得到构建后的类名表。 */
declare module '*.module.css' {
  /** 类名映射；键为源码选择器名，值为隔离后的实际类名。 */
  const classes: Record<string, string>
  export default classes
}
