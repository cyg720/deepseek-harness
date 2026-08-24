/**
 * 文件职责：为通用设置与产品引导界面的 CSS 导入提供类型声明。
 * 技术维度：通过环境模块声明描述模块化类名和普通 CSS 副作用。
 * 产品维度：设置分区、外壳入口和欢迎提示可加载所需样式。
 * 逻辑维度：先声明 CSS Modules 映射，再允许导入普通样式表。
 * 关键边界：类型不检查选择器存在性，样式重命名必须同步组件代码。
 * 新手阅读建议：从 General 设置页和欢迎提示分别查看样式用法。
 */
/** 使用方式：`import styles from './General.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码选择器，值为构建生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './general.css'` 的纯样式导入，不提供返回值。 */
declare module '*.css'
