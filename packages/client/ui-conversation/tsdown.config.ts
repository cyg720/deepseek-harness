/**
 * 文件职责：声明会话界面领域插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包 React 会话流、输入区和详情区域。
 * 产品维度：提供有序聊天记录、消息输入及会话详情等核心交互界面。
 * 逻辑维度：导入共享预设，再以包名与两个 Node 端入口生成默认配置。
 * 关键边界：会话状态仍由对象层拥有；本文件只配置构建且必须保留 invariant。
 * 新手阅读建议：先理解构建入口，再按骨架、聊天流、输入区和详情宿主阅读源码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-conversation', ['lib/types/index.js'])
