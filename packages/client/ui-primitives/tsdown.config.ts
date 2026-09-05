/**
 * 文件职责：声明通用 UI 原子组件包的静态浏览器构建入口。
 * 技术维度：使用 tsdown `staticLinked` 预设输出由 Web 外壳直接链接的 ESM 构件。
 * 产品维度：为按钮、图标、Markdown 和 JSON 查看器提供统一基础组件。
 * 逻辑维度：导入静态链接预设，再传入包名及两个类型编译后的入口。
 * 关键边界：静态链接包不能同时成为动态模块表条目；invariant 入口必须保留。
 * 新手阅读建议：先理解静态链接与动态插件包的区别，再阅读组件导出清单。
 */
import { staticLinked } from '../tsdown.client.ts'

/**
 * 生成 UI 原子组件包配置；参数为包标识和入口数组，返回仅客户端阶段使用的配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-primitives bundle` 时自动加载。
 */
export default staticLinked(
  '@deepseek-ai/dsh-client-ui-primitives',
  ['lib/types/index.js'],
)
