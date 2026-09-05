/**
 * 文件职责：声明附件展示插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包输入区附件和消息图片插槽贡献。
 * 产品维度：让用户在发送前管理附件，并在历史消息中查看图片内容。
 * 逻辑维度：导入共享预设，再分行传入包名和两个 Node 端入口生成默认配置。
 * 关键边界：附件读取和传输由专门能力负责；本文件只构建且必须保留 invariant。
 * 新手阅读建议：先理解构建配置，再分别追踪输入附件和消息图片的插槽注册。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成附件界面包的构建配置；参数是包标识与 Node 端入口，返回配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-attachment bundle` 时自动加载。
 */
export default clientBundle(
  '@deepseek-ai/dsh-client-ui-attachment',
  ['lib/types/index.js'],
)
