/**
 * Service Definition for the credential-reference capability seam (`ctx.credentials`). Settings and composition files carry
 * *references* to secrets — environment-variable names — while providers own
 * the actual values and their storage. Consumers resolve a reference once per
 * operation, so a changed credential reaches the next operation without any
 * plugin restart, and configuration surfaces describe a reference without
 * ever seeing its value.
 * @module @deepseek-ai/dsh-credentials
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】凭据引用能力缝（ctx.credentials）的服务定义：定义两种互不相交的键空间——
 *   CredentialRef（环境变量名式引用，回答"这个引用背后是什么值"）与 CredentialKey
 *   （<scope>/<id> 记录地址，回答"某插件为某 id 持有什么凭据记录"）；抽象出 Provider 契约。
 * 【技术维度】Cordis Service 抽象类；品牌类型区分两种键空间；抽象方法声明解析/存储/枚举/
 *   串行改写的完整契约；notifyUpdated 做"包含式"事件分发（监听失败不阻断提交结果）。
 * 【产品维度】设置与合成文件只存"引用"而非秘密本身；每次操作重新解析引用，凭据变更无需重启
 *   即生效；配置界面可描述凭据的存在性/可写性而不接触其值。
 * 【逻辑维度】品牌构造与校验函数（credentialRef/credentialKey 等）→ 信息型接口
 *   （ResolvedCredential/CredentialInfo/CredentialRecordInfo）→ 抽象 Provider
 *   （引用半区 + 记录半区）→ 两个通知事件与包含式分发 fanOut。
 * 【关键边界】空存储值视为"处处不存在"，绝不伪装成已配置；记录半区只允许 modifyRecord 串行
 *   读改写（保证 token 刷新在跨进程下安全）；监听失败被包含并记日志，INVARIANT 类失败重抛。
 * 【新手阅读建议】先读 types.ts 弄清两种键空间与记录联合类型，再对照本文件的抽象方法与事件
 *   契约，最后看 credentials-local 包的实现体会"Provider 如何落地"。
 * ==========================================================================
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialInfo, CredentialKey, CredentialRecord, CredentialRef } from './types.ts'

export type {
  ApiKeyRecord, CredentialInfo, CredentialKey, CredentialRecord, CredentialRef, GrantRecord,
} from './types.ts'

// 引用名合法性正则：形如 POSIX 环境变量名（字母或下划线开头，可含字母/数字/下划线）。
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

// 记录键单段合法性正则：小写 kebab-case；两段用 '/' 连接，使记录键文法与引用名文法天然不相交。
/** Both halves of a {@link CredentialKey}; the `/` between them is what keeps it out of {@link REF_PATTERN}. */
const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Brand a raw string as a {@link CredentialRef}.
 * @param value - candidate reference; a POSIX shell identifier such as `DEEPSEEK_API_KEY`.
 * @returns the branded reference.
 */
// 把字符串"升级"为 CredentialRef 品牌类型并校验；不合法就抛 TypeError。
export function credentialRef(value: string): CredentialRef {
  if (!isCredentialRefName(value)) {
    throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`)
  }
  return value as CredentialRef
}

/**
 * Whether a raw string could name a reference at all. Consumers that receive
 * environment-variable names from somewhere else — a provider library's own
 * ambient discovery, a hook payload — ask this before resolving, because a name
 * outside the grammar has no reference to miss and should read as "not set"
 * rather than as a thrown error.
 * @param value - candidate reference.
 * @returns true when {@link credentialRef} would accept it.
 */
// 只判断名字是否合法、不抛错：外部来源的名字若不合文法，应读作"未配置"而非报错。
export function isCredentialRefName(value: string): boolean {
  return REF_PATTERN.test(value)
}

/**
 * Whether a raw string could be a {@link credentialKey} segment at all.
 * Consumers whose addressing units come from somewhere else — a settings dict
 * key, a library's own provider id — ask this before building a key, because a
 * unit outside the grammar can never have stored a record and should read as
 * "nothing stored" rather than as a thrown error.
 * @param value - candidate segment.
 * @returns true when {@link credentialKey} would accept it as either segment.
 */
// 只判断某段是否可用作记录键的一段、不抛错：不合文法的外来单位应读作"没有存过记录"。
export function isCredentialKeySegment(value: string): boolean {
  return KEY_SEGMENT_PATTERN.test(value)
}

/**
 * Brand a scope and an id as a {@link CredentialKey}.
 * @param scope - the owning plugin's registered name, such as `llm-pi-ai`.
 * @param id - that plugin's own addressing unit, such as a provider route key.
 * @returns the branded key.
 * @throws TypeError when either segment is not a lowercase hyphenated identifier.
 */
// 由属主插件名 + 插件自己的寻址单位拼出品牌键 <scope>/<id>；两段都必须是小写连字符标识符。
export function credentialKey(scope: string, id: string): CredentialKey {
  for (const segment of [scope, id]) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError(`credential key segment "${segment}" must match ${String(KEY_SEGMENT_PATTERN)}`)
    }
  }
  return `${scope}/${id}` as CredentialKey
}

/**
 * Brand a stored `<scope>/<id>` string as a {@link CredentialKey}. This is the
 * read half of {@link credentialKey}, for a provider admitting keys off disk.
 * @param value - candidate key in its joined form.
 * @returns the branded key.
 * @throws TypeError when the value is not exactly two valid segments.
 */
// 读盘侧的"解键"：把磁盘上的 <scope>/<id> 字符串还原为品牌键；恰好两段且都合法才算通过。
export function parseCredentialKey(value: string): CredentialKey {
  const segments = value.split('/')
  const [scope, id] = segments
  if (segments.length !== 2 || scope === undefined || id === undefined) {
    throw new TypeError(`credential key "${value}" must be "<scope>/<id>"`)
  }
  return credentialKey(scope, id)
}

/**
 * The owning plugin's name for one key. A record whose scope names no
 * currently registered owner is an orphan, which a configuration surface must
 * report as such rather than as a working credential.
 * @param key - the key to read.
 * @returns the scope segment.
 */
// 取键的属主段（'/' 之前）；scope 若对应不到已注册插件，该记录即"孤儿"，配置界面须如实上报。
export function credentialKeyScope(key: CredentialKey): string {
  // The brand's only constructors both validate two segments, so the split
  // cannot come back short here.
  return key.slice(0, key.indexOf('/'))
}

/**
 * The owning plugin's own addressing unit for one key — the half that plugin
 * chose, such as a provider route.
 * @param key - the key to read.
 * @returns the id segment.
 */
// 取键的 id 段（'/' 之后），即属主自己选择的寻址单位（如某 provider 路由）。
export function credentialKeyId(key: CredentialKey): string {
  return key.slice(key.indexOf('/') + 1)
}

// 一次解析的结果：非空秘密值 + 提供它的来源层 id（如 env/file/user-env）。
/** One resolved credential value and the source layer that supplied it. */
export interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}

/** Presence and writability facts for one record, safe for configuration UIs — never the value. */
export interface CredentialRecordInfo {
  /**
   * Whether a record is stored. Unlike a reference, presence alone answers
   * this: an {@link ApiKeyRecord} carrying neither a key nor environment
   * values states that its owner confirmed ambient authentication, which is
   * configured, not blank.
   */
  configured: boolean
  /** Discriminant of the stored record; absent while none is stored. */
  kind?: CredentialRecord['kind']
  /** Whether {@link CredentialProvider.modifyRecord} would currently succeed. */
  writable: boolean
}

// 记录枚举项：地址 + 判别标签，不含值——UI 由此列出"我授权了什么"并识别卸载插件留下的孤儿记录。
/** One stored record's address and tag, for enumeration — never its value. */
export interface CredentialRecordEntry {
  /** The record's address. */
  key: CredentialKey
  /** Discriminant of the stored record. */
  kind: CredentialRecord['kind']
}

// 把 credentials 服务挂到 Cordis Context：插件代码里 ctx.credentials 即该服务实例。
declare module '@deepseek-ai/cordis' {
  interface Context {
    credentials: CredentialProvider
  }
}

/**
 * Abstract credential service over two key spaces that answer two questions.
 *
 * A {@link CredentialRef} answers "what is behind this environment-variable
 * name", layered over the process environment, the provider-managed store, and
 * `.env` files. One seam-wide rule binds that half: an empty stored value is
 * absent everywhere — `resolve` skips it, `describe` reports it unconfigured —
 * so a blank never masquerades as a configured secret.
 *
 * A {@link CredentialKey} answers "what credential does this plugin hold for
 * this id". Nothing can layer here — an authorization grant has no
 * environment to be read from — so presence of the record is the whole fact,
 * and {@link modifyRecord} is the only write path because a correct write
 * depends on the current value (a token refresh is read-decide-replace under
 * one lock).
 */
// 抽象凭据服务：引用半区回答"这个环境变量名背后是什么值"（可跨环境/存储/.env 分层），
// 记录半区回答"这个键存了什么"（不可分层，只能经 modifyRecord 串行读改写）。
export abstract class CredentialProvider extends Service {
  constructor(ctx: Context) {
    super(ctx, 'credentials')
  }

  /**
   * Resolve one reference to its current value. Resolution is per call:
   * consumers re-resolve at each operation and must not cache across
   * operations — that per-operation read is what makes a changed credential
   * reach the next operation without a restart.
   * @param ref - the reference to resolve.
   * @returns the value and its source, or `undefined` while unconfigured.
   */
  // 每次调用都重新解析、不缓存：正是这种"按操作读取"让凭据变更无需重启即到达下一次操作。
  abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

  /**
   * Describe one reference for configuration surfaces without exposing the
   * value.
   * @param ref - the reference to describe.
   * @returns configured state, supplying source, and writability.
   */
  abstract describe(ref: CredentialRef): Promise<CredentialInfo>

  /**
   * Durably store one value in the provider-managed writable source. Rejects
   * while a read-only source shadows the reference — the write would appear
   * to succeed while resolution keeps returning the shadowing value — and
   * rejects an empty value (use {@link unset}).
   * @param ref - the reference to store.
   * @param value - the non-empty secret value.
   */
  // 在可写来源层持久保存一个值；被只读来源遮蔽时拒绝（避免"写成功但解析仍返回遮蔽值"的假象），空值也拒绝（请用 unset）。
  abstract set(ref: CredentialRef, value: string): Promise<void>

  /**
   * Remove one reference from the provider-managed writable source; removing
   * an absent reference is a no-op. Rejects while a read-only source shadows
   * the reference, like {@link set}.
   * @param ref - the reference to remove.
   */
  // 从可写来源层移除一个引用；移除不存在的引用是空操作；被只读来源遮蔽时同样拒绝。
  abstract unset(ref: CredentialRef): Promise<void>

  /**
   * Read one stored record. The value is returned as its owner wrote it; a
   * {@link GrantRecord} payload is not interpreted on the way out.
   * @param key - the record to read.
   * @returns the record, or `undefined` while none is stored.
   */
  // 读取一条存储记录；返回属主写入的原样值，GrantRecord 载荷不做任何解读。
  abstract readRecord(key: CredentialKey): Promise<CredentialRecord | undefined>

  /**
   * Describe one record for configuration surfaces without exposing its value.
   * @param key - the record to describe.
   * @returns presence, discriminant, and writability.
   */
  abstract describeRecord(key: CredentialKey): Promise<CredentialRecordInfo>

  /**
   * Enumerate every stored record's address and tag. Unlike the reference
   * half, which has no enumeration because configuration surfaces learn which
   * references exist from settings schemas, records have no such discovery
   * path: a surface that cannot list them cannot show what a user is
   * authorized for, nor find an orphan left by an uninstalled plugin.
   * @returns every stored record, values excluded.
   */
  abstract listRecords(): Promise<readonly CredentialRecordEntry[]>

  /**
   * Serialized read-modify-write over one record — the only write path.
   * `mutate` sees the record as it stands at the moment the write is
   * exclusive, and returning `undefined` leaves the entry untouched. Exclusion
   * holds across processes where the backing store supports it, which is what
   * makes a token refresh safe: two processes rotating one refresh token
   * concurrently would otherwise lose whichever wrote first.
   * @param key - the record to modify.
   * @param mutate - receives the current record and returns its replacement, or `undefined` to leave it.
   * @returns the record after the write, or the current one when `mutate` declined.
   */
  abstract modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined>

  /**
   * Remove one record; removing an absent record is a no-op.
   * @param key - the record to remove.
   */
  abstract deleteRecord(key: CredentialKey): Promise<void>

  /**
   * Fan `credentials/reference-updated` out with contained listener failures: every
   * listener runs, and a sync throw or async rejection is logged without
   * changing the committed operation's outcome — except `INVARIANT`-coded
   * failures, which rethrow after every listener ran (the rethrow reaches the
   * caller only from synchronous listeners, so invariant checks on this event
   * must not be async functions). Providers call this only after the write or
   * reload actually committed, so a broken observer can never make a durable
   * change look failed.
   * @param ref - the reference whose stored value changed.
   */
  protected notifyUpdated(ref: CredentialRef): void {
    this.fanOut('credentials/reference-updated', ref)
  }

  /**
   * Fan `credentials/record-updated` out on exactly the terms
   * {@link notifyUpdated} documents, for the record half of the seam.
   * @param key - the record whose stored value changed.
   */
  protected notifyRecordUpdated(key: CredentialKey): void {
    this.fanOut('credentials/record-updated', key)
  }

  /* jscpd:ignore-start -- deliberate symmetry with the settings seam's commit
     fan-out: the contained-dispatch shape is the reviewed listener-lifecycle
     contract, and extracting it would couple the two seams' event semantics. */
  /** The contained dispatch both notifications run through; see {@link notifyUpdated}. */
  private fanOut(event: 'credentials/reference-updated' | 'credentials/record-updated', subject: string): void {
    let invariantFailure: unknown
    const args = [event, subject]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(subject)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnListenerFailure(event, subject, error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnListenerFailure(event, subject, error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }
  /* jscpd:ignore-end */

  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  private warnListenerFailure(event: string, subject: string, error: unknown): void {
    this.ctx.logger.warn('credentials: a %s listener for "%s" failed', event, subject)
    this.ctx.logger.warn(error)
  }
}

export default CredentialProvider
