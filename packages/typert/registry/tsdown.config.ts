/**
 * 文件职责：声明 Typert 运行时注册表的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包生成的包反射信息和 Zod 校验模式。
 * 产品维度：为远程 API 和开发工具提供可查询、可校验的类型运行时信息。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：注册内容来自生成器，不能在此手工补录；invariant 入口必须保留。
 * 新手阅读建议：先看构建入口，再理解生成器如何产出并注册类型与模式。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-typert-registry', ['lib/types/index.js'])
