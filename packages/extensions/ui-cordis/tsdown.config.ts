/**
 * 文件职责：声明 Cordis 动态插件定义卡片的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包 keyed 工具行和运行/停止控件。
 * 产品维度：用户可在 `cordis_define` 工具结果中直观看到并控制动态插件。
 * 逻辑维度：导入共享预设，再传入包名和两个 Node 端入口生成默认配置。
 * 关键边界：真正的运行与停止由动态运行器执行；invariant 构建入口不可移除。
 * 新手阅读建议：先看构建配置，再追踪工具行如何调用运行器的控制接口。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-cordis', ['lib/types/index.js'])
