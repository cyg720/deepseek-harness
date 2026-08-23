/**
 * ================================ 文件注释 ================================
 * 【文件职责】downloads 域契约：宿主专用的下载表面——GET 下载通道族，是 SSE 流
 * events 域的镜像。无线上信封：载体的 GET 路由直接应答，浏览器 IApiClient 从不
 * 暴露它们。
 * 【技术维度】纯类型契约；方法签名带 AbortSignal（供底层读取取消）；返回 WHATWG
 * Response（附件响应）。
 * 【产品维度】用户在桌面宿主 GUI 中下载会话日志 ZIP（可含全部子代理后代），
 * 浏览器端无此能力（浏览器不直接触达宿主下载路由）。
 * 【逻辑维度】DownloadsApi 接口：sessionLog(request, signal) → Response。
 * 【关键边界】缺服务时在产生任何字节前应答 500、根会话缺失应答 404；本域不在
 * RpcMethodMap 中、不走一元信封。
 * 【新手阅读建议】与 downloads.schema.ts、session-export.ts、fetch/handler.ts 的
 * /api/session.export 路由对照阅读。
 * ==========================================================================
 */
/**
 * downloads domain contract: host-only download surfaces — the GET-download
 * channel family, the mirror of the SSE-stream `events` domain. No wire
 * envelope: the carrier's GET routes answer these directly, and the browser
 * `IApiClient` never exposes them.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Host-only download surfaces (no wire envelope; absent from IApiClient). */
// 宿主专用下载表面：无线上信封，且不出现在 IApiClient 中。
export interface DownloadsApi {
  /**
   * Stream one session-log ZIP — the root artifact verbatim plus each subagent
   * descendant's — as an attachment response. The carrier's GET route answers
   * this directly; the browser never calls it.
   * @param request - the root session id and whether to include descendants.
   * @param signal - cancellation for the underlying reads.
   * @returns the ZIP attachment response; missing services answer 500 and a
   * missing root session 404 before any byte is produced.
   */
  sessionLog(
    request: { sessionId: SessionId; includeDescendants?: boolean },
    signal: AbortSignal,
  ): Promise<Response>
}
