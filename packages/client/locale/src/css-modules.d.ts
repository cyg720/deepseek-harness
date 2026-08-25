/**
 * 文件职责：为多语言客户端包的模块化和普通 CSS 导入提供 TypeScript 声明。
 * 技术维度：使用环境模块声明分别描述类名映射导入与纯副作用样式导入。
 * 产品维度：语言相关界面可加载隔离样式，也可挂载不导出值的全局样式。
 * 逻辑维度：先声明 `*.module.css` 的默认导出，再允许导入任意普通 `*.css`。
 * 关键边界：声明不检查文件存在性或类名拼写，实际处理仍由客户端构建器负责。
 * 新手阅读建议：先比较两种声明的返回差异，再查看源码中两类导入写法。
 */
/* 使用方式：`import styles from './Locale.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建时生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './locale.css'` 形式的副作用导入；该模块不提供可读取返回值。 */
declare module '*.css'
