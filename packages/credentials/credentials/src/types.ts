/**
 * Client-safe type surface of the credential seam: the two key brands, the
 * stored-record union, and the seam's Cordis event declarations. Types only —
 * no runtime code, and nothing here reaches a Host-only symbol, so a Client
 * compilation face reads exactly the signature the Host emits.
 *
 * @module @deepseek-ai/dsh-credentials/types
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】凭据缝对"客户端"暴露的纯类型表面：两种键品牌类型、存储记录联合
 *   （ApiKeyRecord/GrantRecord）、以及两个更新事件声明。只含类型、无运行时代码。
 * 【技术维度】Branded 品牌类型 + declaration merging 扩展 Cordis Events；记录以 kind 判别联合
 *   区分"API 键"与"授权凭据"两类载荷。
 * 【产品维度】事件供监听者感知凭据变更（如 token 刷新后通知 UI 刷新状态）；记录联合让各插件
 *   用自己的格式存放授权结果。
 * 【逻辑维度】CredentialRef → CredentialKey（含"scope 作属主"的设计理由）→ ApiKeyRecord/
 *   GrantRecord → 记录联合 → 两个事件的声明与语义。
 * 【关键边界】GrantRecord.payload 对缝不透明，只要求 JSON 往返可存活；两种键文法不相交，
 *   因此两个事件分开声明，监听者无需猜测主题属于哪个空间。
 * 【新手阅读建议】对照 index.ts 的抽象方法签名阅读，重点理解 CredentialKey 的属主语义。
 * ==========================================================================
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

// 凭据引用是"品牌"类型：底层是字符串，但形状必须是环境变量名（如 DEEPSEEK_API_KEY）。
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
export type CredentialRef = Branded<'CredentialRef'>

/**
 * Nominal address of one stored credential record: `<scope>/<id>`, where
 * `scope` is the registered name of the plugin that owns the record and `id`
 * is that plugin's own addressing unit (an LLM adapter uses its provider route
 * key).
 *
 * The scope is the owner rather than the domain because a record's payload is
 * written in its owner's format: two plugins serving the same provider name
 * would otherwise read each other's payload, and a record left behind by an
 * uninstalled plugin could not be told apart from a live one. The `/` also
 * keeps this grammar disjoint from {@link CredentialRef}, so the two key
 * spaces can never collide.
 */
// 记录键：<属主插件名>/<插件自己的寻址单位>；用属主而非域名做前缀，避免不同插件互相读错载荷，
// 也能识别卸载插件留下的孤儿记录；'/' 使本文法与引用名文法永远不相交。
export type CredentialKey = Branded<'CredentialKey'>

/**
 * A credential the harness itself understands: an api key, provider
 * environment values, or both. Either field may be absent — a record carrying
 * neither states that the owner confirmed this route authenticates from its
 * own ambient discovery, which is a different fact from having no record.
 */
// API 键记录：可携带 key、环境值或两者都没有——两者皆无代表属主确认"走自身环境发现即可认证"，
// 这与"完全没有记录"是两种不同的事实。
export interface ApiKeyRecord {
  /** Discriminant. */
  readonly kind: 'api-key'
  /** The non-empty secret value, when this credential is a key at all. */
  readonly key?: string
  /** Provider environment values such as `AWS_PROFILE`; names are POSIX identifiers. */
  readonly env?: Readonly<Record<string, string>>
}

/**
 * The product of one authorization grant, kept verbatim for its owner. The
 * seam never reads, validates, or reshapes {@link payload}: it is written in
 * the owning plugin's format and only that plugin can interpret it. The single
 * constraint is that it survives a JSON round trip.
 */
// 授权凭据记录：payload 是属主自定义的 JSON 值，缝不解读、不校验、不改形，只要求它能经 JSON 往返。
export interface GrantRecord {
  /** Discriminant. */
  readonly kind: 'grant'
  /** Owner-defined JSON value; opaque to the seam and to every other plugin. */
  readonly payload: unknown
}

// 存储记录联合：按 kind 判别；缝据此决定可做的操作——API 键可解析，授权凭据原样保留。
/** One durable credential record, tagged by what the seam may do with it. */
export type CredentialRecord = ApiKeyRecord | GrantRecord

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to a provider-managed credential source: a `set`, an
     * `unset`, or an external edit observed in storage. Ambient
     * process-environment changes are not observable and never emit. Listener
     * failures are contained and logged — a sync throw and an async rejection
     * alike — without changing the committed operation's outcome, except
     * `INVARIANT`-coded failures, which rethrow after every listener ran;
     * that rethrow reaches the emitter only from synchronous listeners, so
     * invariant checks on this event must not be async functions.
     * @param ref - the reference whose stored value changed.
     * @mode emit
     */
    // 引用半区变更事件：set/unset 或外部编辑提交后发出；进程环境变量的无感变化不可观测、永不发出。
    'credentials/reference-updated'(ref: CredentialRef): void

    /**
     * Committed change to a stored credential record: a `modifyRecord` that
     * wrote, a `deleteRecord` that removed, or an external edit observed in
     * storage. Separate from `credentials/reference-updated` because the two key
     * grammars are disjoint — a listener that received both on one event could
     * not tell which space a subject belongs to. Listener failures are
     * contained on the same terms as `credentials/reference-updated`.
     * @param key - the record whose stored value changed.
     * @mode emit
     */
    // 记录半区变更事件：modifyRecord 写入、deleteRecord 删除或外部编辑后发出；与引用事件分开，
    // 监听者无需猜测主题属于哪个键空间。
    'credentials/record-updated'(key: CredentialKey): void
  }
}
