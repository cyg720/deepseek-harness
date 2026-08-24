/**
 * 文件职责：为三栏应用布局的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：使用环境模块声明描述模块化类名和普通 CSS 文件。
 * 产品维度：AppFrame、面板与拖拽手柄可加载隔离或共享样式。
 * 逻辑维度：先声明 CSS Modules 映射，再声明无返回值的普通 CSS。
 * 关键边界：类型不约束布局数值，也不能检查选择器是否实际存在。
 * 新手阅读建议：先从 AppFrame 的类名引用理解各布局区域。
 */
/** 使用方式：`import styles from './AppFrame.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源类名，值为构建阶段生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './layout.css'` 的纯样式副作用导入。 */
declare module '*.css'
