/**
 * 文件职责：声明 Web 主题插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包主题运行时、令牌样式和设置行。
 * 产品维度：支持浅色、深色和跟随系统外观，并在插件加载前提供基础配色。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口生成默认配置。
 * 关键边界：主题运行时保持无 DOM 核心；invariant 构建入口不能省略。
 * 新手阅读建议：先看双端输出，再按主机引导、状态运行时、CSS 令牌阅读源码。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成主题包构建配置；参数为包标识和 Node 端入口，返回分阶段配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-theme bundle` 时自动加载。
 */
export default clientBundle(
  '@deepseek-ai/dsh-client-ui-theme',
  ['lib/types/index.js'],
)
