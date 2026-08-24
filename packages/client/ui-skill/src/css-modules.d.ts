/**
 * 文件职责：为技能引用和工具行界面的 CSS 导入提供类型声明。
 * 技术维度：通过环境模块声明描述模块化类名与普通 CSS 副作用。
 * 产品维度：技能候选项和技能工具结果可加载各自的局部样式。
 * 逻辑维度：声明 CSS Modules 默认映射，再允许导入普通样式表。
 * 关键边界：声明不影响技能执行，也不能验证具体类名是否存在。
 * 新手阅读建议：分别查看技能引用来源和工具行组件的样式导入。
 */
/** 使用方式：`import styles from './Skill.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建生成的实际类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './skill.css'` 的副作用导入，不提供导出值。 */
declare module '*.css'
