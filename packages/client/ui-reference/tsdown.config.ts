/**
 * 文件职责：声明统一引用来源插件的 Node 端与浏览器端构建入口。
 * 技术维度：使用 tsdown `clientBundle` 预设打包 `@` 文件与会话候选来源。
 * 产品维度：让用户在输入内容时统一搜索并插入文件或会话引用。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：引用解析和访问权限由对应能力负责；本文件只构建且必须保留 invariant。
 * 新手阅读建议：先看构建配置，再追踪输入触发器如何调用文件和会话来源。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-reference', ['lib/types/index.js'])
