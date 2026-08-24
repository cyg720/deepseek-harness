/**
 * TypeScript client SDK for the DeepSeek Harness runtime: spawn the
 * `dsh-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `DeepSeekHarness` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @deepseek-ai/dsh-sdk-client
 */
/**
 * 文件职责：汇总 TypeScript SDK 的高级 Harness API、底层客户端、错误和公共类型。
 * 技术维度：使用 ESM 重导出和类型专用导出，驱动独立 JSON-RPC 运行时子进程。
 * 产品维度：让 Node.js 用户既可用简洁会话 API，也可直接控制协议请求和通知订阅。
 * 逻辑维度：先导出高级 API，再导出底层客户端与错误，最后转出协议错误和配置结果类型。
 * 关键边界：该包是纯库，不向 Cordis 注册插件；实际 Harness 组合由子进程自己的 cordis.yml 决定。
 * 新手阅读建议：应用开发先读 DeepSeekHarness 与 HarnessSession，需要协议控制时再看 HarnessClient。
 */

// 高级运行时导出：DeepSeekHarness 管理进程与运行，HarnessSession 表示可持续交互的会话。
export { DeepSeekHarness, HarnessSession } from './api.ts'
// 高级 API 类型：RunOptions 描述单次运行的可选输入。
export type { RunOptions } from './api.ts'
// 底层客户端导出：提供协议客户端和三类连接、协议、超时错误。
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
// 通知类型：NotificationSubscription 表示可释放的通知订阅。
export type { NotificationSubscription } from './client.ts'
// 协议错误：直接复用共享 SDK 协议包的 JSON-RPC 响应错误类型。
export { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol'
// 公共数据类型：内容块、两个客户端配置、通知筛选和运行结果。
export type {
  ContentBlock,
  DeepSeekHarnessOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
