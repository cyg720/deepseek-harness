/**
 * 文件职责：声明客户端多语言包的 Node 端与浏览器端构建入口。
 * 技术维度：用 tsdown `clientBundle` 预设打包语言偏好、快照和类型化词典。
 * 产品维度：让 Web 客户端在中文与英文之间按用户偏好或浏览器环境显示。
 * 逻辑维度：导入共享预设，再以包名和两个 Node 端入口生成默认配置。
 * 关键边界：这里只决定构建产物；语言回退规则由包内源码负责，invariant 入口必须保留。
 * 新手阅读建议：先看构建入口，再阅读词典命名空间与语言偏好解析代码。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-locale', ['lib/types/index.js'])
