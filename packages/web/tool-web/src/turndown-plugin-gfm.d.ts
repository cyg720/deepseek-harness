/**
 * Ambient module declaration for `@joplin/turndown-plugin-gfm`, which ships no
 * types and has no DefinitelyTyped package. Only the composite `gfm` plugin is
 * declared; the package's individual plugins (`tables`, `strikethrough`, …)
 * stay undeclared until something imports them.
 */
/*
 * 文件职责：为没有官方类型的 GFM Turndown 插件补充最小模块声明。
 * 技术维度：使用 TypeScript 环境模块声明，并复用 TurndownService.Plugin 类型。
 * 产品维度：网页抓取结果转换为 Markdown 时可启用表格、删除线和任务列表语法。
 * 逻辑维度：只声明组合式 `gfm` 导出，不提前暴露未使用的独立插件。
 * 关键边界：声明必须跟随实际导入范围；第三方包新增 API 不会自动出现在这里。
 * 新手阅读建议：先看 gfm 常量类型，再到网页转换器查看插件如何安装。
 */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown'

  /** The composite GitHub-flavored-markdown plugin (tables, strikethrough, task lists, highlighted code blocks). */
  /* 组合式 GFM 插件常量；包含表格、删除线、任务列表和高亮代码块规则，只读安装。 */
  export const gfm: TurndownService.Plugin
}
