/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-lsp 能力缝（capability seam，能力接缝）的"词汇表"文件：定义规范化请求、提供者与结果的契约类型。本文件只含类型声明，不含任何运行时逻辑。
 * 【技术维度】纯 TypeScript 类型（interface / type 联合）；坐标采用 LSP 协议约定的零基 UTF-16 编码；
 *   结果采用可判别联合（discriminated union，带 kind 标签的联合类型），配合 switch 穷尽检查实现
 *   编译期安全。
 * 【产品维度】为"跳转定义、查找引用、跳转实现、悬停提示"四种语义查询提供统一类型契约，屏蔽不同语言服务器协议的差异，是模型调用 LSP 工具时的数据类型基础。
 * 【逻辑维度】按出现顺序：四种语义操作（LspOperation）→ 坐标与范围（LspPosition/LspRange）→ 查询请求
 *   （LspQueryRequest 与提供者视角的 LspProviderQuery）→ 查询结果（LspLocation/LspHover/LspQueryResult）
 *   → 提供者接口（LspProvider）→ 服务缝接口（LspService）。
 * 【关键边界】只暴露四种语义操作，不暴露协议类型与 JSON-RPC 逃生口；请求字段全部必填、无默认值解析步骤；模型侧工具使用一基光标（one-based），与本文件的零基坐标在工具层转换。
 * 【新手阅读建议】先读 LspOperation 与 LspQueryResult 理解"缝"对外承诺的能力，再读 LspProvider 与 LspService 理解注册与查询两端的职责，最后结合 lsp/lsp/src/index.ts 看运行时实现如何满足这些契约。
 * ==========================================================================
 */
/**
 * LSP seam vocabulary: the normalized request, provider, and result contracts. Types only — the
 * {@link LspError} taxonomy and the {@link LspProviderId} brand factory are runtime and live in
 * `index.ts`. Positions and ranges are zero-based UTF-16, matching the protocol; the model-facing
 * tool owns the one-based cursor convention. The seam exposes no protocol types, process or document
 * controls, or generic JSON-RPC escape hatch — only the four semantic operations.
 * @module @deepseek-ai/dsh-lsp/types
 */

import type { LspProviderId } from './brand.ts'

/**
 * The four semantic queries the seam and model expose. A closed union: adding an operation is a
 * compile-enforced change across the seam, providers, and the tool. Symbols and call hierarchy are
 * not operations here; they need different schemas.
 */
// 语义查询的四种操作（封闭联合）：新增操作会在缝、各提供者与工具侧被编译期强制同步修改。
export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'

/** A zero-based UTF-16 cursor coordinate, matching the LSP wire convention. */
// 零基 UTF-16 光标坐标，与 LSP 线缆协议约定一致。
export interface LspPosition {
  /** Zero-based line. */
  // 零基行号（从 0 开始）。
  readonly line: number
  /** Zero-based UTF-16 code-unit offset within the line. */
  // 行内零基 UTF-16 码元偏移（一个中文或 emoji 可能占多个码元）。
  readonly character: number
}

/** A zero-based UTF-16 half-open range `[start, end)`. */
// 零基 UTF-16 半开区间 [start, end)：从 start 开始、到 end 之前（不含 end）的文本范围。
export interface LspRange {
  // 起始坐标。
  readonly start: LspPosition
  // 结束坐标（不含）。
  readonly end: LspPosition
}

/**
 * A caller's normalized query. Every field is required: `workspaceRoot` is caller-supplied,
 * `languageId` comes from the provider registration (not here), and consumers own timeouts and
 * result limits — so no field needs implementation defaulting and there is no `resolve()` step.
 */
// 调用方的规范化查询：所有字段必填（workspaceRoot 由调用方提供、languageId 由提供者注册信息推导、超时与结果数量由消费方负责），因此无需实现层默认值、也没有 resolve() 解析步骤。
export interface LspQueryRequest {
  /** Which semantic query to run. */
  // 要执行的语义操作。
  readonly operation: LspOperation
  /** The source file to query (relative to `workspaceRoot` or absolute; the provider canonicalizes). */
  // 被查询的源文件路径（相对 workspaceRoot 或绝对路径，由提供者统一规范化）。
  readonly filePath: string
  /** The zero-based UTF-16 cursor position to query at. */
  // 查询位置的零基 UTF-16 光标坐标。
  readonly position: LspPosition
  /** The workspace root the provider resolves against and indexes; required, never defaulted. */
  // 提供者解析路径并建立索引所依据的工作区根目录；必填，永不默认。
  readonly workspaceRoot: string
}

/**
 * A request as a provider receives it: the caller's {@link LspQueryRequest} plus the `languageId`
 * the seam derived from the provider's extension mapping. The language id only synchronizes the
 * transient document; it does not participate in selection.
 */
// 提供者视角的请求：调用方请求 + 缝根据提供者扩展名映射推导出的 languageId；该语言 id 仅用于同步临时文档，不参与提供者选择。
export interface LspProviderQuery extends LspQueryRequest {
  /** The LSP language id for `filePath`, from this provider's extension mapping. */
  // filePath 对应的 LSP 语言 id，来自该提供者的扩展名映射。
  readonly languageId: string
}

/** One resolved location: a document URI and the range within it. */
// 一个已解析的目标位置：目标文档 URI + 目标文档内的范围。
export interface LspLocation {
  /** The target document URI (`file:` or otherwise), verbatim from the server. */
  // 目标文档 URI（file: 或其他协议），原样来自服务器。
  readonly uri: string
  /** The range within the target document. */
  // 目标文档中的范围。
  readonly range: LspRange
}

/** Normalized hover content, or `null` for no hover at the position. */
// 规范化后的悬停内容；位置处无悬停时为 null。
export interface LspHover {
  /** The normalized hover text (markdown or plaintext, provider-joined). */
  // 规范化后的悬停文本（markdown 或纯文本，由提供者拼接）。
  readonly contents: string
  /** The range the hover applies to, when the server supplied one. */
  // 服务器提供时，悬停内容所适用的范围。
  readonly range?: LspRange
}

/**
 * The closed result union. Navigation operations (`goToDefinition`, `findReferences`,
 * `goToImplementation`) normalize to `locations`; `hover` normalizes to content or `null`.
 * Consumers `switch` on `kind` to exhaustiveness so a new arm breaks compilation until handled.
 *
 * The `locations` variant carries `resolvedWorkspaceUri`: the provider's canonical `file:` URI for
 * the request's workspace root. A caller that relativizes location URIs MUST use this, not parse the
 * request's possibly symlinked process path with host-platform rules; the execution platform may
 * differ from the caller's.
 */
// 查询结果的封闭联合：导航类操作规范化为 locations；hover 规范化为内容或 null。消费方按 kind 做穷尽 switch，新增分支未处理即编译报错。
// locations 变体携带 resolvedWorkspaceUri（提供者对请求工作区根目录的规范化 file: URI）：调用方需要把位置 URI 相对化时必须用它，而不能按宿主平台规则解析请求中可能含符号链接的进程路径——执行平台可能不同于调用方所在平台。
export type LspQueryResult =
  | { readonly kind: 'locations'; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: 'hover'; readonly hover: LspHover | null }

/**
 * A language-server backend registered on `ctx.lsp`. Each provider owns a stable {@link
 * LspProviderId} and an extension-to-language-id map (lowercase, leading-dot keys).
 * `findReferences` always includes declarations — the provider enforces this internally; callers
 * get no flag.
 */
// 注册在 ctx.lsp 上的语言服务器后端：每个提供者拥有稳定 LspProviderId 与"小写前导点扩展名 → 语言 id"映射。findReferences 永远包含声明本身——由提供者内部保证，调用方无开关。
export interface LspProvider {
  /** Stable provider identity, reserved atomically with the extension mappings. */
  // 稳定的提供者身份，注册时与扩展名映射一起被原子保留。
  readonly id: LspProviderId
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  // 小写前导点扩展名 → LSP 语言 id（如 { '.ts': 'typescript' }）。
  readonly extensionToLanguage: Readonly<Record<string, string>>
  /**
   * Run one query. The seam has already selected this provider and derived `languageId`.
   * @param request - the resolved provider query (caller request + derived language id).
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the normalized, closed-union result.
   */
  // 执行一次查询：缝已选好提供者并推导出 languageId；request 为已解析的提供者查询（调用方请求 + 推导出的语言 id），signal 为可选取消信号（中止时提供者停止自身工作），返回规范化封闭联合结果。
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
}

/**
 * The LSP capability seam (`ctx.lsp`). Owns provider registration/selection and normalized query
 * execution; exposes exactly the four operations and no protocol escape hatch.
 */
// LSP 能力缝（ctx.lsp）：负责提供者注册/选择与规范化查询执行；恰好暴露四种操作，无协议逃生口。
export interface LspService {
  /**
   * Register a provider, atomically reserving its id and every normalized extension. Any conflict
   * or invalid input publishes nothing and throws `LspError`; the returned disposer releases all
   * reservations. Disposed with the calling fiber.
   * @param provider - the backend to register.
   * @returns a synchronous disposer releasing the id and all extension reservations.
   */
  // 注册提供者：原子保留其 id 与全部规范化扩展名；任何冲突或非法输入都不发布任何内容并抛 LspError；返回的同步释放函数释放全部保留，随调用方协程（fiber）销毁。
  registerProvider(provider: LspProvider): () => void
  /**
   * Select a provider by the file's extension and run one query. Selection is per-query and
   * order-independent; no match throws `LspError` `LSP_UNAVAILABLE`.
   * @param request - the normalized query.
   * @param signal - optional cancellation forwarded to the selected provider.
   * @returns the normalized, closed-union result.
   */
  // 按文件扩展名选择提供者并执行一次查询：选择逐查询进行、与注册顺序无关；无匹配时抛 LspError（LSP_UNAVAILABLE）。
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
}
