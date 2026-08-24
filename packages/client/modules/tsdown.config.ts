/**
 * 文件职责：声明客户端模块系统包的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包启动图组合器和延迟 CJS 模块表。
 * 产品维度：保证 Web 插件按模块依赖到达，并交给 Cordis Loader 组合运行。
 * 逻辑维度：导入共享预设，再分行传入包名和两个 Node 端入口生成默认配置。
 * 关键边界：模块请求顺序不同于 Cordis 服务激活顺序；invariant 入口不可删除。
 * 新手阅读建议：先看双端入口，再分别阅读主机启动图和浏览器模块表实现。
 */
import { clientBundle } from '../tsdown.client.ts'

/**
 * 生成客户端模块系统的构建配置；参数为包标识和 Node 端入口，返回配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-modules bundle` 时自动加载。
 */
export default clientBundle(
  '@deepseek-ai/dsh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
