/**
 * 文件职责：声明后台任务列表插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包会话任务帧投影和标题栏列表。
 * 产品维度：让用户在会话头部查看正在运行或已更新的后台任务。
 * 逻辑维度：导入共享预设，再用包名及两个 Node 端入口生成默认配置。
 * 关键边界：任务事实来自会话帧，本文件不管理任务生命周期；invariant 入口不可省略。
 * 新手阅读建议：先看构建入口，再追踪 session/jobs 帧如何更新列表状态。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-jobs', ['lib/types/index.js'])
