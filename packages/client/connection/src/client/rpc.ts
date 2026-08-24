/** Browser caller for generic Connection unary RPC channels. */
/**
 * 文件职责：实现浏览器端通用Connection一元RPC调用器，构造请求信封、发送HTTP并校验响应关联。
 * 技术维度：使用Fetch API、Zod响应模式、品牌RpcId和URL目标规范化执行传输层调用。
 * 产品维度：为Typert等逻辑频道提供统一可靠的一元调用，并在HTTP失败、畸形响应或串线时快速报错。
 * 逻辑维度：校验频道与端点，生成rpcId和消息，POST到页面origin，解析服务端响应并核对相同rpcId。
 * 关键边界：频道必须是单个安全路径段；端点每段不得为空、点或点点；非页面环境使用内部占位origin。
 * 新手阅读建议：先看三个目标常量，再跟踪createWebConnectionRpc.call的请求与响应，最后看assertTarget拒绝规则。
 */

import {
  RpcId,
  serverResponseSchema,
  type ClientRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientConnectionRpc } from '../rpc.ts'
import { randomUuid } from './random-uuid.ts'

// 无页面origin的Worker或测试环境用于构造URL的内部占位基址。
const INTERNAL_BASE = 'http://dsh.internal'
// 通用RPC频道允许的单个绝对路径段格式。
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
// RPC端点中每个非空相对路径段允许的字符格式。
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** Transport this caller posts through; same signature as the global `fetch`. */
/** 调用器使用的fetch兼容POST传输签名。 */
export type RpcFetch = (input: URL, init: RequestInit) => Promise<Response>

/**
 * Create the browser-backed generic RPC caller.
 * @param doFetch - transport override; defaults to the page's global fetch.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(doFetch?: RpcFetch): ClientConnectionRpc {
  // 调用者传入的载体，省略时使用页面全局fetch。
  const send: RpcFetch = doFetch ?? ((input, init) => globalThis.fetch(input, init))
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      // 当前请求唯一且用于响应关联的品牌RPC标识。
      const rpcId = RpcId(randomUuid())
      // 发送到Host通用RPC桥接层的客户端请求信封。
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      // HTTP或宿主隧道返回的Fetch响应。
      const response = await send(
        new URL(`${channel}/${endpoint}`, resolveBase()),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
          ...signal === undefined ? {} : { signal },
        },
      )
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      // 经过协议模式验证的完整服务端响应信封。
      const full = serverResponseSchema.parse(await response.json())
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}

/** 取得当前页面origin，无有效页面时返回内部占位基址。 */
function resolveBase(): string {
  // 浏览器或宿主可能提供的最小location对象。
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}

/** 验证频道和端点只包含安全、非遍历的路径段。 */
function assertTarget(channel: string, endpoint: string): void {
  // 按斜杠拆分的逻辑端点段。
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}
