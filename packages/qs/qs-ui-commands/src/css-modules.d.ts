/** 样式模块提供类名映射，副作用样式导入不暴露运行时值。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'
