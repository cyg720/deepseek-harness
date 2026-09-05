/**
 * 文件职责：声明 UI 插槽纯核心包的静态浏览器构建入口。
 * 技术维度：通过 tsdown `staticLinked` 预设输出插槽类型与注册 API 的 ESM 构件。
 * 产品维度：为所有 Web 插件提供统一、可组合的界面插槽基础。
 * 逻辑维度：导入静态链接预设，再用包名和两个编译入口生成默认配置。
 * 关键边界：该包由 Web 外壳静态链接，不能重复注册为动态模块表行。
 * 新手阅读建议：先看构建方式，再按 SlotMap、register 与四份 props 类型阅读源码。
 */
import { staticLinked } from '../tsdown.client.ts'

/**
 * 生成插槽核心包配置；参数是包标识与入口数组，返回客户端构建阶段配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-slots bundle` 时自动加载。
 */
export default staticLinked(
  '@deepseek-ai/dsh-client-ui-slots',
  ['lib/types/index.js'],
)
