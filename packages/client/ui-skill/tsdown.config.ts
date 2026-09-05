/**
 * 文件职责：声明技能引用与工具行插件的 Node 端和浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包技能引用来源和专用工具结果视图。
 * 产品维度：让用户可在 Web 中引用技能，并清楚看到技能工具的执行信息。
 * 逻辑维度：导入共享预设，再传入包名及两个 Node 端入口生成默认配置。
 * 关键边界：技能加载与执行由技能能力负责；本文件只构建且 invariant 不可删除。
 * 新手阅读建议：先看构建输出，再分别追踪技能引用来源和工具行渲染流程。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-skill', ['lib/types/index.js'])
