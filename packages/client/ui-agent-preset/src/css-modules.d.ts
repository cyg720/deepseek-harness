/**
 * 文件职责：为代理预设界面包中的 CSS Modules 导入提供 TypeScript 类型声明。
 * 技术维度：通过环境模块声明把 `*.module.css` 映射为字符串键值对象。
 * 产品维度：让预设选择与编辑组件可安全引用编译后的样式类名。
 * 逻辑维度：声明模块匹配规则，并默认导出类名映射常量。
 * 关键边界：该声明不校验具体类名是否存在，拼写错误仍需由构建或界面测试发现。
 * 新手阅读建议：先理解 CSS Modules 会改写类名，再查看组件如何读取 `styles.xxx`。
 */
/** 使用方式：`import styles from './Preset.module.css'`，返回该样式表的类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码类名，值是构建后的类名，导入方不应修改其中内容。 */
  const classes: Record<string, string>
  export default classes
}
