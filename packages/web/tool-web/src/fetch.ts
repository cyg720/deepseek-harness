/**
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是面向模型的 web_fetch 工具：抓取并返回指定 HTTP(S) URL 的文本内容。
 *             本模块拥有 schema、校验、HTML 转 Markdown 渲染与展示；检索本身归 ctx.web。
 * 【技术维度】defineTool 定义工具；turndown + GFM 插件做 HTML→Markdown 转换；自带深度上限
 *             保护（防止恶意嵌套 HTML 造成同步卡死）；输出与源输入双重字符上限；
 *             render/presentationMeta 用 WeakMap 记忆化共享一次转换结果。
 * 【产品维度】模型可"拿到具体网页全文"来回答需要精确内容的问题（如搜索结果详情）；
 *             超时是部署策略而非模型参数，防止模型把上下文预算当玩具。
 * 【逻辑维度】共享转换器 → 表格专用渲染规则 → 参数校验 → 深度保护 → 正文渲染 → 输出组装
 *             （renderFetchOutput 记忆化）→ meta 投影/回读 → 注册工具。
 * 【关键边界】深度超限或转换失败时降级为原始 HTML（差页面胜于报错）；时间与字符上限都在
 *             渲染前/后分两段施加；卡片展示的 truncated 与模型看到的文本必须一致。
 * 【新手阅读建议】先读 renderBody 与 computeFetchOutput（核心渲染管线），再读
 *             renderFetchOutput 看记忆化，最后看 applyWebFetchTool 的注册。
 * ==========================================================================
 */
/**
 * The model-facing `web_fetch` tool. This module owns its schema, validation, and presentation;
 * `ctx.web` owns retrieval. Timeout is deployment policy, not a model argument: config becomes
 * `ToolDefinition.timeoutMs`, timeout policy enforces it, and this tool forwards the resulting
 * signal. A provider timeout remains a backstop for direct service callers.
 */

import type { Context } from '@deepseek-ai/cordis'
import TurndownService from 'turndown'
import { gfm } from '@joplin/turndown-plugin-gfm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolResult, WebFetchResultView } from '@deepseek-ai/dsh-tools'
import type { WebFetchBody, WebFetchResult } from '@deepseek-ai/dsh-web'
import { assertNever } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * The shared HTML→markdown converter: turndown over its bundled domino DOM,
 * with GitHub-flavored tables/strikethrough (`@joplin/turndown-plugin-gfm`).
 * The style options are fixed model-facing presentation (matching the repo's
 * markdown conventions), not deployment tunables. `remove` drops non-content
 * elements wholesale — turndown's default keeps their text. The instance is
 * stateless across `turndown()` calls and safe to share.
 */
// 共享的 HTML→Markdown 转换器：turndown 加其内置 domino DOM，并启用 GitHub 风格
// 表格/删除线插件。样式选项是固定的面向模型呈现（对齐仓库 Markdown 约定），不是部署可调项。
// remove 把非内容元素整体丢掉（turndown 默认会保留它们的文字）。该实例在多次调用间无状态，
// 可安全共享。
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})
turndown.use(gfm)
turndown.remove(['script', 'style', 'noscript'])

/** Render one GFM table cell without interpreting HTML span counts. */
// 渲染一个 GFM 表格单元格，不解析 HTML 的跨列（colspan）计数。
function renderTableCell(content: string, index: number): string {
  const prefix = index === 0 ? '| ' : ' '
  const escaped = content.trim().replace(/\n\r/g, '<br>').replace(/\n/g, '<br>').replace(/\|+/g, '\\|').padEnd(3, ' ')
  return `${prefix}${escaped} |`
}

/** Whether a row is the table's Markdown heading row. */
// 该行是否为表格的 Markdown 表头行。
function isTableHeadingRow(row: HTMLTableRowElement): boolean {
  const cells = Array.from(row.cells)
  const section = row.parentElement as HTMLTableSectionElement
  const table = section.parentElement as HTMLTableElement
  return (section.nodeName === 'THEAD' || table.rows[0] === row)
    && cells.every(cell => cell.nodeName === 'TH')
}

/** Map an HTML table-cell alignment to the GFM separator marker. */
// 把 HTML 表格单元格对齐方式映射为 GFM 分隔符标记。
function tableBorder(cell: HTMLTableCellElement): string {
  const alignment = (cell.getAttribute('align') || cell.style.textAlign || '').toLowerCase()
  if (alignment === 'left') return ':---'
  if (alignment === 'right') return '---:'
  if (alignment === 'center') return ':---:'
  return '---'
}

// 自定义 turndown 规则：单元格渲染不解释跨列属性。
turndown.addRule('tableCellWithoutSpanExpansion', {
  filter: ['th', 'td'],
  replacement(content, node) {
    const cell = node as HTMLTableCellElement
    const row = cell.parentNode as HTMLTableRowElement
    // GFM cannot represent spanning cells. Ignoring colspan keeps conversion
    // work and output proportional to the source instead of the numeric attribute.
    // GFM 无法表达跨列单元格。忽略 colspan 可使转换工作量与输出规模正比于源码，
    // 而不是正比于数值属性（防止被巨型 colspan 放大）。
    return renderTableCell(content, Array.prototype.indexOf.call(row.childNodes, cell))
  },
})
// 自定义 turndown 规则：表格行渲染并自动生成表头分隔行。
turndown.addRule('tableRowWithoutSpanExpansion', {
  filter: 'tr',
  replacement(content, node) {
    const row = node as HTMLTableRowElement
    const border = isTableHeadingRow(row)
      ? Array.from(row.cells, (cell, index) => renderTableCell(tableBorder(cell), index)).join('')
      : ''
    return `\n${content}${border.length > 0 ? `\n${border}` : ''}`
  },
})

/**
 * Validate value constraints the schema DSL can't express: a non-blank `url`.
 * Throws a plain `Error` otherwise. No timeout parameter — the tool-call budget
 * is deployment policy declared via `fetchTimeoutMs` config and enforced by
 * `@deepseek-ai/dsh-tool-call-timeout-policy`, not a model argument.
 *
 * @param args - the schema-validated `web_fetch` arguments.
 * @returns the arguments as the seam's request fields.
 */
// 校验 schema DSL 表达不了的值约束：url 必须非空。违反时抛普通 Error。
// 没有超时参数——工具调用预算由 fetchTimeoutMs 配置声明、超时策略插件强制，不是模型参数。
export function parseFetchArgs(args: { url: string }): { url: string } {
  if (args.url.trim().length === 0) throw new Error('url must be a non-empty string')
  return { url: args.url }
}

/**
 * Nesting-depth ceiling above which HTML skips conversion and passes through
 * raw. Conversion runs synchronously on the event loop, and unclosed-tag
 * nesting makes domino's tree (and turndown's walk over it) superlinear —
 * measured: depth 512 ≈ 0.15s, 2,000 ≈ 2s, 20,000 ≈ 5s — during which the
 * cooperative `fetchTimeoutMs` timer cannot fire. Real pages nest a few dozen
 * levels; 512 is far above content and far below weaponizable. A robustness
 * invariant, not a tunable.
 */
// 嵌套深度上限：超过此值的 HTML 跳过转换、原样透传。转换在事件循环上同步执行，
// 未闭合标签的嵌套会让 domino 的树（及 turndown 对其的遍历）超线性变慢——
// 实测：深度 512 约 0.15 秒、2000 约 2 秒、20000 约 5 秒——期间协作式 fetchTimeoutMs
// 定时器无法触发。真实页面只嵌套几十层；512 远高于内容需求、远低于可武器化阈值。
// 这是健壮性不变量，不是可调项。
const MAX_CONVERSION_DEPTH = 512

/** Elements that never take a closing tag, so they do not grow the lexical stack. */
// 永远不带结束标签的元素：不会推高词法栈。
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** Elements whose contents HTML parses as text until their matching end tag. */
// 内容按纯文本解析、直到匹配结束标签才结束的元素。
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'noscript'])

/** Whether a character can occur after a raw-text end-tag name. */
// 该字符是否能出现在"原始文本结束标签名"之后（作为合法的标签边界符）。
function isTagBoundary(char: string | undefined): boolean {
  return char === undefined || char === '>' || char === '/' || /\s/.test(char)
}

/** Find the matching raw-text end tag without interpreting markup-like body text. */
// 查找匹配的原始文本结束标签，不解释看似标记的正文文本。
function findRawTextEnd(lowerHtml: string, name: string, from: number): number {
  const prefix = `</${name}`
  let candidate = lowerHtml.indexOf(prefix, from)
  while (candidate !== -1 && !isTagBoundary(lowerHtml[candidate + prefix.length])) {
    candidate = lowerHtml.indexOf(prefix, candidate + prefix.length)
  }
  return candidate
}

/**
 * Conservatively reject HTML whose lexical element stack crosses the conversion
 * depth ceiling. The single pass ignores closing tags inside comments, skips
 * raw-text bodies, respects quoted `>` characters, and only accepts a closing
 * tag for the current element; malformed input therefore over-counts rather
 * than hiding nesting.
 *
 * @param html - the decoded HTML body.
 * @returns whether the body crosses {@link MAX_CONVERSION_DEPTH}.
 */
// 保守地拒绝"词法元素栈越过转换深度上限"的 HTML。单趟扫描：忽略注释内的结束标签、
// 跳过原始文本正文、尊重引号内的 > 字符、只接受与当前元素匹配的结束标签——
// 因此畸形输入会"多算"嵌套而不会"藏匿"嵌套。
function exceedsConversionDepth(html: string): boolean {
  const lowerHtml = html.toLowerCase()
  const openElements: string[] = []
  let offset = 0
  let inComment = false

  while (offset < html.length) {
    const start = html.indexOf('<', offset)
    if (inComment) {
      const end = html.indexOf('-->', offset)
      if (end !== -1 && (start === -1 || end < start)) {
        inComment = false
        offset = end + 3
        continue
      }
    }
    if (start === -1) break
    if (!inComment && html.startsWith('<!--', start)) {
      inComment = true
      offset = start + 4
      continue
    }

    let cursor = start + 1
    const closing = html[cursor] === '/'
    if (closing) cursor += 1
    const nameStart = cursor
    while (/[a-zA-Z0-9-]/.test(html[cursor] ?? '')) cursor += 1
    if (cursor === nameStart || !/[a-zA-Z]/.test(html.charAt(nameStart))) {
      offset = start + 1
      continue
    }

    const name = lowerHtml.slice(nameStart, cursor)
    let quote: '"' | "'" | undefined
    while (cursor < html.length) {
      const char = html[cursor]
      cursor += 1
      if (quote !== undefined) {
        if (char === quote) quote = undefined
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === '>') {
        break
      }
    }
    if (html[cursor - 1] !== '>') break

    if (closing) {
      if (!inComment && openElements.at(-1) === name) openElements.pop()
    } else {
      let last = cursor - 2
      while (/\s/.test(html.charAt(last))) last -= 1
      if (!VOID_ELEMENTS.has(name) && html[last] !== '/') {
        openElements.push(name)
        if (openElements.length > MAX_CONVERSION_DEPTH) return true
        if (!inComment && RAW_TEXT_ELEMENTS.has(name)) {
          const end = findRawTextEnd(lowerHtml, name, cursor)
          if (end === -1) break
          offset = end
          continue
        }
      }
    }
    offset = cursor
  }
  return false
}

// 渲染正文的内部返回形状。
interface RenderedBody {
  /** Converted text, or raw HTML when conversion is unsafe or fails. */
  // 转换后的文本；转换不安全或失败时为原始 HTML。
  text: string
  /** Whether the source was cut before conversion to bound synchronous work. */
  // 转换前是否截断过源（用于限制同步工作量）。
  sourceTruncated: boolean
}

/**
 * Render a fetched body to model-facing markdown text.
 *
 * @param body - the decoded body; `html` is converted via turndown, `text`
 *   passes through verbatim.
 * @param maxInputChars - maximum source characters processed synchronously.
 * @returns the rendered prefix and whether the source was cut. HTML nested
 *   beyond {@link MAX_CONVERSION_DEPTH} or rejected by turndown passes through
 *   raw; a degraded page beats an error for a body the provider decoded.
 */
// 把抓取到的正文渲染为面向模型的 Markdown 文本。html 经 turndown 转换，text 原样透传。
// 嵌套超限或 turndown 拒绝的 HTML 原样透传——对提供者已解码的正文，降级的页面
// 好过一个错误。
function renderBody(body: WebFetchBody, maxInputChars: number): RenderedBody {
  const content = body.content.slice(0, maxInputChars)
  const sourceTruncated = content.length !== body.content.length
  switch (body.kind) {
    case 'html':
      if (exceedsConversionDepth(content)) return { text: content, sourceTruncated }
      try {
        return { text: turndown.turndown(content), sourceTruncated }
      } catch {
        // turndown's DOM walk recurses per element; malformed markup the lexical
        // guard cannot model can still throw RangeError. Provider errors stay
        // structured WebErrors upstream; conversion failure downgrades to raw HTML.
        // turndown 的 DOM 遍历按元素递归；词法护栏无法建模的畸形标记仍可能抛 RangeError。
        // 上游的提供者错误保持结构化 WebErrors；转换失败则降级为原始 HTML。
        return { text: content, sourceTruncated }
      }
    case 'text':
      return { text: content, sourceTruncated }
    // WebFetchBody 是封闭联合，此分支不可达；保留它只为让"新增 kind"变成编译错误。
    /* v8 ignore next 2 -- WebFetchBody is a closed union; this arm is unreachable and only makes adding a kind a compile error. */
    default:
      return assertNever(body, 'unhandled web fetch body kind')
  }
}

/** The truncation notice appended when the provider or the output cap cut content. */
// 当提供者或输出上限截断内容时追加的截断提示语。
const TRUNCATION_FOOTER = '\n\n(Content truncated. Fetch a more specific URL or section for the full text.)'

/** A rendered fetch output: the model-facing text and its effective truncation. */
// 一次渲染完成的抓取输出：面向模型的文本与其"有效截断"状态。
interface RenderedFetch {
  /** The complete bounded output — header, rendered body, and truncation footer. */
  // 完整有界的输出——标题头、渲染正文、截断提示（若有）。
  text: string
  /**
   * True when the provider capped the body, a pre-conversion source cut applied,
   * or the complete output exceeded `maxOutputChars`. This is the effective
   * truncation the returned text reflects (its footer), wider than the
   * provider-only `WebFetchResult.truncated`.
   */
  // 提供者截断过正文、转换前做过源截断、或完整输出超 maxOutputChars 之一成立即为 true。
  // 这是返回文本实际反映的"有效截断"（对应其页脚），比仅含提供者截断的
  // WebFetchResult.truncated 语义更宽。
  truncated: boolean
}

/**
 * Render a fetch result to its bounded model-facing text and effective
 * truncation. The single source of both the `render` text and the fetch card's
 * `truncated`, so the card never disagrees with the text the model saw. The cap
 * limits the source prefix processed synchronously, then applies again where the
 * complete output — header, rendered body, and footer — is known.
 *
 * Package-internal: the only callers are {@link formatFetchOutput} and
 * {@link fetchMetaFromValue}, both reached through the tool registry, which
 * deep-freezes the result value before calling `output.render` and
 * `output.presentationMeta`. The conversion is memoized per
 * `(result, maxOutputChars)` so the synchronous DOM parse and turndown walk run
 * once, not twice, on that same frozen value. Keeping it unexported means no
 * caller can mutate a cached input or the returned {@link RenderedFetch}, so the
 * memo needs no defensive copy.
 *
 * @param result - the seam's fetch outcome.
 * @param maxOutputChars - cap on the complete returned string; a cut body gets
 *   the same fetch-something-narrower notice as provider-side truncation.
 * @returns the complete `Fetched <url> (HTTP <status>)`-headed text and whether
 *   the provider, a source cut, or the cap trimmed the content.
 */
// 把抓取结果渲染为有界的面向模型文本与有效截断标记。它是 render 文本与抓取卡片 truncated
// 的单一来源，保证卡片与模型看到的文本永不一致。上限先限制同步处理的源前缀，
// 再在完整输出（标题头 + 渲染正文 + 页脚）已知后二次施加。
// 包内私有：唯一调用方是 formatFetchOutput 与 fetchMetaFromValue，二者都经工具注册表到达，
// 而注册表在调用 output.render / output.presentationMeta 前会深度冻结结果值。转换按
// (result, maxOutputChars) 记忆化，使同步 DOM 解析与 turndown 遍历在同一个冻结值上只跑一次。
// 保持不导出意味着没有调用方能改动缓存的输入或返回的 RenderedFetch，记忆化无需防御性拷贝。
function renderFetchOutput(result: WebFetchResult, maxOutputChars: number): RenderedFetch {
  const byCap = renderCache.get(result) ?? new Map<number, RenderedFetch>()
  const cached = byCap.get(maxOutputChars)
  if (cached !== undefined) return cached
  const computed = computeFetchOutput(result, maxOutputChars)
  byCap.set(maxOutputChars, computed)
  renderCache.set(result, byCap)
  return computed
}

/**
 * Per-result memo for {@link renderFetchOutput}, keyed first on the frozen
 * result value so a garbage-collected result drops its entry, then on the output
 * cap (a deployment constant per registration). Collapses the registry's twin
 * `render`/`presentationMeta` calls into one HTML→markdown conversion.
 */
// renderFetchOutput 的按结果记忆化缓存：外层键是被冻结的结果值（结果被回收即自动清项），
// 内层键是输出上限（每次注册为部署常量）。它把注册表的 render 与 presentationMeta 两次
// 调用折叠为一次 HTML→Markdown 转换。
const renderCache = new WeakMap<WebFetchResult, Map<number, RenderedFetch>>()

/**
 * The uncached conversion behind {@link renderFetchOutput}. Separated so the
 * memo wraps exactly one call site and the conversion logic stays pure.
 *
 * @param result - the seam's fetch outcome.
 * @param maxOutputChars - cap on the complete returned string.
 * @returns the bounded text and effective truncation.
 */
// renderFetchOutput 背后的未缓存转换。单独拆出是为了让记忆化只包裹一个调用点、
// 且转换逻辑保持纯函数。
function computeFetchOutput(result: WebFetchResult, maxOutputChars: number): RenderedFetch {
  const header = `Fetched ${result.url} (HTTP ${result.statusCode})\n\n`
  const rendered = renderBody(result.body, maxOutputChars)
  const prefix = `${header}${rendered.text}`
  const truncated = result.truncated || rendered.sourceTruncated || prefix.length > maxOutputChars
  const full = `${prefix}${truncated ? TRUNCATION_FOOTER : ''}`
  if (full.length <= maxOutputChars) return { text: full, truncated }
  if (maxOutputChars < TRUNCATION_FOOTER.length) return { text: full.slice(0, maxOutputChars), truncated }
  return { text: `${prefix.slice(0, maxOutputChars - TRUNCATION_FOOTER.length)}${TRUNCATION_FOOTER}`, truncated }
}

/**
 * Format a fetch result as one model-facing text block, bounded as a whole.
 *
 * @param result - the seam's fetch outcome.
 * @param maxOutputChars - cap on the complete returned string.
 * @returns the complete text from {@link renderFetchOutput}.
 */
// 把抓取结果格式化为一段整体有界的面向模型文本。
export function formatFetchOutput(result: WebFetchResult, maxOutputChars: number): string {
  return renderFetchOutput(result, maxOutputChars).text
}

/**
 * Pending-call presentation: a fetch card titled by the URL.
 *
 * @param args - the raw tool arguments; only `url` feeds the view.
 * @returns the generic card view (`kind: 'fetch'`) shown while the call runs.
 */
// 调用进行中的展示：以 URL 为标题的抓取卡片。
export function presentFetchCall(args: { url: string }): GenericCallView {
  return { card: 'generic', title: args.url, kind: 'fetch', rawInput: args.url }
}

/**
 * The `web_fetch` tool's private `tool/result` `meta` payload: the fetch summary
 * a UI cannot recover from the model-facing render text without reparsing its
 * header line. Attached opaquely (as `JsonValue`) on the tool result and
 * persisted with the session log, so `presentResult` reproduces the fetch card
 * on replay. The body itself is already markdown in the result content, so it is
 * not duplicated here. `truncated` is the effective truncation the render text
 * reflects, which a client cannot recompute (it does not know the deployment's
 * `fetchMaxOutputChars`); this is why fetch meta is carried, not derived from the
 * header line (see the web-result-card Agent Note).
 */
// web_fetch 工具私有的 tool/result meta 负载：UI 无法从面向模型的渲染文本中（不重解析
// 标题行）恢复的抓取摘要。以不透明 JSON 形式挂在工具结果上并随会话日志持久化，
// 使 presentResult 在回放时能还原抓取卡片。正文本身已是结果内容里的 Markdown，故此处
// 不重复携带。truncated 是渲染文本实际反映的有效截断，客户端无法自行重算（它不知道部署
// 的 fetchMaxOutputChars），这就是抓取 meta 必须显式携带而非从标题行推导的原因
// （见 web-result-card Agent Note）。
export interface WebFetchMeta {
  /** The final URL after allowed redirects. */
  // 允许重定向后的最终 URL。
  url: string
  /** HTTP status code of the fetched response. */
  // 抓取响应的 HTTP 状态码。
  statusCode: number
  /** True when the provider, a source cut, or the output cap trimmed the content. */
  // 提供者、源截断或输出上限三者任一裁剪了内容时为 true。
  truncated: boolean
}

/**
 * Project a validated `web_fetch` output value into its replayable presentation
 * meta ({@link WebFetchMeta} as opaque JSON). `truncated` is the effective
 * truncation the model-facing text reflects (via {@link renderFetchOutput}), not
 * the provider-only `WebFetchResult.truncated`, so the fetch card never disagrees
 * with the returned text.
 *
 * @param value - the canonical `web_fetch` output value (the seam's result shape).
 * @param maxOutputChars - the deployment's output cap, the same one
 *   {@link formatFetchOutput} applies to the render text.
 * @returns the URL, status code, and effective truncation flag.
 */
// 把校验过的 web_fetch 输出值投影为可回放的展示 meta（即不透明 JSON 化的 WebFetchMeta）。
// truncated 取的是面向模型文本实际反映的有效截断（经 renderFetchOutput），而非仅提供者
// 截断的 WebFetchResult.truncated，保证抓取卡片与返回文本永不一致。
export function fetchMetaFromValue(value: WebFetchResult, maxOutputChars: number): JsonValue {
  return { url: value.url, statusCode: value.statusCode, truncated: renderFetchOutput(value, maxOutputChars).truncated }
}

/**
 * Narrow opaque live or replayed result metadata to a {@link WebFetchMeta}.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic card instead of throwing during replay.
 *
 * @param meta - result metadata.
 * @returns the validated fetch meta, or `undefined` for absent or malformed data.
 */
// 把不透明的实时或回放结果元数据收窄为 WebFetchMeta。畸形元数据返回 undefined，
// 让展示层回退到通用卡片，而不是在回放中抛错。
export function fetchMetaFromResult(meta: unknown): WebFetchMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { url, statusCode, truncated } = meta as Record<string, unknown>
  if (typeof url !== 'string' || typeof statusCode !== 'number' || typeof truncated !== 'boolean') return undefined
  return { url, statusCode, truncated }
}

/**
 * Completed-call presentation: a `web` fetch card carrying the retrieval summary
 * from `meta`. It sets no `content` copy — a UI without the `web` capability
 * falls back to the raw `tool/result` content, the already-markdown body (see the
 * web-result-card Agent Note).
 *
 * @param args - the raw tool arguments; `url` becomes the result-state title so a
 *   window-truncated replay that dropped the call head still has one.
 * @param result - the final model-facing tool result; `meta` carries the summary.
 * @returns the fetch result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
// 调用完成后的展示：从 meta 取检索摘要的 web 抓取卡片。不额外复制 content——没有 web
// 能力的 UI 会回退到原始 tool/result 内容，即已是 Markdown 的正文（见 web-result-card
// Agent Note）。
export function presentFetchResult(args: { url: string }, result: ToolResult): WebFetchResultView | undefined {
  if (result.isError) return undefined
  const meta = fetchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'web',
    kind: 'fetch',
    title: args.url,
    url: meta.url,
    statusCode: meta.statusCode,
    truncated: meta.truncated,
  }
}

/**
 * Register the `web_fetch` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param maxOutputChars - cap on the complete rendered tool output (see
 *   {@link formatFetchOutput}) and on source characters converted synchronously.
 */
// 注册 web_fetch 工具及其系统提示词指引。timeoutMs 以 ToolDefinition.timeoutMs 形式交给
// 超时策略插件；maxOutputChars 同时约束同步转换的源字符数与完整渲染输出。
export function applyWebFetchTool(ctx: Context, timeoutMs: number, maxOutputChars: number): void {
  ctx.systemPrompt.section({
    name: 'tool:web_fetch',
    order: 111,
    text: 'Use the web_fetch tool to retrieve the content of a specific HTTP(S) URL (for example a result from web_search). It returns the page content decoded to text. Cite the URL as a markdown link when you use its content.',
  })

  ctx.tools.register(defineTool({
    name: 'web_fetch',
    description: 'Fetch the content of a specific HTTP(S) URL and return it decoded to text.',
    parameters: {
      url: { type: 'string', required: true, description: 'The HTTP(S) URL to fetch.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          statusCode: { type: 'integer', required: true },
          body: {
            required: true,
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'html' },
                  content: { type: 'string', required: true },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: { type: 'string', required: true, const: 'text' },
                  content: { type: 'string', required: true },
                },
              },
            ],
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatFetchOutput(value, maxOutputChars) }],
      presentationMeta: (_args, value) => fetchMetaFromValue(value, maxOutputChars),
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    // 提供方只读，不会改动父代理的状态，因此可并发执行。
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const input = parseFetchArgs(args)
      const result = await ctx.web.fetch(
        { url: input.url },
        exec.signal,
      )
      return {
        url: result.url,
        statusCode: result.statusCode,
        body: { kind: result.body.kind, content: result.body.content },
        truncated: result.truncated,
      }
    },
    presentCall: presentFetchCall,
    presentResult: (args, result) => presentFetchResult(args, result),
  }))
}
