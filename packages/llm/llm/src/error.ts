/**
 * ================================ 文件注释 ================================
 * 【文件职责】定义 harness 统一错误基类 HarnessError 以及一批 provider 无关
 * 的规范错误码常量，并提供错误文本分类器（上下文超限、配额耗尽）与错误链
 * 渲染工具，供工具结果、回放、日志等场景复用。
 * 【技术维度】Error 子类携带稳定的机器可路由 code；错误文本分类依赖正则
 * 匹配 OpenAI 兼容 provider 的报错措辞；errorChain 用递归加循环检测渲染
 * 完整的 cause 链。
 * 【产品维度】LLM 调用失败需要被重试策略、UI 提示、日志一致地理解和呈现：
 * 统一 code 让上层按失败类别分流，统一的错误链渲染让用户看到最内层根因。
 * 【逻辑维度】基类与通用 code → 三个分类正则 → 两个文本分类函数 → 错误链
 * 渲染 → instanceof 收窄辅助。
 * 【关键边界】分类正则只认明确措辞，宁可漏判不可误判（误判会把不可重试的
 * 失败当可重试）；errorChain 只用于诊断展示，严禁解析其输出做路由。
 * 【新手阅读建议】先看 HarnessError 与 code 常量，再看 errorChain 的英文
 * 注释理解"包装器错误遮蔽根因"这个动机。
 * ==========================================================================
 */

/**
 * Harness error base with a stable machine-routable code and chained cause.
 * Package errors extend it so tool results and replay can retain failure class.
 * @module @deepseek-ai/dsh-llm/error
 */

/**
 * （中文）整个 harness 所有错误类型的基类：除了人类可读的 message，还携带
 * 一个稳定的、程序可路由的 code（如 NO_ADAPTER、RATE_LIMIT、INVARIANT），
 * 上层按 code 分流处理，绝不解析 message 文本。支持通过标准 ErrorOptions
 * 挂 cause 形成错误链；子类默认以构造函数名作为 name。
 */
/**
 * Base class for all harness errors. Carries a `code` (stable, programmatic —
 * e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
 * human-readable `message`, and supports `cause` chaining via the standard
 * `ErrorOptions`. `name` defaults to the subclass constructor name.
 */
export class HarnessError extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  // 中文：稳定的机器可路由失败分类（如 RATE_LIMIT）；上层按它分流，绝不解析 message。
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}

/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
// 中文：模型请求因超出上下文窗口而被拒绝时的规范错误码，provider 无关。
export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/** Canonical provider-neutral code for an exhausted account quota or balance. */
// 中文：账户配额或余额耗尽时的规范错误码（区别于瞬时的请求限流）。
export const QUOTA_EXCEEDED_CODE = 'QUOTA'

/**
 * （中文）响应正常结束但一个内容块都没有时的规范错误码：某些 provider 偶尔
 * 会返回"正常终止但零输出"的空完成，适配器把它归为此失败而不是产出空助手
 * 消息——空消息会让本轮在用户/循环面前无声地结束。由于这次尝试没有产出任何
 * 持久内容，重试策略把它视为可安全重复的失败。
 */
/**
 * Canonical provider-neutral code for a response that completed normally but
 * carried no content blocks at all. Providers occasionally emit a degenerate
 * completion (a terminal stop with zero output); adapters classify it as this
 * failure instead of yielding an empty assistant message, because an empty
 * message silently ends the turn with nothing for the user or the loop to act
 * on. The attempt produced nothing durable, so retry policy treats it as safe
 * to repeat.
 */
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'

/**
 * （中文）"提供了凭据但无法使用"（格式错误而非缺失）的规范错误码。与
 * MISSING_CREDENTIAL 的区别在于修法不同：应纠正已存的值而非补一个值。
 * 刻意排除在默认可重试集合之外——格式错误的凭据每次尝试都会同样失败。
 */
/**
 * Canonical provider-neutral code for a credential that was supplied but
 * cannot be used — malformed rather than absent. Distinct from
 * `MISSING_CREDENTIAL` because the fix differs: correct the stored value
 * rather than supply one. Deliberately outside the default retryable set —
 * a malformed credential fails identically on every attempt.
 */
export const INVALID_CREDENTIAL_CODE = 'INVALID_CREDENTIAL'

/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
// 中文：结构化错误码和明文措辞中"明确点名上下文长度/窗口超限"的匹配正则。
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]`
  + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  'i',
)

/** Request-size wording that ties "too large" directly to model context capacity. */
// 中文：把"请求太大"明确与模型上下文容量挂钩的措辞匹配正则。
const TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?`
  + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?`
  + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  'i',
)

/** "Exceeds" wording is safe only when its object is explicitly the model context. */
// 中文：只有宾语明确是"模型上下文"时，"exceeds"这类措辞才可信，否则容易误判。
const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}`
  + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}`
  + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  'i',
)

/**
 * （中文）识别 OpenAI 兼容 provider 与库适配器使用的"上下文超限"措辞。适配器
 * 会把 provider 返回的 code、type、message 文本全部拼成字符串传进来，这样无论
 * 错误是抛出来的还是随流内联返回的，都能共用这一个分类器。
 * @param detail 把 provider 的错误码/类型/消息文本拼接成的一个字符串。
 * @returns 当该文本表明请求超出了模型上下文窗口时返回 true。
 */
/**
 * Recognize the context-overflow wording used by OpenAI-compatible providers
 * and library adapters. Adapters pass all available provider code, type, and
 * message text so both thrown and in-band delivery styles share one classifier.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true when the detail identifies a request exceeding the model context window.
 */
export function isContextWindowExceededError(detail: string): boolean {
  return STRUCTURED_CONTEXT_OVERFLOW.test(detail)
    || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail)
    || TOO_LARGE_FOR_CONTEXT.test(detail)
    || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail)
    || EXCEEDS_MODEL_CONTEXT.test(detail)
}

/**
 * （中文）识别"账户配额/余额耗尽"这类终结性措辞，区别于瞬时请求限流。
 * @param detail 拼接后的 provider 错误文本。
 * @returns 仅当文本明确指向配额、余额、信用额度、预算或用量上限耗尽时返回 true。
 */
/**
 * Recognize provider wording that identifies an exhausted account quota rather
 * than a transient request-rate limit.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true only for terminal quota, balance, credit, budget, or usage-limit wording.
 */
export function isQuotaExceededError(detail: string): boolean {
  return /\binsufficient[\s_-]+(?:quota|balance|credits?)\b/i.test(detail)
    || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail)
    || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail)
    || /\b(?:balance|credits?)[\s_-]+(?:exhausted|depleted)\b/i.test(detail)
    || /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail)
}

/**
 * （中文）把捕获到的任意值渲染成带完整 cause 链（以及 AggregateError 成员）的
 * 文本，避免 undici 这类传输包装器的 "TypeError: fetch failed" 遮蔽底层根因。
 * 纯结构化失败则渲染其自带 message。只用于诊断展示（消息、通知、日志），
 * 绝不解析该输出做路由——路由应基于 HarnessError.code。
 * @param value catch 子句里捕获的值（类型为 unknown）。
 * @returns 最外层 message 在前，逐层追加 cause（与包装器 message 重复时跳过），
 * AggregateError 成员用方括号包裹、分号连接。
 */
/**
 * Render a thrown value with its full `cause` chain and AggregateError
 * members, so transport wrappers like undici's `TypeError: fetch failed`
 * surface the underlying failure instead of masking it. Plain structured
 * failures render their own data-backed `message`. Diagnostic-surface
 * rendering only (messages, notices, logs) — never parse the result; route on
 * {@link HarnessError.code}.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns the outermost message first, each cause appended with `: ` (skipped
 * when it repeats the wrapper message verbatim), and AggregateError members
 * bracketed and `; `-joined.
 */
export function errorChain(value: unknown): string {
  // Tracks the active recursion path (entries removed on exit), so only true
  // cycles are flagged and a diamond-shared cause still renders in full.
  // 中文：记录当前递归路径上的值（退出时移除），因此只有真正的循环引用会被
  // 标记，而被多个错误共享的"菱形" cause 仍能完整渲染。
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) {
        if (typeof current === 'object' && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, 'message')
          if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
            return descriptor.value
          }
        }
        return String(current)
      }
      const message = current.message === '' ? current.name : current.message
      const members = current instanceof AggregateError && current.errors.length > 0
        ? ` [${current.errors.map(render).join('; ')}]`
        : ''
      const causeText = current.cause === undefined || current.cause === null
        ? ''
        : render(current.cause)
      // Wrappers like `new HarnessError(String(value), code, { cause: value })`
      // repeat their cause verbatim; rendering it again would only add noise.
      // 中文：像 new HarnessError(String(value), code, { cause: value }) 这样的
      // 包装器会把 cause 原样重复一遍，再次渲染只会增加噪音，所以跳过。
      const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
      return `${message}${members}${cause}`
    } catch {
      // Only hostile coercion or hostile accessors (a throwing toString /
      // Symbol.toPrimitive on a non-Error, or a throwing message/name/cause/
      // errors getter on an Error subclass): this renderer feeds UI notices
      // and logs, so nothing may escape. Inner frames catch their own throws,
      // so only the hostile node collapses, not the whole chain.
      // 中文：只有"敌对"的强制转换或访问器（非 Error 对象上会抛错的 toString /
      // Symbol.toPrimitive，或 Error 子类上会抛错的 message/name/cause/errors
      // getter）才会走到这里：本渲染器喂给 UI 提示和日志，任何异常都不能逃逸。
      // 内层帧各自捕获自己的抛错，因此只有出问题的那一个节点塌缩，不会拖垮整条链。
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

/**
 * （中文）把任意抛出的值收窄（narrow）为 HarnessError，用于运行时边界的
 * instanceof 判断。
 * @param value catch 子句里捕获的值（类型为 unknown）。
 * @returns 仅对真实实例返回 true；鸭子类型或跨 realm（如来自不同 iframe/
 * vm 上下文）的错误不会命中收窄。
 */
/**
 * Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
 */
export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError
}
