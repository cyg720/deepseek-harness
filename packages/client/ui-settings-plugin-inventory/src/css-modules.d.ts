/**
 * 文件职责：为只读插件清单设置页的 CSS 导入提供 TypeScript 声明。
 * 技术维度：通过环境模块声明描述模块类名表和普通 CSS。
 * 产品维度：Loader 插件清单、状态和元数据可使用稳定的局部样式。
 * 逻辑维度：先暴露 CSS Modules 映射，再允许副作用式普通样式导入。
 * 关键边界：该类型不赋予插件修改能力，也不校验视觉选择器。
 * 新手阅读建议：先从清单行组件的 `styles` 属性反查样式文件。
 */
/* 使用方式：`import styles from './Inventory.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建器输出的类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './inventory.css'` 的纯样式导入，不返回对象。 */
declare module '*.css'
