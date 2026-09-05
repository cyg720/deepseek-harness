/**
 * 文件职责：声明子代理会话界面插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包子会话目录、续接路由和 `@` 来源。
 * 产品维度：让用户查看子代理工作、继续其任务并在输入中引用子会话。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：子代理生命周期由后端能力管理；本文件只声明构建且必须保留 invariant。
 * 新手阅读建议：先看构建入口，再按会话目录、续接操作和引用来源阅读源码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-subagent', ['lib/types/index.js'])
