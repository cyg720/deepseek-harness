/**
 * 文件职责：声明官方品牌界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包品牌插槽贡献。
 * 产品维度：在侧栏和会话欢迎区域展示 DeepSeek Harness 官方品牌内容。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：这里只配置构建，不应在此放置品牌组件或样式；invariant 入口必须保留。
 * 新手阅读建议：先理解该文件只连接构建预设，再查看品牌组件如何注册到插槽。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成官方品牌界面包的构建配置；参数是包标识和 Node 端入口，返回 tsdown 配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-brand-official bundle` 时自动加载。
 */
export default clientBundle('@deepseek-ai/dsh-client-ui-brand-official', ['lib/types/index.js', 'lib/types/invariant.js'])
