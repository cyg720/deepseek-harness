/** Browser-safe Connection protocol and shared application value exports. */

export type {
  ClientRequest,
  RpcError,
  RpcErrorCode,
  RpcMessage,
  RpcRequest,
  RpcResponse,
  RpcResult,
  ServerResponse,
} from '../rpc.ts'
export { RpcId, transportError } from '../rpc.ts'
export type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session/types'
export type { MessageId } from '@deepseek-ai/dsh-llm/brand'
export type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'

import type { RpcResponse, RpcResult } from '../rpc.ts'

/**
 * Return the business result carried by a narrow fixture response.
 * @param response - fixture response to unwrap.
 * @returns the response's business result.
 */
/*
 * 从一元RPC响应中取出业务层只关心的result槽。
 * @param response 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function resultOf<T>(response: RpcResponse<T>): RpcResult<T> {
  return response.result
}
