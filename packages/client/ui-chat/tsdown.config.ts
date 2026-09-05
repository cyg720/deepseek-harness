/**
 * 文件职责：声明客户端运行时核心包的 Node 端与浏览器端构建入口。
 * 技术维度：复用 tsdown `clientBundle` 预设打包 SlotRegistry 和 SessionRuntime。
 * 产品维度：为 Web 界面的插件插槽、会话对象和作用域树提供共同运行基础。
 * 逻辑维度：导入共享预设，再传入包名与两个 Node 端入口形成默认配置。
 * 关键边界：运行时对象的所有权规则不在这里定义；invariant 构建入口不可删除。
 * 新手阅读建议：先理解双端构件，再阅读运行时包中的会话对象层和插槽注册表。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-chat', ['lib/types/index.js'])
