/**
 * 文件职责：声明客户端连接包的 Node 端与浏览器端构建入口。
 * 技术维度：复用 tsdown `clientBundle` 预设，生成连接服务的双端构件。
 * 产品维度：为 Web 客户端提供 HTTP 上行、WebSocket 下行及断线重连能力。
 * 逻辑维度：导入共享预设，再传入包名和两个 Node 端入口形成默认配置。
 * 关键边界：入口清单必须保留 invariant；连接协议和重连逻辑不在本文件中实现。
 * 新手阅读建议：先理解入口数组，再阅读 `src/client` 和共享构建预设。
 */
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-connection', ['lib/types/index.js'])
