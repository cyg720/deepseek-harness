/*
 * ================================ 文件注释 ================================
 * 【文件职责】settings 域契约：用户设置接缝（ctx.settings）的 Web 面孔。离开
 * 本域的每个载荷都被接缝脱敏（describe({ redactSecrets: true }) 语义）——
 * role('secret') 字段绝不随任何层响应过线，secrets 槽位列表是表单获知"只写
 * 字段存在且已配置"的方式。
 * 【技术维度】纯类型契约；schema 字段是序列化的 schemastery schema 信封
 * （schema.toJSON()，用 new Schema(json) 还原）；revision 是乐观并发版本号。
 * 【产品维度】设置界面：命名空间总览（分层值 + 表单 schema）、打开本地设置
 * 文档、合并/整体替换/路径操作三种写模式。
 * 【逻辑维度】SettingsSecretView → SettingsNamespaceView → SettingsPathOpView
 * → SettingsApi（describe/openDocument/update/replace/mutate）。
 * 【关键边界】update 的补丁可包含秘密字段（只写方向，不触碰则合并保留存储值）；
 * replace 是整体重置（section:{} 回到组合默认）；mutate 按"存储中的小节"而非
 * "调用方上次读到的"解析路径——秘密字段不会被副作用删除；describe 仅回环可用，
 * writable:false 让客户端禁用所有写控件。
 * 【新手阅读建议】与 settings.schema.ts 及 api-proxy.ts 的 settingsWrite 对照。
 * ==========================================================================
 */
/**
 * settings domain contract: the web face of the user-settings seam
 * (`ctx.settings`). Every payload that leaves this domain is redacted by the
 * seam (`describe({ redactSecrets: true })` semantics): `role('secret')`
 * fields never ride a response in any layer, and the `secrets` slot list is
 * how a form learns a write-only field exists and whether it is configured.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One schema-declared secret slot inside a redacted namespace value. */
// 脱敏命名空间值里的一个 schema 声明的秘密槽位。
export interface SettingsSecretView {
  /** Path from the section root to the removed field. */
  // 从小节根到被移除字段的路径。
  path: string[]
  /** Whether the slot currently holds a value (the value itself never rides). */
  // 槽位当前是否持有值（值本身绝不随响应过线）。
  set: boolean
}

/** Wire view of one registered settings namespace. */
// 一个已注册设置命名空间的线上视图。
export interface SettingsNamespaceView {
  /** Namespace key (`llm-deepseek`, `llm-pi-ai`, …). */
  // 命名空间键（llm-deepseek 等）。
  ns: string
  /** Serialized schemastery schema envelope (`schema.toJSON()`); rehydrate with `new Schema(json)`. */
  // 序列化的 schemastery schema 信封（用 new Schema(json) 还原）。
  schema: unknown
  /** Redacted resolved value (schema defaults → composition base → user layer). */
  // 脱敏后的解析值（schema 默认 → 组合基 → 用户层）。
  value: unknown
  /** Redacted composition base layer, when the registrant declared one. */
  // 脱敏后的组合基层（注册方声明时出现）。
  base?: unknown
  /** Redacted raw user section, when one exists; a field's presence here marks it user-overridden. */
  // 脱敏后的原始用户小节（存在时出现；字段在此出现即标记为用户覆盖）。
  user?: unknown
  /** When the owner applies changes. */
  // 属主应用变更的时机。
  applies: 'live' | 'restart'
  /** Every schema-declared secret slot with its configured state. */
  // 全部 schema 声明秘密槽位及其配置状态。
  secrets: SettingsSecretView[]
  /**
   * Monotonic revision of the raw user section this view was read at. Send it
   * back as `expectedRevision` on a write so a stale editor is refused rather
   * than silently overwriting a concurrent change.
   */
  // 本视图读取时原始用户小节的单调修订号：写入时作为 expectedRevision 回传，
  // 使过期编辑器被拒绝而非静默覆盖并发变更。
  revision: number
}

/**
 * One path-addressed edit carried by `settings.mutate`. `set` writes the
 * value at the path (creating intermediate objects); `unset` removes it. The
 * empty path addresses the section root.
 */
// settings.mutate 携带的一条按路径寻址的编辑：set 在路径处写入（自动创建中间
// 对象），unset 删除；空路径寻址小节根。
export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Settings-domain unary methods (the map keys settings.* of RpcMethodMap). */
// 设置域一元方法接口。
export interface SettingsApi {
  /**
   * Describe every registered namespace: redacted layered values plus the
   * serialized schema a client renders its form from. `hasDocument` reports
   * whether a file-backed provider owns a local document without exposing its
   * Host path. This method is loopback-only; `writable: false` (read-only
   * provider) tells the client to disable every write control.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    writable: boolean
    hasDocument: boolean
    namespaces: SettingsNamespaceView[]
  }>>

  /**
   * Materialize the configured local document when absent and ask the Host to
   * hand it to the platform text-document opener. macOS forces a text editor;
   * Linux and Windows use the desktop file association. The request carries
   * no path, so the browser cannot choose an arbitrary Host filesystem target.
   */
  openDocument(
    request: RpcRequest<{}>, signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>

  /**
   * Merge a patch into one namespace's user layer (validate → persist →
   * commit). Secret-role fields may be INCLUDED in the patch (write-only
   * direction); a form that leaves a secret untouched simply omits it and the
   * merge preserves the stored value. Responds with the namespace's new
   * redacted view; a schema or storage rejection is `settings-rejected`.
   */
  update(request: RpcRequest<{ ns: string; patch: object; expectedRevision?: number }>): Promise<RpcResponse<SettingsNamespaceView>>

  /**
   * Replace one namespace's user section wholesale — the removal/reset path a
   * merge cannot express (`section: {}` resets to composition defaults). Keys
   * absent from `section` are dropped, secrets included: a client must first
   * fold the descriptor's `user` layer (and re-supply any secret it wants to
   * keep) or accept the reset.
   */
  replace(request: RpcRequest<{ ns: string; section: object; expectedRevision?: number }>): Promise<RpcResponse<SettingsNamespaceView>>

  /**
   * Apply path-addressed edits to one namespace's user section, resolved
   * against the section as stored — NOT against whatever the caller last
   * read. This is the removal path for any client holding the redacted
   * descriptor: it names the field it means, so a secret the wire never
   * returned cannot be deleted as a side effect. `replace` remains the
   * deliberate wholesale reset.
   */
  mutate(
    request: RpcRequest<{ ns: string; ops: SettingsPathOpView[]; expectedRevision?: number }>,
  ): Promise<RpcResponse<SettingsNamespaceView>>
}
