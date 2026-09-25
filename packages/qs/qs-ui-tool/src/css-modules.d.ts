/** CSS Modules 的类型声明：打包器把 `*.module.css` 编译成类名映射。 */
declare module '*.module.css' {
  /** 本地类名到打包后哈希类名的映射。 */
  const classes: Record<string, string>
  export default classes
}
