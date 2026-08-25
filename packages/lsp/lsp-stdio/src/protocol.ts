/*
 * ================================ 文件注释 ================================
 * 【文件职责】lsp-stdio 读取与写入的 LSP 线缆（wire）类型子集：initialize 能力、四种查询结果（Location/LocationLink/Hover）与 textDocumentSync 相关形状。纯类型文件。
 * 【技术维度】字段与真实服务器载荷一一对应，缺失字段保持可选；translate.ts 负责把这些原始类型规范化为缝的封闭联合。位置为零基 UTF-16，与 LSP 协议一致。
 * 【产品维度】这是与任意 LSP 语言服务器对话所需的"协议词典"：翻译层（translate.ts）依据这些形状判断能力并转换结果。
 * 【逻辑维度】WirePosition/WireRange 坐标 → WireLocation/WireLocationLink → 悬停三形态
 *   （MarkupContent/MarkedString/Hover）→ textDocumentSync 两种形式 → WireServerCapabilities →
 *   WireInitializeResult。
 * 【关键边界】只覆盖本宿主用到的子集；未列出字段不做校验；provider 能力槽位以"布尔或对象"表示"支持"。
 * 【新手阅读建议】先读 WireServerCapabilities 了解宿主探测能力的关键字段，再读 WireHover 的三态 contents。
 * ==========================================================================
 */
/**
 * The subset of LSP wire types this generic host reads and writes: initialize capabilities, the four
 * request results (`Location`, `LocationLink`, `Hover`), and the `textDocumentSync` shapes used to
 * decide transient-open support. Types only. Fields absent from a real server payload stay optional;
 * the translation layer normalizes them into the seam's closed unions.
 * @module @deepseek-ai/dsh-lsp-stdio/protocol
 */

/** A zero-based UTF-16 position on the wire (the protocol's `Position`). */
// 线缆上的零基 UTF-16 位置（协议中的 Position）。
export interface WirePosition {
  // 零基行号。
  readonly line: number
  // 行内零基 UTF-16 码元偏移。
  readonly character: number
}

/** A wire range (`Range`). */
// 线缆上的范围（Range）。
export interface WireRange {
  // 起始坐标。
  readonly start: WirePosition
  // 结束坐标（不含）。
  readonly end: WirePosition
}

/** A `Location`: a document URI plus a range. */
// 一个 Location：文档 URI + 范围。
export interface WireLocation {
  // 目标文档 URI。
  readonly uri: string
  // 文档内范围。
  readonly range: WireRange
}

/** A `LocationLink`: the target uri plus the selection range to focus. */
// 一个 LocationLink：目标 URI + 需要聚焦的选择范围。
export interface WireLocationLink {
  // 目标文档 URI。
  readonly targetUri: string
  // 目标文档内应聚焦的选择范围。
  readonly targetSelectionRange: WireRange
  // 目标完整范围（可选）。
  readonly targetRange?: WireRange
}

/** A `MarkupContent` hover body (`markdown` or `plaintext`). */
// 悬停正文的 MarkupContent 形式（markdown 或纯文本）。
export interface WireMarkupContent {
  // 内容格式：markdown 或 plaintext。
  readonly kind: 'markdown' | 'plaintext'
  // 正文文本。
  readonly value: string
}

/** A `MarkedString` object form (`{ language, value }`); the string form is a bare `string`. */
// MarkedString 的对象形式（{ language, value }）；字符串形式就是一个裸 string。
export interface WireMarkedStringObject {
  // 代码块语言标记。
  readonly language: string
  // 代码文本。
  readonly value: string
}

/** One `MarkedString`: a raw string or a language-tagged code block. */
// 一个 MarkedString：裸字符串或带语言标记的代码块对象。
export type WireMarkedString = string | WireMarkedStringObject

/** A `Hover`: contents in any of the protocol's three encodings, plus an optional range. */
// 一个 Hover：contents 可为协议三种编码之一，外加可选范围。
export interface WireHover {
  // 悬停内容：MarkupContent、MarkedString 或 MarkedString 数组。
  readonly contents: WireMarkupContent | WireMarkedString | readonly WireMarkedString[]
  // 悬停适用的范围（可选）。
  readonly range?: WireRange
}

/** The legacy enum form of `textDocumentSync` (`0` None, `1` Full, `2` Incremental). */
// textDocumentSync 的旧式枚举形式（0 不通知、1 全量、2 增量）。
export type WireTextDocumentSyncKind = 0 | 1 | 2

/** The options form of `textDocumentSync` (`{ openClose, change }`). */
// textDocumentSync 的选项形式（{ openClose, change }）。
export interface WireTextDocumentSyncOptions {
  // 是否支持打开/关闭通知（可选）。
  readonly openClose?: boolean
  // 变更通知方式（可选）。
  readonly change?: WireTextDocumentSyncKind
}

/** A `ServerCapabilities.provider` slot: a boolean or an options object (both mean "supported"). */
// ServerCapabilities 的 provider 槽位：布尔或选项对象（两者都表示"支持"）。
export type WireProviderCapability = boolean | Record<string, unknown> | undefined

/** The `ServerCapabilities` fields this host inspects. */
// 本宿主检查的 ServerCapabilities 字段。
export interface WireServerCapabilities {
  // 位置编码（可选，缺省按 utf-16 处理）。
  readonly positionEncoding?: string
  // 文本同步能力：旧式枚举或选项形式。
  readonly textDocumentSync?: WireTextDocumentSyncKind | WireTextDocumentSyncOptions
  // 定义提供者能力。
  readonly definitionProvider?: WireProviderCapability
  // 引用提供者能力。
  readonly referencesProvider?: WireProviderCapability
  // 实现提供者能力。
  readonly implementationProvider?: WireProviderCapability
  // 悬停提供者能力。
  readonly hoverProvider?: WireProviderCapability
}

/** The `initialize` result envelope. */
// initialize 结果信封：携带服务器能力声明。
export interface WireInitializeResult {
  // 服务器声明的能力。
  readonly capabilities: WireServerCapabilities
}
