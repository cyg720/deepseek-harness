/**
 * 文件职责：声明工作流运行界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包可耐久回放的会话节点和成员明细。
 * 产品维度：让用户在聊天记录中查看工作流整体状态及各成员执行详情。
 * 逻辑维度：导入共享预设，再用包名和两个 Node 端入口生成默认配置。
 * 关键边界：节点状态必须从会话日志确定性重放；invariant 构建入口不得省略。
 * 新手阅读建议：先看双端构建，再按事件匹配、状态折叠和嵌套展示阅读源码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-workflow-run', ['lib/types/index.js'])
