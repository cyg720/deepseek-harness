/**
 * 文件职责：为交付物界面包的模块化和普通 CSS 导入提供 TypeScript 声明。
 * 技术维度：通过环境模块声明描述类名映射和不产生导出值的样式导入。
 * 产品维度：产出文件尾栏和文件链接可使用局部样式及必要的共享规则。
 * 逻辑维度：先声明 `*.module.css` 默认导出，再声明普通 `*.css` 模块。
 * 关键边界：该类型不枚举可用类名，错误键只能由构建或界面测试发现。
 * 新手阅读建议：先看交付物组件怎样读取样式对象，再查看普通 CSS 的副作用。
 */
/* 使用方式：`import styles from './Deliverables.module.css'`，得到类名映射。 */
declare module '*.module.css' {
  /** 类名映射；键为源码类名，值为构建阶段产生的隔离类名。 */
  const classes: Record<string, string>
  export default classes
}

/** 允许 `import './deliverables.css'` 的纯样式导入；该声明不返回变量。 */
declare module '*.css'
