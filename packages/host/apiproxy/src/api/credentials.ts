/*
 * ================================ 文件注释 ================================
 * 【文件职责】credentials 域契约：凭据引用接缝（ctx.credentials）的 Web 面孔。
 * 读取在结构上不含值——凭据视图只携带 configured/source/writable，没有值的槽位；
 * 值只在 credentials.set 中单向过线。
 * 【技术维度】纯类型契约；无枚举方法是有意设计——客户端从设置 schema 与值
 * （apiKeyEnv 字段）得知存在哪些引用。
 * 【产品维度】远程 GUI 的凭据管理：查看哪些 API 引用已配置、来源与可写性，
 * 设置/清除密钥；值绝不回显。
 * 【逻辑维度】CredentialView（单引用视图）→ CredentialsApi（describe 批量查询 /
 * set 写入 / unset 清除）。
 * 【关键边界】非法引用名是 bad-request；合法但未知的引用描述为未配置；只读层
 * （实时环境变量）遮蔽时 set/unset 以 credential-rejected 拒绝——否则写入看似
 * 成功而解析仍返回遮蔽值；unset 不存在的引用幂等成功。
 * 【新手阅读建议】与 api-proxy.ts 的 credentials 域实现及 settings 域对照阅读。
 * ==========================================================================
 */
/**
 * credentials domain contract: the web face of the credential-reference seam
 * (`ctx.credentials`). Reads are structurally value-free — a credential view
 * carries configured/source/writable and has no slot for the value — and the
 * value crosses the wire in exactly one direction, inside `credentials.set`.
 * There is no enumeration method by design: clients learn which references
 * exist from settings schemas and values (`apiKeyEnv` fields).
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Wire view of one credential reference's state. */
// 单个凭据引用的状态线上视图。
export interface CredentialView {
  /** Whether any layer currently supplies a non-empty value. */
  // 是否有某层当前提供了非空值。
  configured: boolean
  /** Winning layer when configured (`env`, `file`, …); provider vocabulary. */
  // 配置时的胜出层（env / file 等，提供者词汇）。
  source?: string
  /** Whether `credentials.set`/`credentials.unset` can affect this reference. */
  // set/unset 是否能影响此引用。
  writable: boolean
}

/** Credentials-domain unary methods (the map keys credentials.* of RpcMethodMap). */
// 凭据域一元方法接口。
export interface CredentialsApi {
  /**
   * Describe the named references (batch): configured state, winning source,
   * and writability — never values. An invalid reference name is a
   * `bad-request`; an unknown-but-valid one describes as unconfigured.
   */
  // 批量描述指定引用：配置状态、胜出来源与可写性——绝不回显值。
  describe(request: RpcRequest<{ refs: string[] }>): Promise<RpcResponse<{ credentials: Record<string, CredentialView> }>>

  /**
   * Store one credential value in the writable layer. Rejected with
   * `credential-rejected` while a read-only layer (the live environment)
   * shadows the reference — the write would otherwise appear to succeed while
   * resolution keeps returning the shadowing value.
   */
  // 在可写层存储一个凭据值；被只读层（实时环境）遮蔽时以 credential-rejected 拒绝。
  set(request: RpcRequest<{ ref: string; value: string }>): Promise<RpcResponse<{}>>

  /**
   * Remove one credential from the writable layer; same shadowing rejection
   * as `set`. Unsetting an absent reference succeeds (idempotent).
   */
  // 从可写层移除一个凭据；同样受遮蔽拒绝约束；清除不存在的引用幂等成功。
  unset(request: RpcRequest<{ ref: string }>): Promise<RpcResponse<{}>>
}
