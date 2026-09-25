/** CSS 模块由浏览器打包器提供类名映射。 */
declare module '*.module.css' {
  const classes: Record<'dialog' | 'content' | 'row' | 'list', string>
  export default classes
}
