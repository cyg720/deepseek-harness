/**
 * 文件职责：声明执行轨迹界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包事件账本和交互式耗时概览。
 * 产品维度：帮助用户查看一次任务中各步骤与事件的时间分布。
 * 逻辑维度：导入共享预设，再传入包名和两个 Node 端入口形成默认配置。
 * 关键边界：该插件只消费轨迹数据、不提供服务；invariant 构建入口不可移除。
 * 新手阅读建议：先理解构建入口，再从会话 ViewMap 注册处追踪轨迹数据展示。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成轨迹界面包的构建配置；参数是包标识与 Node 端入口，返回构建阶段配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-trajectory bundle` 时自动加载。
 */
export default clientBundle('@deepseek-ai/dsh-client-ui-trajectory', ['lib/types/index.js', 'lib/types/invariant.js'])
