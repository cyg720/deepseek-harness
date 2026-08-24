/**
 * 文件职责：为会话日志导出命令和下载对话框的 CSS 导入提供类型声明。
 * 技术维度：使用环境模块声明描述局部类名映射及普通 CSS。
 * 产品维度：导出入口、格式提示和下载对话框可安全加载样式。
 * 逻辑维度：先声明模块化 CSS 默认导出，再允许普通样式副作用。
 * 关键边界：该类型不影响日志访问权限或导出内容，只处理样式导入。
 * 新手阅读建议：先看下载对话框组件，再对照命令入口的样式引用。
 */
/** 使用方式：`import styles from './ExportDialog.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建阶段生成的实际类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './export.css'` 的副作用导入，不提供默认导出。 */
declare module '*.css'
