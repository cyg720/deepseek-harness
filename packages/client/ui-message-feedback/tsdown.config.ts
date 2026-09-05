/**
 * 文件职责：声明消息反馈控件插件的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包消息操作条贡献和远程反馈调用。
 * 产品维度：让用户可对单条助手消息提交反馈，辅助产品质量改进。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口生成默认配置。
 * 关键边界：反馈持久化由 Host Remote 负责；本文件不发送数据且 invariant 不可删除。
 * 新手阅读建议：先看构建配置，再追踪消息标识如何传给反馈远程接口。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-message-feedback', ['lib/types/index.js'])
