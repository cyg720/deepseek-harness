/**
 * ================================ 文件注释 ================================
 * 【文件职责】read 工具的"纯展示"层：把提供者解码的文本变成"有界、带行号"的窗口
 * 与模型可见信封。逐块扫描会截断当前行，所以即使一整行没有换行符的巨型行也不会
 * 让内存无界增长。
 * 【技术维度】buildWindow 维护一个累计器（行数/输出字节/截断标记）逐块切行，行缓冲
 * 上限为 maxLineLength+1（多 1 字符足以证明超限）；finish 在 offset 越过 EOF 时抛
 * FS_NOT_FOUND。formatReadOutput 生成 OpenCode 风格带行号信封。langFromPath 用
 * 小扩展名表映射语法高亮语言。readMetaFromMeta 防御性收窄 meta 并校验语义范围
 * （行号必须 1 基、递增、不超过 totalLines）。
 * 【产品维度】让 read 输出对模型友好（行号、续读提示、截断提示），并让 UI 能通过
 * meta 重建代码视图（重放安全）。
 * 【逻辑维度】按出现顺序：上限常量 → 窗口/行/结果/输出类型 → 累计器与切行/截断
 * 函数 → buildWindow → formatReadOutput → LANG_BY_EXTENSION → langFromPath →
 * FsReadMeta → isFileTextLine → readMetaFromMeta。
 * 【关键边界】consumeLine 先做窗口判断再做字节预算（选中行累计超限即置截断标记并
 * 停止）；stripCarriageReturn 去掉行尾 \r（CRLF 文件）；langFromPath 用
 * Object.hasOwn 防原型键（foo.constructor 之类的扩展名不能映射到继承成员）。
 * 【新手阅读建议】先看 buildWindow 的切行/截断逻辑，再看 formatReadOutput 的信封
 * 结构，最后看 readMetaFromMeta 的语义校验链。
 * ==========================================================================
 */
/**
 * Pure read presentation: turn provider-decoded text into a bounded, line-numbered window and
 * model-facing envelope. Chunk scanning caps the current line, so even one newline-free giant
 * line cannot grow memory without bound.
 * @module @deepseek-ai/dsh-tool-fs/read-render
 */
/**
 * 模块总览：本文件不含任何文件 I/O，是 read 的纯展示与窗口计算；上限常量也被
 * index.ts 用作配置默认值。
 */

import { FsError } from '@deepseek-ai/dsh-fs'

/** Default maximum characters returned for a single line (the `readMaxLineLength` config). */
/** 单行默认最大返回字符数（readMaxLineLength 配置的默认值）：2000。 */
export const READ_MAX_LINE_LENGTH = 2000

/** Default maximum bytes returned for selected file lines (the `readMaxBytes` config). */
/** 选中行默认最大返回字节数（readMaxBytes 配置的默认值）：50 KiB。 */
export const READ_MAX_BYTES = 50 * 1024

/** Resolved read window. The consumer applies its defaults/caps before calling. */
/** 已解析的读取窗口。调用方在调用前已套用默认值与上限。 */
export interface ReadWindow {
  /** 1-based first line to return. */
  /** 1 基的起始行。 */
  offset: number
  /** Maximum number of lines to return. */
  /** 最大返回行数。 */
  limit: number
  /** Maximum characters returned for a single line; overflow is truncated with a suffix. */
  /** 单行最大返回字符数；超限截断并加后缀。 */
  maxLineLength: number
  /** Maximum bytes of selected output; overflow stops the scan and marks `truncatedByBytes`. */
  /** 选中输出的最大字节数；超限停止扫描并置 truncatedByBytes。 */
  maxBytes: number
}

/** One line returned from a text file. */
/** 从文本文件返回的一行。 */
export interface FileTextLine {
  /** 1-based line number in the file. */
  /** 文件内 1 基行号。 */
  number: number
  /** Line text without its trailing newline. */
  /** 去掉尾换行的行文本。 */
  text: string
}

/** The windowed result {@link buildWindow} produces from a file's decoded text. */
/** buildWindow 从文件解码文本产出的窗口结果。 */
export interface WindowResult {
  /** Returned lines, already numbered. */
  /** 已编号的返回行。 */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  /** 文件里的精确总行数。 */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  /** 选中输出是否触达字节上限。 */
  truncatedByBytes: boolean
}

/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
/** 一次有界文本读取的结果——formatReadOutput 渲染它的输入。 */
export interface FileReadOutcome {
  /** 1-based first line requested. */
  /** 请求的 1 基起始行。 */
  offset: number
  /** Returned lines, already numbered. */
  /** 已编号的返回行。 */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  /** 文件里的精确总行数。 */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  /** 选中输出是否触达字节上限。 */
  truncatedByBytes?: true
}

// 窗口累计器：行、总行数、输出字节与截断标记。
interface WindowAccumulator {
  lines: FileTextLine[]
  totalLines: number
  outputBytes: number
  truncatedByBytes: boolean
}

// 新累计器。
function newAccumulator(): WindowAccumulator {
  return { lines: [], totalLines: 0, outputBytes: 0, truncatedByBytes: false }
}

// 超长行截断：截到 maxLineLength 并附说明后缀。
function truncateLine(line: string, maxLineLength: number): string {
  return line.length > maxLineLength ? `${line.substring(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)` : line
}

// 一行的字节大小（UTF-8）；当前行数 > 0 时 +1 计换行符。
function lineByteSize(line: string, currentLineCount: number): number {
  return Buffer.byteLength(line, 'utf8') + (currentLineCount > 0 ? 1 : 0)
}

// 消费一行：总行数必增；再按"截断/窗口范围/行数上限"过滤；最后做字节预算。
function consumeLine(acc: WindowAccumulator, rawLine: string, request: ReadWindow): void {
  acc.totalLines += 1
  if (acc.truncatedByBytes || acc.totalLines < request.offset || acc.lines.length >= request.limit) return

  const text = truncateLine(rawLine, request.maxLineLength)
  const bytes = lineByteSize(text, acc.lines.length)
  if (acc.outputBytes + bytes > request.maxBytes) {
    acc.truncatedByBytes = true
    return
  }
  acc.outputBytes += bytes
  acc.lines.push({ number: acc.totalLines, text })
}

// 去掉行尾 \r（CRLF 文件）。
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

// 收尾：offset 越过 EOF（且不是"空文件请求第 1 行"）时报 FS_NOT_FOUND。
function finish(acc: WindowAccumulator, request: ReadWindow, displayPath: string): WindowResult {
  if (!acc.truncatedByBytes && request.offset > acc.totalLines && !(acc.totalLines === 0 && request.offset === 1)) {
    throw new FsError(`offset ${request.offset} is out of range for "${displayPath}" (${acc.totalLines} lines)`, 'FS_NOT_FOUND')
  }
  return { lines: acc.lines, totalLines: acc.totalLines, truncatedByBytes: acc.truncatedByBytes }
}

/**
 * Build one window from streamed or whole-file chunks, enforcing line and byte caps while still
 * scanning to an exact total line count, and throwing `FS_NOT_FOUND` when the requested offset is
 * past EOF.
 * @param chunks - decoded text chunks in file order; chunk boundaries carry no meaning.
 * @param request - the resolved window; the caller has already applied its defaults and caps.
 * @param displayPath - the caller-facing path used in the offset-out-of-range error.
 * @returns the numbered window lines, the total line count seen, and the byte-cap truncation flag.
 */
/**
 * 从流式/整文件块构建一个窗口：在强制行与字节上限的同时仍扫描出精确总行数；
 * 请求的 offset 越过 EOF 时抛 FS_NOT_FOUND。
 * @param chunks 按文件顺序的解码文本块；块边界无含义。
 * @param request 已解析窗口；调用方已套用默认值与上限。
 * @param displayPath 越界报错时使用的展示路径。
 * @returns 编号窗口行、看到的总行数、字节上限截断标记。
 */
export async function buildWindow(
  chunks: AsyncIterable<string> | Iterable<string>,
  request: ReadWindow,
  displayPath: string,
): Promise<WindowResult> {
  const acc = newAccumulator()
  // One char past the truncation point is enough to prove a line overflows.
  // 中文说明：超过截断点 1 个字符就足以证明一行超限。
  const lineBufferCap = request.maxLineLength + 1
  let lineBuffer = ''

  // 把一段文本追加进行缓冲，但不超过上限（超出即截断，不再增长）。
  function appendToLineBuffer(segment: string): void {
    if (lineBuffer.length >= lineBufferCap) return
    lineBuffer += segment
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap)
  }

  // 冲刷当前行缓冲：去掉行尾 \r 后消费，并清空缓冲。
  function flushLine(): void {
    consumeLine(acc, stripCarriageReturn(lineBuffer), request)
    lineBuffer = ''
  }

  // 逐块切行：块内按 \n 分割，未结束的残段留到下一块。
  for await (const chunk of chunks) {
    let startPos = 0
    let newlinePos: number
    while ((newlinePos = chunk.indexOf('\n', startPos)) !== -1) {
      appendToLineBuffer(chunk.slice(startPos, newlinePos))
      flushLine()
      startPos = newlinePos + 1
    }
    appendToLineBuffer(chunk.slice(startPos))
  }
  if (lineBuffer.length > 0) flushLine()
  return finish(acc, request, displayPath)
}

/**
 * Format a read outcome as one OpenCode-style line-numbered text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param outcome - the windowed read to render.
 * @returns the model-facing envelope: numbered lines plus a continuation or end-of-file footer.
 */
/**
 * 把读结果格式化成 OpenCode 风格的带行号文本块主体。
 * @param displayPath 信封 <path> 元素里的后端解析路径。
 * @param outcome 要渲染的窗口读结果。
 * @returns 模型可见信封：带行号的行 + 续读或文件尾脚注。
 */
export function formatReadOutput(displayPath: string, outcome: FileReadOutcome): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1)
  let footer: string
  // 三种脚注：字节截断 / 还有更多行（提示续读）/ 文件尾。
  if (outcome.truncatedByBytes) {
    footer = `(Output capped. Showing lines ${outcome.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`
  } else if (endLine < outcome.totalLines) {
    footer = `(Showing lines ${outcome.offset}-${endLine} of ${outcome.totalLines}. Use offset=${endLine + 1} to continue.)`
  } else {
    footer = `(End of file - total ${outcome.totalLines} lines)`
  }
  const body = outcome.lines.length > 0
    ? `${outcome.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}`
    : footer
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${body}
</content>`
}

/**
 * Lowercased file-extension to syntax-highlighting language hint. Keys are the
 * extension without its dot; a UI treats an absent key as plain text. The map is
 * intentionally small — common source, config, and markup extensions a
 * line-numbered code view benefits from highlighting — not an exhaustive registry.
 */
/**
 * 小写文件扩展名 → 语法高亮语言提示。键是去掉点的扩展名；UI 把缺失的键当纯文本。
 * 映射刻意保持精简——只收录带行号代码视图值得高亮的常见源码/配置/标记扩展名，
 * 不是穷举注册表。
 */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/**
 * Derive a syntax-highlighting language hint from a read path's file extension.
 * Pure and case-insensitive on the extension; a dotfile with no extension
 * (`.gitignore`) and an unknown extension both yield `undefined`.
 * @param path - the model-facing path the read reported.
 * @returns the language hint for {@link LANG_BY_EXTENSION}, or `undefined` when the extension maps to none.
 */
/**
 * 从读取路径的文件扩展名推导语法高亮语言提示。对扩展名大小写不敏感；无扩展名的
 * 点文件（.gitignore）与未知扩展名都返回 undefined。
 * @param path 读取报告的模型侧路径。
 * @returns LANG_BY_EXTENSION 的语言提示；扩展名无映射时为 undefined。
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  // A leading dot is a dotfile (no extension), not an empty extension.
  // 中文说明：前导点是点文件（无扩展名），不是空扩展名。
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  // Own-property check only: a filename whose extension is an Object.prototype
  // key (`foo.constructor`, `foo.__proto__`) must map to no language, not to the
  // inherited member — otherwise a function would reach `lang` and fail the
  // tool-output JSON validation.
  // 中文说明：只查自有属性：扩展名是 Object.prototype 键（foo.constructor、
  // foo.__proto__）的文件名必须映射为无语言，而不是映射到继承成员——否则会有函数
  // 溜进 lang 字段并让工具输出的 JSON 校验失败。
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/**
 * The `read` tool's private `tool/result` `meta` payload: the structured
 * line-numbered window a capable UI renders as a code view. Attached opaquely (as
 * `unknown`) on the tool result and persisted with the session log — it must be
 * JSON-serializable (the session validates this at `append`), so `presentResult`
 * reproduces the read card on replay when the raw structured output is no longer
 * on the wire. The producing tool owns and narrows this opaque shape.
 */
/**
 * read 工具私有的 tool/result meta 载荷：有能力的 UI 渲染成代码视图的结构化带行号
 * 窗口。以不透明 unknown 形式附在工具结果上并随会话日志持久化——必须可 JSON
 * 序列化（会话在 append 时校验），这样线上不再有原始结构化输出时，presentResult
 * 仍能在重放时复现读卡片。生产工具拥有并收窄这个不透明形状。
 */
export interface FsReadMeta {
  /** The read file's model-facing path. */
  /** 被读文件的模型侧路径。 */
  path: string
  /** The 1-based first line the window requested, kept even when `lines` is empty. */
  /** 窗口请求的 1 基起始行；lines 为空时也保留。 */
  offset: number
  /** The returned window's lines, each keeping its file line number. */
  /** 返回窗口的行，各自保留文件行号。 */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  /** 文件里的精确总行数。 */
  totalLines: number
  /** Syntax-highlighting language hint from the extension, or omitted for plain text. */
  /** 从扩展名来的语法高亮语言提示；纯文本时省略。 */
  lang?: string
}

/**
 * Whether `value` is a valid {@link FileTextLine} (defensive narrowing from
 * opaque `meta`). `number` must be a 1-based integer line number, since a card
 * rendered from a zero, fractional, or non-finite line number would violate the
 * 1-based numbering contract the read window promises.
 */
/**
 * value 是否为合法的 FileTextLine（从不透明 meta 做的防御性收窄）。number 必须是
 * 1 基整数行号——从 0/小数/非有限行号渲染卡片会违反读窗口承诺的 1 基编号契约。
 */
function isFileTextLine(value: unknown): value is FileTextLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { number, text } = value as Record<string, unknown>
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 && typeof text === 'string'
}

/**
 * Narrow opaque live or replayed result metadata to a structured read window.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic text card instead of throwing during replay. Beyond shape, the
 * semantic contract of a read window is enforced against replayed JSON that is
 * well-typed but out of range: `offset` must be a 1-based integer, `totalLines`
 * must be a non-negative integer, each line number must be a 1-based integer no
 * less than `offset`, the line numbers must strictly increase, and no line number
 * may exceed `totalLines`. Any violation declines to the generic fallback rather
 * than emitting a card that misnumbers or overcounts.
 * @param meta - result metadata.
 * @returns the validated read window, or `undefined` for absent, malformed, or semantically invalid data.
 */
/**
 * 把不透明的实时/重放结果 meta 收窄成结构化读窗口。畸形 meta 返回 undefined，让
 * 展示层回退到通用文本卡片而不是在重放时抛错。除了形状，还针对"类型正确但越界"
 * 的重放 JSON 强制读窗口的语义契约：offset 必须是 1 基整数、totalLines 必须是非负
 * 整数、每个行号必须是 1 基整数且不小于 offset、行号必须严格递增、行号不得超过
 * totalLines。任何违规都回退到通用兜底，而不是发出错号或超数卡片。
 * @param meta 结果元数据。
 * @returns 已校验的读窗口；缺失、畸形或语义无效时为 undefined。
 */
export function readMetaFromMeta(meta: unknown): FsReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, offset, lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof path !== 'string' || typeof totalLines !== 'number' || typeof offset !== 'number') return undefined
  if (!Number.isInteger(offset) || offset < 1) return undefined
  if (!Number.isInteger(totalLines) || totalLines < 0) return undefined
  if (!Array.isArray(lines) || !lines.every(isFileTextLine)) return undefined
  if (lang !== undefined && typeof lang !== 'string') return undefined
  // 语义校验：行号严格递增且不超过 totalLines（起始基准是 offset-1）。
  let previous = offset - 1
  for (const { number } of lines) {
    if (number <= previous || number > totalLines) return undefined
    previous = number
  }
  return { path, offset, lines, totalLines, ...lang === undefined ? {} : { lang } }
}
