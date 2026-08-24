/**
 * 文件职责：为命令界面包的模块化和普通 CSS 导入提供 TypeScript 声明。
 * 技术维度：通过环境模块声明支持类名映射及无返回值的样式副作用导入。
 * 产品维度：命令菜单、弹窗和候选项可加载局部或全局样式。
 * 逻辑维度：先声明模块化 CSS 对象，再声明普通 CSS 文件类型。
 * 关键边界：声明不会检查真实类名，组件与样式文件重命名必须同步。
 * 新手阅读建议：从命令组件的两类 CSS 导入出发理解它们的用途差异。
 */
/** 使用方式：`import styles from './Commands.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源选择器，值为构建器生成的实际类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './commands.css'` 的副作用导入；没有默认导出值。 */
declare module '*.css'
