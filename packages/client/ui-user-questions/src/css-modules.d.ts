/**
 * 文件职责：为用户问答界面的 CSS Modules 导入提供只读类型声明。
 * 技术维度：通过 TypeScript 环境模块声明暴露只读字符串类名映射。
 * 产品维度：问题列表、选项和输入控件可安全使用彼此隔离的样式类名。
 * 逻辑维度：匹配模块化 CSS 导入，并默认导出不可写的类名集合。
 * 关键边界：只读限制防止调用方改写映射，但仍不能验证具体键是否存在。
 * 新手阅读建议：注意这里比普通 `Record` 多一层只读约束，再查看组件导入方式。
 */
/** 使用方式：`import styles from './Question.module.css'`，得到只读类名映射。 */
declare module '*.module.css' {
  /** 只读类名映射；键为源码类名，值为构建后的类名，调用方不能改写属性。 */
  const classes: Readonly<Record<string, string>>
  export default classes
}
