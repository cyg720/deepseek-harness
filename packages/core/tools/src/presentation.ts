/**
 * Tool render-intent vocabulary: the provider-neutral types a tool declares via
 * `ToolDefinition.presentCall`/`ToolDefinition.presentResult` to say how one of its calls
 * renders in a UI (an editor's tool-call card, a CLI log line).
 * @module @deepseek-ai/dsh-tools/src/presentation
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * Category of a tool call, used by a UI to pick an icon or treatment. The
 * provider-neutral vocabulary lets tools describe themselves without depending
 * on a particular client; `other` is the default.
 */
/**
 * 【中文】工具调用的类别标签，UI 用它挑图标或配色。这是与具体客户端解耦的中立
 *   词汇：读/改/删/移动/搜索/执行/抓取，缺省为 other。
 */
export type ToolCallKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'

/**
 * A file location a tool reads or modifies, so a capable UI can "follow along" —
 * highlight or jump to the file (and line) as the tool runs. `path` is what the
 * tool operated on (the model-facing path); `line` is an optional 1-based line
 * to focus (e.g. a read's offset).
 */
/**
 * 【中文】一个被读取/修改的文件位置：能力强的 UI 可以"跟随"——在工具运行时高亮
 *   或跳转到对应文件（及行号）。
 */
export interface FileLocation {
  /** 工具操作的文件路径（面向模型的路径写法）。 */
  path: string
  /** 可选的聚焦行号，1 起始（例如一次读取的 offset 行）。 */
  line?: number
}

/**
 * A single-file change a tool is about to make, for a UI that renders inline
 * diffs. `oldText` is `null` for a new-file create (nothing to diff against);
 * an overwrite also uses `null`, because a call-time presenter has no access to
 * the file's prior content.
 */
/**
 * 【中文】单个文件的一次变更描述，供支持内联 diff 的 UI 渲染。注意 oldText 为 null
 *   的两种情况：新建文件（没有旧内容可比）与覆盖写入（调用时呈现器拿不到旧内容）。
 */
export interface FileDiff {
  /** 变更目标文件的路径。 */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (no prior content available at call time). */
  /** 【中文】变更前内容；新建文件或覆盖写入时为 null（调用时刻拿不到旧内容）。 */
  oldText: string | null
  /** Content after the change. */
  /** 【中文】变更后的完整内容。 */
  newText: string
}

/**
 * Provider-neutral pending-call presentation. Tools declare one tagged intent;
 * UI bridges map it without special-casing tool names.
 */
/**
 * 【中文】调用进行中（pending）状态的呈现意图，三选一的联合：
 *   generic（默认卡片）/ terminal（终端命令）/ diff(文件变更)。UI 桥接层按 card
 *   标签分发渲染，无需对具体工具名做特判。
 */
export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView

/**
 * The default card: a titled tool-call row with an optional category icon, a
 * salient raw input, extra content blocks, and follow-along file locations. Any
 * tool whose call is not a terminal or a diff uses this.
 */
/**
 * 【中文】默认调用卡片：一行"标题 + 可选类别图标 + 关键输入 + 内容块 + 跟随文件位置"。
 *   凡不是终端命令也不是文件变更的调用都走这一族。
 */
export interface GenericCallView {
  /** 联合类型的判别字段：通用卡片。 */
  card: 'generic'
  /**
   * Human-readable, always-visible label describing what THIS call does. Keep it
   * short — a UI shows it as a card header / log line.
   */
  /**
   * 【中文】描述"这一次调用做什么"的人类可读标题，始终可见；保持简短——UI 把它当
   *   卡片头或日志行展示。
   */
  title: string
  /** Category for icon/treatment; defaults to `other` when omitted. */
  /** 【中文】图标/配色类别；省略时按 other 处理。 */
  kind?: ToolCallKind
  /**
   * The salient input to show in a detail/expanded view (e.g. a background
   * job id). Omit to show nothing; a string renders as-is, an object as pretty
   * JSON. NOT the full raw args object unless that is genuinely what a reader wants.
   */
  /**
   * 【中文】展开视图里最值得看的关键输入（例如后台任务 id）。字符串原样显示、对象按
   *   格式化 JSON 显示；不要无脑塞整个 args——只放读者真正需要的。
   */
  rawInput?: unknown
  /**
   * UI-facing content blocks to show on the pending call alongside the title.
   * Omit to show none. A UI maps these to its own content blocks.
   */
  /** 【中文】pending 状态下随标题一起显示的 UI 侧内容块；可省略。 */
  content?: ContentBlock[]
  /** Files this call reads/modifies, for editor follow-along. Omit for a call that touches no file. */
  /** 【中文】本次调用读/写的文件列表，供编辑器跟随高亮；不碰文件时省略。 */
  locations?: FileLocation[]
}

/**
 * A call that IS a shell command running in a working directory: a capable UI
 * renders it as a terminal card (cwd-headed, with the command as the title and
 * live/afterward output from the {@link TerminalResultView}); an incapable UI
 * falls back to a generic card whose body is the fenced command output. Set by a
 * tool whose call is a foreground command (e.g. `bash`).
 */
/**
 * 【中文】终端卡片：本次调用本身就是一条在某工作目录里运行的 shell 命令（如 bash）。
 *   能力强的 UI 渲染成以 cwd 开头的终端卡；能力弱的 UI 回退为通用卡片 +
 *   围栏代码块输出。
 */
export interface TerminalCallView {
  /** 判别字段：终端卡片。 */
  card: 'terminal'
  /** The command, shown as the terminal card's title / header line. */
  /** 【中文】命令文本本身，作为终端卡的标题/头行。 */
  title: string
  /**
   * A human-readable one-line summary of what the command does, rendered ABOVE
   * the terminal card (the card itself has no description slot). Omit for none.
   */
  /**
   * 【中文】命令用途的一行人类可读摘要，渲染在终端卡上方（卡片自身没有描述槽位）；
   *   可省略。
   */
  description?: string
  /**
   * Working directory the command runs in, shown as the terminal header. An
   * ABSOLUTE path is used as-is; a RELATIVE path is resolved by the UI bridge
   * against the session workspace (the pure presenter can't see the session cwd).
   * Omit entirely to let the bridge use the session workspace.
   */
  /**
   * 【中文】命令运行的工作目录，显示在终端头。绝对路径原样使用；相对路径由 UI 桥接层
   *   相对会话工作区解析（纯呈现函数看不到会话 cwd）；完全省略则桥接层用会话工作区。
   */
  cwd?: string
}

/**
 * A call that creates or modifies files, rendered as an inline diff card by a
 * capable UI. Set by a tool whose call writes/edits a file (e.g. `write`,
 * `edit`). The diffs are derived from the call ARGUMENTS (a create's `oldText` is
 * `null`); the tool emits a separate {@link DiffResultView} after `execute` — the
 * applied change (an edit/overwrite hunk with context, or a whole-file diff for a
 * create).
 */
/**
 * 【中文】diff 卡片：即将写/改文件的调用（如 write/edit）。diff 从调用参数推导而来；
 *   execute 完成后工具还会另发一个 DiffResultView 描述"实际落盘的变更"。
 */
export interface DiffCallView {
  /** 判别字段：文件变更卡片。 */
  card: 'diff'
  /** Card header (e.g. `Write foo.txt`). */
  /** 【中文】卡片标题，如 `Write foo.txt`。 */
  title: string
  /** One entry per file the call changes. */
  /** 【中文】每个被变更文件一条记录。 */
  diffs: FileDiff[]
  /** Files this call modifies, for editor follow-along (usually the diffs' paths). */
  /** 【中文】被修改文件列表，供编辑器跟随（通常就是 diffs 的路径）。 */
  locations?: FileLocation[]
}

/**
 * One numbered line of a file, the unit a {@link ReadResultView} carries so a
 * capable UI can render a syntax-highlighted, line-numbered code view. `number`
 * is the 1-based line number in the file (a window past `offset` keeps the file's
 * own numbering, not a 1-based re-count); `text` is the line without its trailing
 * newline, already truncated to the read tool's per-line cap.
 */
/**
 * 【中文】文件中的一行带行号内容，是读取结果卡片的基本单元，UI 可据此渲染出
 *   带语法高亮和行号的代码视图。
 */
export interface ReadFileLine {
  /** 该行在文件中的 1 起始行号（窗口偏移后仍保留文件自身编号，不重新从 1 数）。 */
  number: number
  /** 行文本（不含末尾换行），已按 read 工具的单行长度上限截断。 */
  text: string
}

/**
 * How a tool wants the COMPLETED call shown — the *result* state, after `execute`
 * returns. A `card`-tagged union mirroring {@link ToolCallView}: a UI switches on
 * `card`. Lets the tool reformat its result for a UI distinctly from the
 * model-facing text it returned from `execute`. Returned by
 * `ToolDefinition.presentResult`; omitting the method keeps the pending
 * title and renders the raw result content.
 */
/**
 * 【中文】调用完成（execute 返回后）的呈现意图：与 ToolCallView 对称、按 card 标签
 *   分发的六族联合。工具可以给 UI 一份与"返回给模型的文本"不同的格式化结果；
 *   工具不实现 presentResult 时沿用 pending 标题并直接渲染原始结果内容。
 */
export type ToolResultView = GenericResultView | TerminalResultView | DiffResultView | SearchResultView | ReadResultView | WebResultView

/**
 * The default completed card: an optional replacement title and reformatted
 * content. Omit a field to keep the pending title / render the raw result content.
 */
/**
 * 【中文】默认完成卡片：可选地替换标题、重排内容；字段省略即"保持 pending 标题 /
 *   渲染原始结果"。
 */
export interface GenericResultView {
  /** 判别字段：通用结果卡。 */
  card: 'generic'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略则沿用 pending 态标题。 */
  title?: string
  /**
   * UI-facing result content (harness {@link ContentBlock}s), reformatted from
   * the model-facing result. Omit to let the UI render the raw result content.
   */
  /**
   * 【中文】面向 UI 的结果内容块（从模型侧结果重排而来）；省略则 UI 直接渲染原始结果。
   */
  content?: ContentBlock[]
}

/**
 * The completed state of a {@link TerminalCallView}: the captured output and exit
 * status. A capable UI renders `output` in the terminal card and shows an
 * exit-status pill; an incapable UI gets a fenced ```console fallback the BRIDGE
 * derives from `output` (the tool does not double-encode it).
 */
/**
 * 【中文】终端调用的完成态：捕获到的命令输出 + 退出状态。能力强的 UI 在终端卡里渲染
 *   输出并显示退出状态徽章；能力弱的 UI 由桥接层把 output 包成 ```console 围栏块
 *   （工具不做双重编码）。
 */
export interface TerminalResultView {
  /** 判别字段：终端结果卡。 */
  card: 'terminal'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** Captured command output (stdout+stderr as the tool chooses to combine them). */
  /** 【中文】捕获的命令输出（stdout+stderr 如何合并由工具自定）。 */
  output?: string
  /**
   * Process exit code, when the run ended by exiting (not a signal). Lets a
   * capable UI show an exit-status pill. Omit when killed by a signal or unknown.
   */
  /**
   * 【中文】进程正常退出时的退出码（被信号杀死时省略），供 UI 显示退出状态徽章。
   */
  exitCode?: number
  /** Signal name that killed the process (e.g. `SIGTERM`). Mutually exclusive with `exitCode`. */
  /** 【中文】杀死进程的信号名（如 SIGTERM）；与 exitCode 互斥。 */
  signal?: string
}

/**
 * A completed file mutation rendered as an inline diff card, the result-time
 * analogue of {@link DiffCallView}. Because a completed UI update replaces the
 * pending card content, mutation tools return this even when it repeats the
 * call-time diff; otherwise raw result text would replace the diff.
 */
/**
 * 【中文】文件变更的完成态（DiffCallView 的结果时版本）。关键点：完成态更新会整体
 *   替换 pending 卡片内容，所以即使 diff 与调用时相同也必须再发一次，否则原始结果
 *   文本会把 diff 卡顶掉。
 */
export interface DiffResultView {
  /** 判别字段：diff 结果卡。 */
  card: 'diff'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** The change to show, in file order — applied contextual hunks, or a whole-file diff when there is no before-image. */
  /** 【中文】按文件序展示的变更：带上下文的已应用 hunk；无旧图时为整文件 diff。 */
  diffs: FileDiff[]
}

/** One matched line inside a {@link SearchFileMatches} group: its 1-based line number and text. */
export interface SearchLineMatch {
  /** 1-based line number of the match within its file. */
  lineNumber: number
  /** The matched line text, as the tool surfaced it (the per-line preview budget already applied). */
  line: string
}

/** One file's grouped content matches for a {@link SearchMatchesResultView}, in first-seen file order. */
export interface SearchFileMatches {
  /** The file the matches belong to (the model-facing display path). */
  path: string
  /** The file's matched lines, in output order. */
  matches: SearchLineMatch[]
}

/**
 * A completed content search (`grep`) rendered as a search card whose matches are
 * grouped by file, so a capable UI can list each file as an expandable group of
 * its matched lines. `shape: 'matches'` discriminates this variant from the path
 * variant ({@link SearchPathsResultView}) within {@link SearchResultView}. The
 * discriminant is `shape`, not `kind`, so it never collides with the
 * {@link ToolCallKind} `kind` an icon-picking bridge reads off a call view.
 */
export interface SearchMatchesResultView {
  /** 判别字段：搜索卡。 */
  card: 'search'
  /** 判别字段：按文件分组的"内容命中"变体。 */
  shape: 'matches'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** Matched lines grouped by file, in first-seen file order. */
  /** 【中文】按文件分组的命中行，按文件首次出现顺序排列。 */
  files: SearchFileMatches[]
  /**
   * Whether the tool capped the inline result: `files` carries only the retained
   * matches, not every match the search found. A UI shows a capped indicator so it
   * never presents a partial group as complete.
   */
  /**
   * 【中文】结果是否被截断：为 true 时 files 只含保留的命中；UI 必须显示截断标记，
   *   不能把部分结果当完整结果呈现。
   */
  truncated: boolean
  /** Total matches the search found before capping (equals the retained count when not `truncated`). */
  /** 【中文】截断前的总命中数（未截断时等于保留数）。 */
  total: number
}

/**
 * A completed path search (`glob`) rendered as a search card whose result is a flat
 * path list. `shape: 'paths'` discriminates this variant from the grouped-matches
 * variant ({@link SearchMatchesResultView}) within {@link SearchResultView}.
 */
export interface SearchPathsResultView {
  /** 判别字段：搜索卡。 */
  card: 'search'
  /** 判别字段：扁平路径列表变体。 */
  shape: 'paths'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** The discovered paths, in the tool's result order (the retained page when `truncated`). */
  /** 【中文】发现的路径列表（工具的结果顺序）；截断时仅为保留页。 */
  paths: string[]
  /**
   * Whether the tool capped the inline result: `paths` carries only the retained
   * page, not every path the search found. A UI shows a capped indicator so it
   * never presents a partial list as complete.
   */
  /**
   * 【中文】结果是否被截断：为 true 时 paths 只含保留页；UI 需显示截断标记。
   */
  truncated: boolean
  /** Total paths the search found before capping (equals `paths.length` when not `truncated`). */
  /** 【中文】截断前的路径总数（未截断时等于 paths.length）。 */
  total: number
}

/**
 * A completed search rendered as a search card, the result-time view a discovery
 * tool (`grep`, `glob`) returns from `presentResult`. One `card: 'search'` view
 * with two `shape`-discriminated variants: grouped-by-file content matches
 * ({@link SearchMatchesResultView}) and a flat path list
 * ({@link SearchPathsResultView}). Both carry a `truncated`/`total` signal so a UI
 * never presents a capped result as complete. The view carries no result text: a
 * UI without a search card falls back to the raw `tool/result` content. There is
 * no call-time analogue: a search call stays a {@link GenericCallView}
 * (`kind: 'search'`) because the pending state has no matches or paths to show —
 * the structured shape exists only after `execute`.
 */
/**
 * 【中文】搜索类工具（grep/glob）完成态的呈现意图：同一张搜索卡、两种 shape 变体。
 *   两者都带 truncated/total，UI 据此不把截断结果当完整结果；视图本身不含结果文本，
 *   无搜索卡能力的 UI 直接回退原始 tool/result 内容。pending 态没有对应卡片——
 *   那时还没有命中可展示。
 */
export type SearchResultView = SearchMatchesResultView | SearchPathsResultView

/**
 * A completed file read rendered as a line-numbered, optionally syntax-highlighted
 * code view by a capable UI. Set by a tool whose call reads file text (e.g.
 * `read`); the pending state stays a {@link GenericCallView} (`kind: 'read'`)
 * because a call carries no content until `execute` returns. The structured
 * `lines`/`path`/`lang`/`totalLines` fields cannot be reconstructed from the
 * model-facing result text alone, so the read tool projects them through its
 * `output.presentationMeta` (persisted with the session log) and `presentResult`
 * narrows that metadata back into this view on live and replay paths alike. A UI
 * without the read capability falls back to `content` (the model-facing text with
 * its envelope stripped), so this view degrades to the generic text card.
 */
export interface ReadResultView {
  /** 判别字段：读取结果卡。 */
  card: 'read'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** The read file's path (the model-facing path; the bridge relativizes it). */
  /** 【中文】被读文件的路径（面向模型写法；桥接层负责转成相对路径）。 */
  path: string
  /**
   * The 1-based first line the window requested, preserved even when `lines` is
   * empty (a byte cap below the first selected line yields an empty window) so a
   * UI knows where the window starts and where a continuation resumes.
   */
  /**
   * 【中文】窗口请求的 1 起始起始行号；即使 lines 为空也保留（字节上限可能低于首行
   *   导致空窗口），UI 据此知道窗口起点与续读位置。
   */
  offset: number
  /** The returned window's lines, in file order, each keeping its file line number. */
  /** 【中文】返回窗口内的行列表（按文件顺序，各自保留文件行号）。 */
  lines: ReadFileLine[]
  /** Exact total line count in the file, so a UI can show a "showing N of M" affordance. */
  /** 【中文】文件总行数（精确值），供 UI 显示"已显示 N/M"。 */
  totalLines: number
  /**
   * A syntax-highlighting language hint derived from the file extension (e.g.
   * `ts`, `py`), or omitted when the extension maps to no known language so a UI
   * renders the lines as plain text.
   */
  /**
   * 【中文】由扩展名推导的语法高亮语言提示（如 ts/py）；无已知映射时省略，
   *   UI 按纯文本渲染。
   */
  lang?: string
  /**
   * The model-facing result content with its envelope stripped, for a UI without
   * the read capability. Omit to let such a UI render the raw result content.
   */
  /**
   * 【中文】剥掉信封后的模型侧结果内容，供没有读取卡能力的 UI 兜底使用；
   *   省略则这类 UI 直接渲染原始结果内容。
   */
  content?: ContentBlock[]
}

/**
 * One citeable source in a completed {@link WebSearchResultView}, the faithful
 * projection of one web-search source. The presentation projection of `dsh-web`'s
 * `WebSearchSource`: that Service Definition type is authoritative (core cannot depend
 * on the web Service Definition, so the two are declared separately and MUST evolve together).
 * A web tool projects this shape through `output.presentationMeta` because the
 * render text cannot losslessly carry it (see the web-result-card Agent Note); its
 * `presentResult` reads it back.
 */
/**
 * 【中文】一条可引用的网页来源：dsh-web 的 `WebSearchSource` 在本包的中立投影。
 *   core 不能依赖 web 服务定义，所以两边各自声明、必须同步演进。渲染文本无法
 *   无损携带这些字段，web 工具通过 output.presentationMeta 投影、presentResult 读回。
 */
export interface WebSource {
  /** The source URL. */
  /** 【中文】来源 URL。 */
  url: string
  /** The source title, when the provider returned one. */
  title?: string
  /** A short excerpt or summary, when the provider returned one. */
  snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string, when present. */
  publishedAt?: string
}

/**
 * A completed web retrieval rendered as a structured card by a capable UI. Set
 * by a web tool whose call retrieves from the web (`web_search`, `web_fetch`).
 * One `kind`-tagged union carries both shapes because both are web retrieval and
 * a UI renders them with one component family; a UI switches on `kind`. An
 * incapable UI falls back to the raw `tool/result` content (this view carries no
 * `content` copy — see the web-result-card Agent Note). This is the result-time
 * analogue of the `web_search`/`web_fetch` calls' generic call views
 * (`kind: 'search'`/`'fetch'`); those tools keep their generic pending card and
 * add only this completed card.
 *
 * The `kind` field here is this union's own discriminant, NOT a
 * {@link ToolCallKind}: the two values deliberately match the tools' pending
 * `ToolCallKind` (`'search'`/`'fetch'`) so a call and its result read as one
 * category, but a new arm is a union edit plus a consumer branch, not any
 * arbitrary `ToolCallKind` value.
 */
/**
 * 【中文】网页检索完成态的呈现意图：web_search 与 web_fetch 共用一张 `card: 'web'`
 *   卡片、以各自的 kind 字段区分。无 web 能力的 UI 回退到原始 tool/result 内容
 *   （此视图不携带 content 副本）。
 */
export type WebResultView = WebSearchResultView | WebFetchResultView

/**
 * The completed state of a `web_search` call: the structured sources the model
 * cited, an optional provider answer, and whether the source list was cut to the
 * result cap. A capable UI renders the sources as a citation list; a UI without
 * the `web` capability falls back to the raw `tool/result` content.
 */
/**
 * 【中文】`web_search` 的完成态：模型引用的结构化来源列表、可选的提供方回答，
 *   以及来源列表是否被结果上限截断。能力强的 UI 渲染成引用清单。
 */
export interface WebSearchResultView {
  /** 判别字段：web 卡。 */
  card: 'web'
  /** 判别字段：搜索变体（与调用侧 ToolCallKind 的 'search' 取值一致，读起来像同一类）。 */
  kind: 'search'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** The faithful, structured sources — the field render text cannot losslessly carry. */
  /** 【中文】忠实结构化的来源列表——渲染文本无法无损携带的字段都在这里。 */
  sources: WebSource[]
  /** The provider-generated answer text, when any. */
  /** 【中文】提供方生成的回答文本（有则给）。 */
  answer?: string
  /** True when the web service cut the source list to honor the result cap. */
  /** 【中文】true 表示 web 服务为满足结果上限裁剪了来源列表。 */
  truncated: boolean
}

/**
 * The completed state of a `web_fetch` call: the fetched URL, its HTTP status,
 * and whether the content was cut. The body itself is already markdown in the
 * raw `tool/result` content, so this card carries only the retrieval summary and
 * a UI without the `web` capability falls back to that content.
 */
/**
 * 【中文】`web_fetch` 的完成态：抓取的最终 URL、HTTP 状态码与内容是否被裁剪。
 *   正文本身已是 markdown、随原始 tool/result 内容走，所以此卡只带检索摘要。
 */
export interface WebFetchResultView {
  /** 判别字段：web 卡。 */
  card: 'web'
  /** 判别字段：抓取变体。 */
  kind: 'fetch'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  /** 【中文】完成态替换标题；省略沿用 pending 标题。 */
  title?: string
  /** The final URL after allowed redirects. */
  /** 【中文】经过允许的重定向之后的最终 URL。 */
  url: string
  /** HTTP status code of the fetched response. */
  /** 【中文】响应的 HTTP 状态码。 */
  statusCode: number
  /**
   * True when the provider capped the decoded body, or the output cap or a
   * pre-conversion source cut trimmed the rendered text (the effective
   * truncation the model-facing text also reflects).
   */
  /**
   * 【中文】true 表示有效截断：提供方封顶了解码正文，或输出上限/转换前源裁剪了
   *   渲染文本（与模型侧文本反映的截断一致）。
   */
  truncated: boolean
}
