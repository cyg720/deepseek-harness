/**
 * 文件职责：声明计划模式界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包输入区控制项、计划投影和 `/plan` 命令。
 * 产品维度：让用户查看并切换当前会话的计划工作模式。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口形成默认配置。
 * 关键边界：计划状态由会话投影提供；本文件不改变模式且 invariant 入口不能移除。
 * 新手阅读建议：先看构建入口，再追踪计划投影如何驱动输入区控件与命令。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-plan', ['lib/types/index.js'])
