/*
 * ================================ 文件注释 ================================
 * 【文件职责】客户端唯一的语法高亮模块：基于 shiki 的同步细粒度核心（JavaScript 正则引擎，
 *             无 oniguruma WASM），维护一个全局单例高亮器；提供 highlightToHtml（整块 HTML）
 *             与 highlightLines（按行 token）两个入口，并管理"引导语法 + 懒加载语法"
 *             两级语法注册与订阅通知。
 * 【技术维度】shiki/core 的 createHighlighterCoreSync；createCssVariablesTheme 把颜色映射
 *             到 --shiki-* CSS 变量；createJavaScriptRegexEngine 支持急切编译；动态 import
 *             懒加载扩展语法；useSyncExternalStore 风格订阅（subscribeGrammarLoaded /
 *             grammarLoadCount）；模块加载时用 setTimeout(0) 延迟预热避免长任务卡渲染。
 * 【产品维度】代码块（TypeScript / shell / JSON 是每次会话都会渲染的三种）开机即亮；
 *             阅读卡片里更广的语言（python、rust、yaml 等）按需加载，首次渲染先用纯文本
 *             兜底，语法就绪后自动重新高亮，用户几乎无感。
 * 【逻辑维度】1) 引导语法 LANGS 与懒加载表 LAZY_GRAMMARS；2) 别名表 LANG_ALIASES 统一
 *             fence 信息串与文件扩展名 hint；3) 单例 highlighter() 的创建与预热；
 *             4) 懒加载请求去重 + 订阅通知；5) 两个对外入口函数。
 * 【关键边界】颜色一律走 --shiki-* 主题变量（仓库"只用 token"的样式规则）；未知语言静默
 *             降级为纯文本，绝不抛错；别名用 Map 而非对象，防止 constructor / __proto__
 *             等标签触发原型链查找崩溃；懒语法首帧回退纯文本，加载完成后由订阅者重渲染。
 * 【新手阅读建议】先读 highlightToHtml / highlightLines 两个入口，再理解"两级语法"与
 *             ensureGrammar 的就绪判断，最后看预热定时器的动机。
 * ==========================================================================
 */
/**
 * The client's ONE syntax highlighter: a synchronous fine-grained shiki core
 * (JavaScript regex engine — no oniguruma WASM, bundle-friendly) with an
 * explicit grammar allowlist and a CSS-variables theme. Colors live in the
 * theme package's token sheets as `--shiki-*` custom properties (light and
 * dark blocks), never here — the repo's tokens-only styling rule.
 *
 * Only the three markdown-fence and `run_code` grammars (TypeScript, shell,
 * JSON) load into the singleton at boot — the set every session renders. The
 * read card's wider extension set (the file-extension language hints the read
 * tool's `langFromPath` emits — `packages/fs/tool-fs`: python, rust, yaml,
 * markup, …) is imported lazily and registered the first time such a language
 * is requested, so a session that never opens a read card in one of those
 * language pays neither the ~1.6 MB of grammar modules nor their synchronous
 * init. The first render of a lazy language falls back to plain text while its
 * grammar loads, then {@link onGrammarLoaded} notifies subscribers to re-render
 * with highlighting. An unknown or absent language falls back to plain text (no
 * highlighting, still monospace) — never an error.
 */
/*
 * 本文件是客户端唯一的语法高亮器：一个同步的 shiki 核心（JS 正则引擎，无 oniguruma WASM），
 * 带显式语法白名单与 CSS 变量主题。颜色全部来自主题包的 --shiki-* token 表，不在此处硬编码。
 */

import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import type { GrammarState, HighlighterCore, ThemedToken } from 'shiki/core'
import type { CSSProperties } from 'react'

/** A shiki grammar module's default export (a `LanguageRegistration[]`), taken
 *  from a boot grammar so no direct `@shikijs/types` dependency is needed. */
/*
 * 懒加载语法模块的类型：默认导出是一个 LanguageRegistration 数组。
 * 借用一个引导语法来取类型，避免引入对 @shikijs/types 的直接依赖。
 */
type LangModule = { default: typeof langTs }

/**
 * Grammars the singleton loads at boot; each entry's own `name` is the id
 * `codeToTokens`/`codeToHtml` resolve. The JS-family aliases (js/jsx/ts/tsx)
 * resolve to the TypeScript grammar rather than a separate one: it tokenizes
 * plain TS/JS exactly, and JSX/TSX approximately (shiki's TS grammar is not the
 * dedicated TSX grammar, so JSX elements tokenize imperfectly) — an accepted
 * trade to keep the boot set to one JS-family grammar. The read card's wider
 * set loads lazily through {@link LAZY_GRAMMARS}.
 */
/*
 * 开机即加载进单例的语法（会话必然渲染的三种）。JS 家族别名（js/jsx/ts/tsx）都映射到
 * TypeScript 语法：它对纯 TS/JS 精确分词、对 JSX/TSX 近似分词——这是为了引导集只保留
 * 一个 JS 家族语法而接受的取舍。
 */
const LANGS = [langTs, langBash, langJson]

/**
 * The read card's extension grammars, each behind a dynamic import so its
 * module stays out of the boot chunk until a read of that language renders.
 * Keyed by the grammar id (`LanguageRegistration.name`) the aliases resolve to.
 * `@shikijs/langs`' default export is a `LanguageRegistration[]`; the loader
 * hands the whole array to `loadLanguageSync`, which registers each entry
 * (including embedded sub-grammars). The three boot grammars are absent —
 * already loaded, so no alias value ever points at a missing entry here.
 */
/*
 * 阅读卡片的扩展语法表：每个语法都在动态 import 后面，未用到时不进入开机 chunk。
 * 键是语法 id（LanguageRegistration.name）；值是返回语法模块 Promise 的工厂。
 */
const LAZY_GRAMMARS = new Map<string, () => Promise<LangModule>>([
  ['python', () => import('@shikijs/langs/python')],
  ['ruby', () => import('@shikijs/langs/ruby')],
  ['go', () => import('@shikijs/langs/go')],
  ['rust', () => import('@shikijs/langs/rust')],
  ['java', () => import('@shikijs/langs/java')],
  ['c', () => import('@shikijs/langs/c')],
  ['cpp', () => import('@shikijs/langs/cpp')],
  ['csharp', () => import('@shikijs/langs/csharp')],
  ['kotlin', () => import('@shikijs/langs/kotlin')],
  ['swift', () => import('@shikijs/langs/swift')],
  ['php', () => import('@shikijs/langs/php')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['toml', () => import('@shikijs/langs/toml')],
  ['ini', () => import('@shikijs/langs/ini')],
  ['markdown', () => import('@shikijs/langs/markdown')],
  ['mdx', () => import('@shikijs/langs/mdx')],
  ['html', () => import('@shikijs/langs/html')],
  ['css', () => import('@shikijs/langs/css')],
  ['scss', () => import('@shikijs/langs/scss')],
  ['less', () => import('@shikijs/langs/less')],
  ['sql', () => import('@shikijs/langs/sql')],
  ['xml', () => import('@shikijs/langs/xml')],
  ['lua', () => import('@shikijs/langs/lua')],
])

/**
 * Language ids (and aliases) the highlighter accepts; everything else renders
 * plain. A Map, not an object: fence info strings are assistant-authored, so
 * a label like `constructor` or `__proto__` must miss instead of resolving an
 * inherited property and crashing the renderer inside shiki. Keys cover both
 * the markdown-fence aliases `CodeBlock` uses and the file-extension hint ids
 * the read tool's `langFromPath` emits, so both callers resolve the same
 * grammars. The JS family maps to the TypeScript grammar (see {@link LANGS} for
 * the JSX/TSX approximation). A value not in {@link LANGS} names a
 * {@link LAZY_GRAMMARS} entry loaded on first use.
 */
/*
 * 高亮器接受的语法 id 与别名表。用 Map 而非对象：fence 信息串由模型生成，
 * 形如 constructor / __proto__ 的标签必须"未命中"而不是触发原型链继承属性导致渲染器崩溃。
 * 键同时覆盖 CodeBlock 的 fence 别名与 read 工具 langFromPath 的扩展名 hint；
 * 不在 LANGS 里的值指向 LAZY_GRAMMARS 的懒加载条目（首次使用时加载）。
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
])

/** All token colors resolve through `--shiki-*` custom properties (theme package sheets). */
// 所有 token 颜色都通过 --shiki-* CSS 自定义属性解析（定义在主题包的样式表里）。
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * The client regex engine compiles each TextMate pattern when its scanner is
 * created. Shiki otherwise defers patterns longer than 3,000 characters until
 * their first match; that compilation counts against Shiki's 500 ms per-line
 * budget and can return a partial token stream under host contention. Eager
 * compilation leaves the same budget in place for scanning user content.
 */
/*
 * JS 正则引擎：把 TextMate 模式改为"创建扫描器时就编译"。shiki 默认把超过 3000 字符的
 * 模式延迟到首次匹配时才编译，那次编译会占用 shiki 每行 500ms 的预算，宿主繁忙时可能
 * 返回不完整的 token 流；急切编译把同一预算留给扫描用户内容。
 */
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})

// 模块级单例缓存；首次调用 highlighter() 时创建。
let singleton: HighlighterCore | undefined

/** Representative paths through every boot grammar, compiled before user content is timed. */
// 每个引导语法的代表性样本：在"用户内容计时"之前完成编译（预热）。
const BOOT_GRAMMAR_WARMUPS = [
  { lang: 'typescript', code: 'const answer: number = 42' },
  { lang: 'shellscript', code: 'printf \'%s\\n\' "$HOME"' },
  { lang: 'json', code: '{"ready":true}' },
] as const

/** Construct and pre-tokenize the boot grammars outside the user-content scan budget. */
/*
 * 创建并预热高亮器：构造核心后，用 BOOT_GRAMMAR_WARMUPS 样本预先分词一次，
 * 让语法编译成本落在用户内容扫描预算之外。
 */
function createHighlighter(): HighlighterCore {
  const instance = createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
  for (const sample of BOOT_GRAMMAR_WARMUPS) {
    instance.codeToTokens(sample.code, {
      lang: sample.lang,
      theme: 'css-variables',
      tokenizeTimeLimit: 0,
    })
  }
  return instance
}

/** The synchronous highlighter (one instance per document); pre-warmed below, lazy as the fallback. */
// 同步高亮器单例访问器：首次调用时创建（含预热），之后复用。
function highlighter(): HighlighterCore {
  singleton ??= createHighlighter()
  return singleton
}

/** Grammar ids whose lazy import is in flight or done, so it is requested once. */
// 已发起（或已完成）懒加载的语法 id 集合，保证每个语法只请求一次。
const requested = new Set<string>()
/** Subscribers re-rendered after a lazy grammar registers (React callers). */
// 订阅者集合：懒语法注册完成后逐个回调，触发 React 侧重新渲染。
const listeners = new Set<() => void>()
/** Bumped on each lazy-grammar load; the `useSyncExternalStore` snapshot. */
// 每次懒语法加载完成自增；作为 useSyncExternalStore 的快照（只关心值是否变化）。
let loadCount = 0

/**
 * Subscribe to lazy-grammar load completions; `listener` fires after a
 * {@link LAZY_GRAMMARS} grammar finishes registering on the singleton, so a
 * caller that rendered its plain fallback while the grammar loaded can
 * re-highlight. Uses the `useSyncExternalStore` subscribe signature; pair it with
 * {@link grammarLoadCount} as the snapshot. Returns an unsubscribe function.
 * @param listener - invoked (no args) on each grammar-load completion.
 * @returns a disposer that removes the listener.
 */
/*
 * 订阅"懒语法加载完成"事件：每次加载完成都会回调所有订阅者，让此前渲染了纯文本
 * 兜底的调用方重新高亮。签名兼容 useSyncExternalStore 的 subscribe。
 * @param listener - 每次语法加载完成时被调用（无参数）。
 * @returns 移除该监听器的释放函数。
 */
export function subscribeGrammarLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The lazy-grammar load counter — a value that changes on every load, so a
 * `useSyncExternalStore` snapshot re-renders the subscriber when a grammar
 * registers. Opaque: only its identity across renders matters.
 * @returns the current load count.
 */
/*
 * 懒语法加载计数：每次加载后数值变化，供 useSyncExternalStore 作为快照触发重渲染。
 * 数值本身不透明，只有"跨渲染是否变化"有意义。
 * @returns 当前加载次数。
 */
export function grammarLoadCount(): number {
  return loadCount
}

/**
 * Ensure the grammar `resolved` names is registered. A boot grammar (not in
 * {@link LAZY_GRAMMARS}) and an already-loaded lazy grammar report ready
 * synchronously; a lazy grammar not yet loaded starts its import (once) and
 * reports not-ready, so the caller renders plain until a
 * {@link subscribeGrammarLoaded} listener fires.
 * @param resolved - the grammar id an alias resolved to.
 * @returns whether the grammar is registered and ready to tokenize now.
 */
/*
 * 确保 resolved 指定的语法已注册。引导语法与已加载的懒语法同步返回"就绪"；
 * 未加载的懒语法触发一次 import 并返回"未就绪"，调用方先渲染纯文本，等订阅回调再重渲染。
 * @param resolved - 别名解析后的语法 id。
 * @returns 语法当前是否已注册、可以立即分词。
 */
function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved)
  // A boot grammar (already registered) has no lazy loader; it is always ready.
  // 引导语法（已注册）没有懒加载器，永远就绪。
  if (load === undefined) return true
  if (highlighter().getLoadedLanguages().includes(resolved)) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then((mod) => {
      highlighter().loadLanguageSync(mod.default)
      loadCount += 1
      for (const listener of listeners) listener()
    })
  }
  return false
}

// Engine + grammar construction costs a long task (~120-175ms); building it
// during the first finalized fence's render would jank exactly when a stream
// completes. Warm the singleton in a deferred task at module load (= plugin
// boot) instead; the lazy path above stays as the correctness fallback for a
// fence that renders before the timer fires. `unref` (Node-only) keeps a
// non-browser import from pinning the event loop.
// 引擎 + 语法构造是一次长任务（约 120-175ms）：若放在第一个定稿代码块的渲染时执行，
// 会在流式回复恰好完成那一刻卡顿。改为模块加载（插件启动）时用 setTimeout(0) 延迟预热；
// 上面的懒加载路径仍是"定时器未触发就渲染了 fence"时的正确性兜底。unref 让非浏览器
// 导入不钉住事件循环。
const warmupTimer = setTimeout(() => { highlighter() }, 0)
;(warmupTimer as { unref?: () => void }).unref?.()

/**
 * Highlight `code` into shiki's HTML (a single `<pre class="shiki">` tree)
 * when `lang` maps to a registered grammar; `undefined` means the caller
 * renders its plain fallback. A lazy grammar not yet loaded returns `undefined`
 * for this call and loads in the background; subscribe with
 * {@link onGrammarLoaded} to re-highlight once it registers.
 * @param code - the source text.
 * @param lang - the language hint (a markdown fence info string or a fixed caller id).
 * @returns the highlighted HTML, or `undefined` for unknown or not-yet-loaded languages.
 */
/*
 * 把 code 高亮为 shiki 的 HTML（单个 <pre class="shiki"> 树）。
 * 使用示例：dangerouslySetInnerHTML={{ __html: highlightToHtml(code, 'ts') ?? fallback }}。
 * @param code - 源码文本。
 * @param lang - 语言提示（markdown fence 信息串或固定的调用方 id）。
 * @returns 高亮后的 HTML；语言未知或尚未加载时返回 undefined。
 */
export function highlightToHtml(code: string, lang: string | undefined): string | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  return highlighter().codeToHtml(code, { lang: resolved, theme: 'css-variables' })
}

/**
 * One highlighted run of a line: the text and the inline style shiki assigned
 * it. The css-variables theme colors every run through a `--shiki-*` custom
 * property, so `style.color` is always present; it is held as a style object
 * rather than a bare color so a run spreads onto a `<span style>` uniformly.
 */
/*
 * 一行的单个高亮片段：文本 + shiki 分配的样式。css-variables 主题让每个片段都通过
 * --shiki-* 自定义属性着色，所以 style.color 恒存在；用样式对象而非裸颜色保存，
 * 是为了让片段能统一展开到 <span style> 上。
 */
export interface HighlightSpan {
  text: string
  style: CSSProperties
}

/** vscode-textmate FontStyle bits shiki folds into `text-decoration` values. */
const DECORATION_BITS: readonly (readonly [number, string])[] = [[4, 'underline'], [8, 'line-through']]

/**
 * The inline style shiki's HTML arm assigns one token (`getTokenStyleObject`
 * mirrored onto React style keys): the css-variables color plus the
 * vscode-textmate font-style bits the theme lets through — italic (1), bold
 * (2), and the {@link DECORATION_BITS} decorations (the theme injects bold,
 * italic, and underline rules for markup scopes, so markdown fences carry
 * them). The theme has no per-scope backgrounds, so `background-color` never
 * occurs; the arm-parity tests fail loud if a shiki upgrade changes that.
 */
function spanStyle(token: ThemedToken): CSSProperties {
  const style: CSSProperties = { color: token.color }
  /* v8 ignore next -- fontStyle is optional in ThemedToken's type; tokenizeWithTheme always stamps it. */
  const bits = token.fontStyle ?? 0
  if ((bits & 1) !== 0) style.fontStyle = 'italic'
  if ((bits & 2) !== 0) style.fontWeight = 'bold'
  const decorations = DECORATION_BITS.filter(([bit]) => (bits & bit) !== 0)
  if (decorations.length > 0) style.textDecoration = decorations.map(([, value]) => value).join(' ')
  return style
}

/**
 * Narrow one tokenized line to the runs a `<span style>` renders, folding a
 * whitespace-only run into the token that follows it — shiki's default
 * `mergeWhitespaces` HTML behavior — with each run styled through
 * {@link spanStyle}, so the streaming spans and the settled `codeToHtml`
 * swap render one identical span tree. shiki exempts underlined/struck
 * whitespace from the fold; under the css-variables theme that case cannot
 * occur — its only underline rule styles inline-link scopes, whose spaced
 * text tokenizes as one run, and it injects no strikethrough rule — so the
 * unconditional fold here stays equivalent (the markdown arm-parity test
 * pins it). A line-trailing whitespace-only run has no follower and keeps
 * its own span, as in shiki.
 */
function lineSpans(line: ThemedToken[]): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  let pendingWhitespace = ''
  for (const [index, token] of line.entries()) {
    if (/^\s+$/.test(token.content) && index + 1 < line.length) {
      pendingWhitespace += token.content
      continue
    }
    spans.push({ text: pendingWhitespace + token.content, style: spanStyle(token) })
    pendingWhitespace = ''
  }
  return spans
}

/**
 * Incremental highlighter for one growing streaming fence. TextMate
 * tokenization is line-based and forward-only — a line's tokens depend only on
 * its own text and the grammar state entering it — so appended text never
 * changes a completed line's tokens. The session caches the spans of every
 * completed line together with the grammar state after them; each
 * {@link update} tokenizes newly completed text from that state, plus the
 * still-growing last line. Per-call cost therefore excludes the completed
 * prefix, and the result equals a from-scratch tokenization of the same code.
 * Non-append input and a change of resolved grammar reset the cache and
 * re-tokenize fully, so any input stays correct.
 */
export class StreamingHighlightSession {
  /** Grammar id the cache was built with; a different resolution resets it. */
  private resolved: string | undefined
  /** Newline-terminated source prefix covered by {@link spans}. */
  private prefix = ''
  /** Cached spans, one entry per completed line of {@link prefix}. */
  private spans: HighlightSpan[][] = []
  /** Grammar state after {@link prefix}; undefined = the grammar's initial state. */
  private state: GrammarState | undefined
  private lastCode: string | undefined
  private lastLang: string | undefined
  private lastResult: HighlightSpan[][] | undefined

  private reset(resolved: string | undefined): void {
    this.resolved = resolved
    this.prefix = ''
    this.spans = []
    this.state = undefined
  }

  /** Tokenize `text` with `resolved`, resuming from the cached grammar state when one exists. */
  private tokenize(resolved: string, text: string): ThemedToken[][] {
    return highlighter().codeToTokensBase(text, {
      lang: resolved,
      theme: 'css-variables',
      ...(this.state === undefined ? {} : { grammarState: this.state }),
    })
  }

  /**
   * Tokenize the fence's current text into per-line highlighted runs;
   * `undefined` means the caller renders its plain fallback. Idempotent per
   * (`code`, `lang`) input — repeated calls return the identical result array —
   * and a retained line keeps its span-array identity across growing calls, so
   * a React caller can reuse cached line elements. A lazy grammar not yet
   * loaded returns `undefined` and loads in the background exactly as
   * {@link highlightToHtml} does; the next call after it registers highlights.
   * @param code - the fence text accumulated so far (display-trimmed, no synthetic trailing newline).
   * @param lang - the language hint (a markdown fence info string).
   * @returns one entry per line of `code` (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
   */
  update(code: string, lang: string | undefined): readonly HighlightSpan[][] | undefined {
    if (code === this.lastCode && lang === this.lastLang && this.lastResult !== undefined) {
      return this.lastResult
    }
    this.lastCode = code
    this.lastLang = lang
    const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
    if (resolved === undefined || !ensureGrammar(resolved)) {
      this.reset(undefined)
      this.lastResult = undefined
      return undefined
    }
    if (resolved !== this.resolved || !code.startsWith(this.prefix)) this.reset(resolved)
    const rest = code.slice(this.prefix.length)
    const lastNewline = rest.lastIndexOf('\n')
    // Everything before the last newline is newly completed lines: tokenize
    // them once from the cached state and retain their spans. What follows is
    // the still-growing line, re-tokenized per call but never retained.
    if (lastNewline >= 0) {
      // Tokenize what shiki's own line splitting would see: splitLines strips
      // the \r of a \r\n terminator (interior pairs are shiki's to split), so
      // a CRLF cut must not leak its \r into the last completed line — a bash
      // continuation's grammar state, for example, differs with it.
      const grownEnd = rest[lastNewline - 1] === '\r' ? lastNewline - 1 : lastNewline
      const tokens = this.tokenize(resolved, rest.slice(0, grownEnd))
      // Per-line push, not one spread call: a reconnect can deliver the whole
      // accumulated fence as one update, and spreading tens of thousands of
      // lines into arguments can exceed the engine's argument limit.
      for (const line of tokens) this.spans.push(lineSpans(line))
      this.state = highlighter().getLastGrammarState(tokens)
      this.prefix = code.slice(0, this.prefix.length + lastNewline + 1)
    }
    this.lastResult = [...this.spans, ...this.tokenize(resolved, rest.slice(lastNewline + 1)).map(lineSpans)]
    return this.lastResult
  }
}

/**
 * Tokenize `code` into per-line highlighted runs when `lang` maps to a
 * registered grammar; `undefined` means the caller renders its plain fallback.
 * A line-numbered view needs the token runs split per line (one gutter number
 * per line), which the single-`<pre>` {@link highlightToHtml} does not expose,
 * so this returns shiki's own 2D line/token structure narrowed to what a run
 * renders. Each run's color is a `--shiki-*` custom property, keeping token
 * colors on the theme package's sheets exactly as the HTML path does; the
 * markup font-style bits the theme lets through (bold/italic/underline in
 * markdown scopes) are dropped — the line-numbered file view renders
 * color-only runs. The trailing newline shiki appends as a final empty line
 * is dropped so the run count matches the caller's own line array.
 * @param code - the source text.
 * @param lang - the language hint (a file-extension-derived language id).
 * @returns one entry per source line (each an array of runs), or `undefined` for unknown or not-yet-loaded languages.
 */
/*
 * 把 code 按行分词成高亮片段。带行号的视图需要每行独立的 token 列表（一行一个行号），
 * 这是单个 <pre> 的 highlightToHtml 暴露不出来的，因此本函数直接返回 shiki 的二维
 * 行/token 结构并窄化为片段可渲染的形状；颜色同样走 --shiki-* 自定义属性。
 * 使用示例：highlightLines(code, 'python')?.map((runs, i) => <Row gutter={i + 1} runs={runs} />)。
 * @param code - 源码文本。
 * @param lang - 语言提示（通常来自文件扩展名推导的 id）。
 * @returns 每行一个片段数组；语言未知或尚未加载时返回 undefined。
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  const { tokens } = highlighter().codeToTokens(code, { lang: resolved, theme: 'css-variables' })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own line array does not carry. Drop that
  // one terminator line so the two structures stay in step. The explicit
  // `last !== undefined` (over `tokens[...]?.length`) keeps a single branch for
  // per-file coverage, matching TerminalBlock's terminator check.
  // shiki 把 `a\nb` 切成两行；结尾换行（`a\n`）会多出一个空行，而调用方的行数组
  // 没有它——丢弃这行终止符，让两个结构逐行对齐。
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}
