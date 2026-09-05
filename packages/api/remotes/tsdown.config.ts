/**
 * 文件职责：声明远程 BFF 组合包的 Node 端与浏览器端构建入口及阶段位置。
 * 技术维度：使用 tsdown `clientBundle` 预设，并通过 `hostPhase` 提前生成 Node 构件。
 * 产品维度：为 Web 远程调用提供主机侧 Agent/Session 查找策略和客户端入口。
 * 逻辑维度：传入包名、两个 Node 端入口以及主机构建阶段选项。
 * 关键边界：主机反射依赖要求 Node 构件提前产出；invariant 入口不可省略。
 * 新手阅读建议：先理解 `hostPhase` 的时序作用，再阅读 BFF 组装与查找策略。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * 生成远程 API 包配置；前两项参数为包标识和入口，第三项把 Node 构件放到 Host 阶段。
 * 返回值是分阶段 tsdown 配置函数；运行 `pnpm --filter @deepseek-ai/dsh-api-remotes bundle` 使用。
 */
export default clientBundle(
  '@deepseek-ai/dsh-api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)
