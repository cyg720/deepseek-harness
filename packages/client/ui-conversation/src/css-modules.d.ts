/**
 * 文件职责：为会话界面领域的模块化和普通 CSS 导入提供 TypeScript 声明。
 * 技术维度：使用环境模块声明表示局部类名表和纯副作用全局样式。
 * 产品维度：聊天流、输入区和详情区域可按需使用隔离或共享样式。
 * 逻辑维度：声明模块化 CSS 默认导出，并允许导入没有返回值的普通 CSS。
 * 关键边界：类型只描述导入结果，不保证选择器存在或样式规则正确。
 * 新手阅读建议：先从组件的 `styles` 对象看局部样式，再识别普通 CSS 导入。
 */
/* 使用方式：`import styles from './Conversation.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './conversation.css'` 的副作用导入，不提供可读取返回值。 */
declare module '*.css'
