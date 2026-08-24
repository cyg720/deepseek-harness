/**
 * 文件职责：为 Web 启动内核的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：通过环境模块声明支持 CSS Modules 和普通样式文件。
 * 产品维度：框架无关启动页与应用交接界面可加载基础样式。
 * 逻辑维度：先声明模块类名映射，再允许无返回值的普通 CSS 导入。
 * 关键边界：声明不负责模块表或 Loader 启动顺序，只描述样式导入。
 * 新手阅读建议：先看启动页样式，再理解它何时交接给 UI Renderer。
 */
/** 使用方式：`import styles from './Boot.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源类名，值为构建器生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './web.css'` 的副作用导入，不产生导出值。 */
declare module '*.css'
