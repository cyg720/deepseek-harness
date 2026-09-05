/**
 * 文件职责：声明 API Gateway 包的 Node 端与浏览器端构建入口。
 * 技术维度：调用共享的 tsdown `clientBundle` 预设生成 ESM 库和浏览器插件包。
 * 产品维度：让 Typert 远程请求分发器及客户端 API 能作为可安装构件交付。
 * 逻辑维度：导入构建预设，再用包名和两个 Node 端入口生成默认配置。
 * 关键边界：入口清单必须显式保留 invariant，且这里不负责实现网关运行逻辑。
 * 新手阅读建议：先看包名和入口数组，再到共享预设了解不同构建阶段的输出。
 */
import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-api-gateway', ['lib/types/index.js'])
