/**
 * 文件职责：为主题包的模块化、普通和内联 CSS 导入提供 TypeScript 声明。
 * 技术维度：用环境模块声明区分类名映射、副作用样式与 `?inline` 文本。
 * 产品维度：主题组件可使用局部样式，运行时也能读取编译后的主题 CSS 文本。
 * 逻辑维度：依次声明模块 CSS、普通 CSS，以及返回字符串的内联查询。
 * 关键边界：内联文本是公开构件内容；类型不验证实际选择器或 CSS 合法性。
 * 新手阅读建议：先比较三种导入返回值，再追踪主题运行时如何安装样式。
 */
/* 使用方式：`import styles from './Theme.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源类名，值为构建后的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './theme.css'` 的纯样式副作用导入。 */
declare module '*.css'

/** 使用方式：`import css from './theme.css?inline'`，返回编译后的完整 CSS 文本。 */
declare module '*.css?inline' {
  /** 内联 CSS 字符串；值由构建器生成，调用方只读使用。 */
  const css: string
  export default css
}
