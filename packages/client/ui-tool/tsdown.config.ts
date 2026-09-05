/**
 * 文件职责：声明工具调用界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包调用树和按工具键选择的展示插槽。
 * 产品维度：让用户清楚查看工具调用的层级、状态和专用结果界面。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：工具执行事实来自会话数据；本文件只配置构建且必须保留 invariant。
 * 新手阅读建议：先看双端入口，再追踪通用调用树怎样选择具体工具视图。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-tool', ['lib/types/index.js'])
