/**
 * 文件职责：为执行轨迹账本与耗时概览的 CSS 导入提供类型声明。
 * 技术维度：用环境模块声明表示 CSS Modules 类名表和普通样式。
 * 产品维度：轨迹事件列表和交互式时间视图可安全加载样式。
 * 逻辑维度：声明模块类名默认对象，再允许直接导入普通 CSS。
 * 关键边界：类型不解释时间数据，也不能验证图表选择器是否齐全。
 * 新手阅读建议：先从轨迹列表阅读样式，再看时间概览的交互状态。
 */
/** 使用方式：`import styles from './Trajectory.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源选择器，值为构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './trajectory.css'` 的纯样式导入，不提供返回值。 */
declare module '*.css'
