/**
 * 文件职责：声明客户端热更新包的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包 SSE 驱动的开发期热更新插件。
 * 产品维度：开发时可在插件重建后刷新相关界面逻辑，减少手动重启。
 * 逻辑维度：导入共享预设，并以包名及两个 Node 端入口生成默认配置。
 * 关键边界：该能力仅面向开发环境；入口清单中的 invariant 不可省略。
 * 新手阅读建议：先看此处如何接入构建，再阅读 HMR 客户端的失效与预取流程。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成 HMR 包的构建配置；参数是包标识和 Node 端入口，返回 tsdown 构建阶段配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-hmr bundle` 时自动加载。
 */
export default clientBundle('@deepseek-ai/dsh-client-hmr', ['lib/types/index.js', 'lib/types/invariant.js'])
