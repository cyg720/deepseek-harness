/**
 * 文件职责：声明客户端 jsdom 测试运行时的 Node 库构建入口。
 * 技术维度：调用 tsdown `clientLibrary` 预设，仅在客户端编译阶段输出 Node ESM 库。
 * 产品维度：让界面测试使用真实 Cordis、插槽注册表和可控会话替身。
 * 逻辑维度：导入客户端库预设，再传入测试包名和两个 Node 端入口。
 * 关键边界：该包只供测试使用，不生成动态浏览器插件包；invariant 入口必须保留。
 * 新手阅读建议：先理解它为何是测试库，再查看测试如何创建运行时和会话替身。
 */
import { clientLibrary } from '../../client/tsdown.client.ts'

/**
 * 生成测试运行时库配置；参数为包标识与入口数组，返回客户端阶段的 Node 构建配置。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-test-runtime bundle` 时自动加载。
 */
export default clientLibrary(
  '@deepseek-ai/dsh-client-test-runtime',
  ['lib/types/index.js'],
)
