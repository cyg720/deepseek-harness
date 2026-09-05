/**
 * 文件职责：声明代理预设界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设生成 Cordis 插件的双端构件。
 * 产品维度：支持选择默认代理预设、切换当前会话席位并编辑组合配置。
 * 逻辑维度：导入共享预设，再用包名及两个 Node 端入口生成默认配置。
 * 关键边界：这里只描述打包方式；预设选择语义和权限由业务源码负责。
 * 新手阅读建议：先确认包名与 invariant 入口，再阅读预设状态和界面注册代码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-agent-preset', ['lib/types/index.js'])
