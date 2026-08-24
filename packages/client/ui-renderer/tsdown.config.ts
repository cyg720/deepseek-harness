/**
 * 文件职责：声明浏览器界面渲染器的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包 React 插槽绑定与应用根节点。
 * 产品维度：把各插件贡献的界面组合成用户最终看到的完整 Web 应用。
 * 逻辑维度：导入共享预设，再用包名及两个 Node 端入口生成默认配置。
 * 关键边界：业务组件不能直接读取 Cordis 上下文；本文件仅构建并保留 invariant。
 * 新手阅读建议：先理解双端产物，再从应用根节点阅读插槽绑定和 Provider 组合。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成界面渲染器的构建配置；参数为包标识和 Node 端入口，返回分阶段配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-ui-renderer bundle` 时自动加载。
 */
export default clientBundle('@deepseek-ai/dsh-client-ui-renderer', ['lib/types/index.js', 'lib/types/invariant.js'])
