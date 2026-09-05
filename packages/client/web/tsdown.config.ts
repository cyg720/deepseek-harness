/**
 * 文件职责：声明 Web 启动内核包的静态浏览器构建入口。
 * 技术维度：使用 tsdown `staticLinked` 预设输出模块表、Loader 和启动页 ESM 构件。
 * 产品维度：在动态插件加载前建立浏览器应用并把控制权交给界面渲染器。
 * 逻辑维度：导入静态链接预设，再用包名及两个编译入口生成默认配置。
 * 关键边界：该包由最终 Web 外壳静态链接，不能同时作为动态模块表条目。
 * 新手阅读建议：先看静态构建位置，再按模块表、Loader、启动页和交接顺序阅读。
 */
import { staticLinked } from '../tsdown.client.ts'

/**
 * 生成 Web 启动内核配置；参数是包标识与入口数组，返回客户端构建配置函数。
 * 使用示例：运行 `pnpm --filter @deepseek-ai/dsh-client-web bundle` 时自动加载。
 */
export default staticLinked(
  '@deepseek-ai/dsh-client-web',
  ['lib/types/index.js'],
)
