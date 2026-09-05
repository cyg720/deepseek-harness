/**
 * 文件职责：声明输入触发器插件的 Node 端与浏览器端构建入口。
 * 技术维度：通过 tsdown `clientBundle` 预设打包字符检测、候选菜单和来源路由。
 * 产品维度：用户输入 `/` 或 `@` 时可快速选择命令、文件、会话等候选项。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：候选来源由其他插件注册；本文件只构建且必须保留 invariant 入口。
 * 新手阅读建议：先理解双端产物，再按触发检测、候选聚合、选择路由阅读源码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-input-trigger', ['lib/types/index.js'])
