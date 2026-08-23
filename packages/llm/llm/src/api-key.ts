/**
 * ================================ 文件注释 ================================
 * 【文件职责】给出"合法 provider API key"的唯一判定标准：任何要把 key 放进
 * HTTP 请求头的适配器都复用这里的 normalizeApiKey 做校验。
 * 【技术维度】用正则定义 key 的合法字符集（可打印 ASCII、不含空格），并先
 * 去除首尾空白再判定；返回可辨识成功/失败原因的结果对象（可辨识联合）。
 * 【产品维度】API key 是用户配置的核心凭据：格式非法时在此给出明确诊断，
 * 而不是把错误甩给底层 fetch（后者只会报出晦涩的 UTF-16 码点错误）。
 * 【逻辑维度】常量 LEGAL_API_KEY（合法字符正则）→ 两个类型（拒绝原因、判定
 * 结果）→ 核心函数 normalizeApiKey：先 trim，再判空、判字符集，返回结果。
 * 【关键边界】只处理"已提供但不可用"的 key；key 缺失是配置层状态，本函数
 * 看不到。刻意排除 Latin-1 字符——传输层能带，但没有 provider 会颁发。
 * 【新手阅读建议】先看 LEGAL_API_KEY 正则，再读 normalizeApiKey 的英文注释
 * 了解"为什么要静默 trim"的设计决策。
 * ==========================================================================
 */

/**
 * The one definition of a well-formed provider API key, shared by every
 * adapter that puts one in an HTTP header.
 * @module @deepseek-ai/dsh-llm/api-key
 */

/**
 * （中文）合法 key 的字符范围：可打印 ASCII（0x21 到 0x7E），排除空格。
 * HTTP 头值必须能原样携带这些字符，且所有已知 provider 的 key 只使用它们；
 * 超出该集合的 key 根本无法到达任何 provider（fetch 会拒绝构造该头），所以
 * 这是传输层不变量而非某个 provider 的策略。
 */
/**
 * Characters an HTTP header value carries verbatim and every known provider
 * key uses: printable ASCII, space excluded. A key outside this set cannot
 * reach any provider — `fetch` refuses to build the header — so this is a
 * transport invariant rather than one provider's policy. Latin-1 is excluded
 * deliberately: a header could carry it, but no provider issues it, and
 * admitting it trades a local explained refusal for an opaque 401.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/**
 * （中文）key 不可用的原因：'empty' 表示去空白后为空（压根没配）；'illegal
 * Characters' 表示含有 HTTP 头无法携带的字符。
 */
/** Why a supplied API key cannot be used. */
export type ApiKeyRejection = 'empty' | 'illegalCharacters'

/**
 * （中文）对一次 key 校验的判定结果：成功时携带可用值，失败时携带拒绝原因，
 * 调用方通过 ok 字段区分两种情况。
 */
/** The verdict on one supplied API key. */
export type ApiKeyCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: ApiKeyRejection }

/**
 * （中文）校验一个"已提供"的 API key：先静默去除首尾空白（因为来自配置文件、
 * .env 或 shell 导出的 key 都可能带上多余空白），再判空、判字符集。
 * @param raw 配置/存储/输入时原样的 key 字符串。
 * @returns trim 后的可用 key，或不可用的原因。
 */
/**
 * Judge one *supplied* API key, trimming surrounding whitespace first.
 *
 * Trimming is silent because a padded key has one unambiguous reading; every
 * other defect is reported. Absence is a configuration state this function
 * never sees — a profile naming no credential authenticates through the
 * provider's own ambient discovery or OAuth — so callers decide whether a
 * value was supplied before asking.
 * @param raw - the key exactly as configured, stored, or typed.
 * @returns the trimmed key, or why it cannot be used.
 */
export function normalizeApiKey(raw: string): ApiKeyCheck {
  const value = raw.trim()
  if (value.length === 0) return { ok: false, reason: 'empty' }
  if (!LEGAL_API_KEY.test(value)) return { ok: false, reason: 'illegalCharacters' }
  return { ok: true, value }
}
