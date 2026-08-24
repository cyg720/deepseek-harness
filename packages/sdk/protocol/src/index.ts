/**
 * Shared wire protocol for the DeepSeek Harness SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@deepseek-ai/dsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@deepseek-ai/dsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @deepseek-ai/dsh-sdk-protocol
 */
/**
 * 文件职责：汇总 TypeScript 与 Python SDK 共同使用的 JSON-RPC 传输、请求、结果和通知类型。
 * 技术维度：使用 ESM 重导出和 TypeScript 类型导出建立无运行时重复的协议公共入口。
 * 产品维度：让运行时服务器与多语言客户端使用同一套线协议词汇，减少字段和状态漂移。
 * 逻辑维度：先导出行传输实现和响应错误，再导出传输接口，最后公开请求与通知类型映射。
 * 关键边界：此入口只定义协议，不启动服务器或子进程；线字段变化必须同步两个 SDK。
 * 新手阅读建议：先看 JsonRpcLineTransport 的消息流，再按 Initialize、Session、Subagent 类型分组阅读。
 */

// 运行时导出：JSON Lines 传输负责收发，JsonRpcResponseError 表示远端错误响应。
export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
// 传输类型：描述 JSON-RPC 对端必须提供的发送与事件接口，不产生运行时代码。
export type { JsonRpcTransportPeer } from './transport.ts'
// 协议类型：集中公开初始化、会话运行状态、提示请求和子代理通知的数据结构。
export type {
  HarnessSdkNotificationMap,
  HarnessSdkRequestMap,
  InitializeParams,
  InitializeResult,
  SdkRunStatus,
  SessionEventNotification,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'
