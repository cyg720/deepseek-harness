/**
 * 文件职责：声明模型选择界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包 `/model` 命令与弹窗选择界面。
 * 产品维度：让用户在当前会话中查看可用模型并切换模型。
 * 逻辑维度：导入共享预设，再以包名及两个 Node 端入口生成默认配置。
 * 关键边界：可选模型和切换操作来自会话服务；本文件只配置构建并保留 invariant。
 * 新手阅读建议：先理解入口数组，再追踪模型列表、选择命令和会话更新。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-model-selection', ['lib/types/index.js'])
