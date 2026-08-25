/*
 * ================================ 文件注释 ================================
 * 【文件职责】lsp 工具的纯格式化与坐标转换层：一基↔零基 UTF-16 光标换算、按文件分组的定位结果渲染（file: URI 解析）、完整结果封顶与 UI 呈现。无 I/O——UI 既可在流式输出时也可在回放时调用呈现器，因此只依赖工具参数。
 * 【技术维度】node:path 的 posix/win32 双平台相对化；fileURLToPath 解码 file: URI；纯函数设计便于测试精确锁定行为；呈现器输出与 dsh-tools 的 GenericCallView 对齐。
 * 【产品维度】把缝返回的零基位置转成模型可读的"路径:行:字符"列表，按工作区相对化、超限省略、整体封顶，避免大结果淹没模型上下文。
 * 【逻辑维度】常量（操作表、默认封顶值）→ 输入与参数类型 → parseLspArgs（校验与一基→零基转换）→
 *   辅助校验（isOperation/oneBased）→ formatLocations（分组渲染 + 省略标记 + 封顶）→ formatHover →
 *   boundResult（统一封顶）→ renderUri/filePath（URI 解析）→ presentLspCall（UI 卡片）。
 * 【关键边界】一基↔零基只在此层转换；file: URI 按"执行世界"而非宿主平台解析（Windows 盘符启发式）；非 file: URI 原样保留；渲染不读取文件、不依赖会话状态。
 * 【新手阅读建议】先读 parseLspArgs 理解坐标约定，再读 formatLocations 与 renderUri 理解结果呈现与路径解析。
 * ==========================================================================
 */
/**
 * Pure formatting and coordinate conversion for the `lsp` tool: one-based↔zero-based UTF-16 cursor
 * conversion, workspace-grouped location rendering with `file:`-URI resolution, complete-result
 * capping, and UI presentation. No I/O — a UI may call the presenter on live streaming and on
 * replay, so it depends only on the tool arguments.
 * @module @deepseek-ai/dsh-tool-lsp/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { LspHover, LspLocation, LspOperation, LspPosition } from '@deepseek-ai/dsh-lsp'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The four operations the tool exposes, as a runtime tuple for schema enum + validation. */
// 工具暴露的四种操作：运行时元组，供 schema 枚举与校验使用。
export const LSP_OPERATIONS: readonly LspOperation[] = ['goToDefinition', 'findReferences', 'goToImplementation', 'hover']

/** Default cap on rendered locations before an omission marker is appended. */
// 渲染位置数的默认上限：超出部分以省略标记替代。
export const DEFAULT_MAX_LOCATIONS = 100

/** Default cap on the complete rendered tool result, including truncation metadata. */
// 完整渲染结果的默认字符上限（含截断元信息）。
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** Validated `lsp` arguments after coordinate checks. */
// 坐标校验后的 lsp 参数（零基位置）。
export interface LspToolInput {
  // 语义操作。
  readonly operation: LspOperation
  // 被查询的源文件路径。
  readonly filePath: string
  /** Zero-based UTF-16 position converted from the one-based model coordinates. */
  // 由模型一基坐标转换而来的零基 UTF-16 位置。
  readonly position: LspPosition
}

/** The raw, schema-typed argument shape. */
// schema 校验前的原始参数形状。
export interface LspToolArgs {
  // 语义操作（字符串形式）。
  readonly operation: string
  // 源文件路径（下划线命名，与模型参数对齐）。
  readonly file_path: string
  // 一基行号。
  readonly line: number
  // 一基字符列。
  readonly character: number
}

/**
 * Validate and convert model arguments: `operation` must be one of the four; `line`/`character` are
 * positive one-based integers converted to the seam's zero-based position.
 * @param args - the schema-validated raw arguments.
 * @returns the validated input with a zero-based position.
 * @throws Error when the operation is unknown or a coordinate is not a positive integer.
 */
// 校验并转换模型参数：operation 必须是四种之一；line/character 必须是正整数（一基），并转换为缝的零基位置。
export function parseLspArgs(args: LspToolArgs): LspToolInput {
  if (!isOperation(args.operation)) {
    throw new Error(`operation must be one of ${LSP_OPERATIONS.join(', ')}`)
  }
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const line = oneBased(args.line, 'line')
  const character = oneBased(args.character, 'character')
  return {
    operation: args.operation,
    filePath: args.file_path,
    // The model counts from 1; the seam (and protocol) count from 0.
    // 模型从 1 计数，缝（与协议）从 0 计数，这里减一完成转换。
    position: { line: line - 1, character: character - 1 },
  }
}

/** Whether a string is one of the four operations. */
// 字符串是否为四种操作之一（类型收窄守卫）。
function isOperation(value: string): value is LspOperation {
  return (LSP_OPERATIONS as readonly string[]).includes(value)
}

/** Validate a one-based coordinate is a positive integer. */
// 校验一基坐标是正整数；非法时抛错。
function oneBased(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (one-based)`)
  }
  return value
}

/**
 * Render a locations result grouped by file, converting each zero-based location back to a one-based
 * `path:line:character` entry. A `file:` URI inside the workspace becomes a workspace-relative path;
 * outside it, a URI-derived absolute path; a non-`file:` URI is kept verbatim. Applies `maxLocations` and
 * appends an omission marker when it truncates by count, then applies the complete result cap.
 * @param locations - the seam's locations (possibly empty).
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @param maxLocations - the cap before truncation.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text; a distinct no-result line when there are none.
 */
// 按文件分组渲染定位结果：每个零基位置转回一基的"路径:行:字符"条目；工作区内的 file: URI 显示为
// 相对路径，区外显示为 URI 推导的绝对路径，非 file: URI 原样保留；先按 maxLocations 截断并加省略
// 标记，再按 maxResultChars 封顶。
export function formatLocations(
  locations: readonly LspLocation[],
  workspaceUri: string,
  maxLocations: number,
  maxResultChars: number,
): string {
  // 空结果输出专门的无结果行。
  if (locations.length === 0) return boundResult('No results.', maxResultChars, 'locations')
  // 截断到上限并统计被省略的数量。
  const shown = locations.slice(0, maxLocations)
  const omitted = locations.length - shown.length
  // 按显示路径分组收集条目。
  const grouped = new Map<string, string[]>()
  for (const location of shown) {
    const path = renderUri(location.uri, workspaceUri)
    // 零基转一基（加一）。
    const line = location.range.start.line + 1
    const character = location.range.start.character + 1
    const entries = grouped.get(path) ?? []
    entries.push(`${path}:${line}:${character}`)
    grouped.set(path, entries)
  }
  const lines: string[] = []
  for (const entries of grouped.values()) lines.push(...entries)
  // 被省略的数量大于零时追加省略标记。
  if (omitted > 0) {
    lines.push(`… ${omitted} more location${omitted === 1 ? '' : 's'} omitted (limit ${maxLocations}).`)
  }
  return boundResult(lines.join('\n'), maxResultChars, 'locations')
}

/**
 * Render a hover result, applying `maxResultChars` last and keeping its marker within the cap.
 * @param hover - the normalized hover, or `null` for no hover.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered hover text; a distinct no-result line for `null`.
 */
// 渲染悬停结果：null 输出专门的无结果行；最后应用字符封顶并让截断标记也落在上限内。
export function formatHover(hover: LspHover | null, maxResultChars: number): string {
  const text = hover === null ? 'No hover information.' : hover.contents
  return boundResult(text, maxResultChars, 'hover')
}

/** Bound a complete rendered result, including the truncation notice itself. */
// 对完整渲染结果封顶：超限时在末尾追加截断提示，提示本身也计入上限。
function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/**
 * Resolve a location URI without applying the harness host's path rules. A valid `file:` URI becomes
 * workspace-relative when it is under the provider's canonical workspace URI, or a URI-derived
 * absolute path otherwise; malformed and non-`file:` URIs remain verbatim.
 * @param uri - the target URI from the seam.
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @returns the display path or the verbatim URI.
 */
// 解析位置 URI（不套用宿主平台的路径规则）：工作区内的合法 file: URI 相对化显示，区外的转为 URI 推导的绝对路径；畸形与非 file: URI 原样返回。
export function renderUri(uri: string, workspaceUri: string): string {
  if (!uri.startsWith('file:')) return uri
  let target: URL
  let workspace: URL
  try {
    target = new URL(uri)
    workspace = new URL(workspaceUri)
  } catch {
    // URI 解析失败：原样返回。
    return uri
  }
  if (workspace.protocol !== 'file:') return uri
  // A `file:` URI does not carry its world's OS, so a leading `/X:` segment is
  // read as a Windows drive. A POSIX workspace literally rooted at `/c:/...`
  // would mis-render (display only; edits and reads use the exact URI).
  // file: URI 不携带其世界的操作系统信息，因此前导 /X: 段会被当作 Windows 盘符；POSIX 工作区字面根于 /c:/... 时可能误渲染（仅影响显示，编辑与读取仍用精确 URI）。
  const drivePath = /^\/[a-z](?::|%3A)/iu
  const windowsWorld = workspace.hostname.length > 0 || drivePath.test(workspace.pathname)
  const targetWindowsWorld = windowsWorld && (target.hostname.length > 0 || drivePath.test(target.pathname))
  const workspacePath = filePath(workspace, windowsWorld)
  const targetPath = filePath(target, targetWindowsWorld)
  if (workspacePath === undefined || targetPath === undefined) return uri
  // 双方世界不同（如 Windows 盘符世界对 POSIX 世界）：直接返回目标绝对路径。
  if (windowsWorld !== targetWindowsWorld) return targetPath
  const path = windowsWorld ? win32 : posix
  const relative = path.relative(workspacePath, targetPath)
  // 工作区外（..、../ 开头或绝对路径）：显示绝对路径。
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  const rendered = relative === '' ? '.' : outside ? targetPath : relative
  return windowsWorld ? rendered.replaceAll('\\', '/') : rendered
}

/** Decode a file URL for its execution world while containing malformed URL failures. */
// 为"执行世界"解码 file URL，同时收容畸形 URL 失败。
function filePath(url: URL, windows: boolean): string | undefined {
  try {
    const path = fileURLToPath(url, { windows })
    // 含空字符的路径不可用，返回 undefined。
    return path.includes('\0') ? undefined : path
  } catch {
    // `fileURLToPath` rejects malformed escapes, authorities, and encoded path separators.
    // fileURLToPath 会拒绝畸形转义、authority 与编码过的路径分隔符，这里返回 undefined。
    return undefined
  }
}

/**
 * UI presentation for a pending `lsp` call. Uses a generic search card; the title carries the
 * operation and one-based cursor, and `locations` focuses the queried line. The shared location
 * shape has no character, so the title preserves the column.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
// lsp 调用进行中的 UI 呈现：通用搜索卡片；标题携带操作与一基光标；locations 聚焦查询行（共享位置形状没有字符列，因此标题保留列号）。
export function presentLspCall(args: LspToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP ${args.operation} ${args.file_path}:${args.line}:${args.character}`,
    locations: [{ path: args.file_path, line: args.line }],
  }
}
