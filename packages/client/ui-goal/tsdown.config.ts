/**
 * 文件职责：声明会话目标栏插件的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包目标投影读取与 GoalBar 界面。
 * 产品维度：在输入区上方持续显示当前任务目标，帮助用户掌握执行方向。
 * 逻辑维度：导入共享预设，再以包名与两个 Node 端入口生成默认配置。
 * 关键边界：目标状态来自会话投影，本文件不持有业务状态；invariant 必须保留。
 * 新手阅读建议：先看构建配置，再从目标投影追踪数据到 GoalBar 的显示过程。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-goal', ['lib/types/index.js'])
