/**
 * 文件职责：为 Cordis 动态插件定义卡片的 CSS 导入提供类型声明。
 * 技术维度：用环境模块声明支持模块类名映射与普通 CSS 副作用。
 * 产品维度：动态插件工具行、运行按钮和停止状态可使用隔离样式。
 * 逻辑维度：声明 CSS Modules 默认对象，再声明普通样式模块。
 * 关键边界：类型不控制动态插件执行，也不能验证按钮状态样式。
 * 新手阅读建议：从定义卡片的运行/停止分支反查对应类名。
 */
/* 使用方式：`import styles from './CordisCard.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码选择器，值为构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './cordis.css'` 的纯样式导入，不返回变量。 */
declare module '*.css'
