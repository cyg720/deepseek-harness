/**
 * 文件职责：为插件设置界面的 CSS Modules 导入提供 TypeScript 类型。
 * 技术维度：用环境模块声明把模块化样式抽象为字符串键值映射。
 * 产品维度：插件标签页和配置卡片能通过局部类名保持一致样式。
 * 逻辑维度：匹配模块化 CSS 文件，并默认导出构建后的类名集合。
 * 关键边界：此声明不限制可用键集合，错误类名不会由该类型单独发现。
 * 新手阅读建议：先从设置组件的 `styles` 用法反查实际 CSS 选择器。
 */
/* 使用方式：`import styles from './PluginCard.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键是源码类名，值是 CSS Modules 生成的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}
