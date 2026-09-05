/**
 * 文件职责：声明客户端命令界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包命令来源、弹窗选择器和界面类型。
 * 产品维度：让用户通过 `/` 快速发现并执行目录、会话等命令。
 * 逻辑维度：导入共享预设，再传入包名和两个 Node 端入口形成默认配置。
 * 关键边界：命令注册和执行策略位于业务源码；invariant 入口不能从清单移除。
 * 新手阅读建议：先看构建输出，再追踪 `/` 来源、命令注册与选择结果的传递。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-commands', ['lib/types/index.js'])
