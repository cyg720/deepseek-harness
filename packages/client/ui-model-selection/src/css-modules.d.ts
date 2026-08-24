/**
 * 文件职责：为模型选择弹窗的 CSS 导入提供 TypeScript 类型声明。
 * 技术维度：用环境模块声明表示 CSS Modules 映射及普通 CSS 副作用。
 * 产品维度：模型列表、选中状态和弹窗内容可安全加载局部样式。
 * 逻辑维度：先声明类名对象默认导出，再允许直接导入普通 CSS。
 * 关键边界：类型只保证字符串映射，不能证明每个模型状态都有对应样式。
 * 新手阅读建议：先看模型选择组件的类名分支，再对照样式文件。
 */
/** 使用方式：`import styles from './ModelSelect.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源类名，值为构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './models.css'` 的副作用导入，不返回对象。 */
declare module '*.css'
