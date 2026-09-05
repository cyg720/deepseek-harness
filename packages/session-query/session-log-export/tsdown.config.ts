/**
 * 文件职责：声明会话日志导出插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包 Web 导出命令和共享下载对话框。
 * 产品维度：让用户把会话日志下载到本地，用于审阅、排查或留存。
 * 逻辑维度：导入共享预设，再以包名与两个 Node 端入口形成默认配置。
 * 关键边界：导出内容受会话访问权限约束；本文件只构建并保留 invariant 入口。
 * 新手阅读建议：先理解双端输出，再追踪命令如何取得日志并打开下载对话框。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-session-log-export',
  ['lib/types/index.js'],
  { hostPhase: true },
)
