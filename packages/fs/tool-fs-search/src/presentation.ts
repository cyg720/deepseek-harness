/*
 * ================================ 文件注释 ================================
 * 【文件职责】grep/glob 的"结果时搜索卡片展示"：两个工具都落在 card: 'search'
 * 渲染意图上，按 shape 判别符分两种变体——grep 按文件分组投影匹配
 * （SearchMatchesResultView），glob 投影扁平路径表（SearchPathsResultView）。
 * 本模块拥有每个工具声明的"值 → presentationMeta"投影，以及每个工具 presentResult
 * 在重放时读回的防御性 meta → view 收窄。
 * 【技术维度】规范值从不跨线传输（只有模型侧渲染文本与本 JSON meta），所以 UI 要
 * 渲染的结构化形状必须放在 meta 里。每个投影消费与模型侧渲染相同的保留结果
 * （retainGrepMatches/retainGlobPaths），文本与卡片对"哪些结果活过了内联上限"永不
 * 分歧；capMetaBytes 是第二道独立上限（meta 会随会话日志持久化并在每个请求重发），
 * 从尾部丢弃组/路径直到序列化 meta 落在 maxMetaBytes 内并置 truncated。
 * 【产品维度】让 UI 在结果时看到与模型文本一致的搜索结果卡片（按文件分组可展开），
 * 且截断结果绝不被展示成完整结果。
 * 【逻辑维度】按出现顺序：RetainedPage（保留字段子集）→ SearchMeta（meta 载荷类型）
 * → MetaLineMatch/MetaFileMatches → groupMatchesByFile（按文件分组）→ metaBytes →
 * capMetaBytes（meta 字节上限）→ grepSearchMeta/globSearchMeta（投影入口）→
 * isSearchLineMatch/isSearchFileMatches（防御性收窄）→ searchViewFromMeta（meta → view）。
 * 【关键边界】零结果 meta（files: [] / paths: []）收窄为合法空卡片——这与
 * diffsFromMeta 拒绝空 diff 相反，因为零匹配 grep 是合法结果（UI 显示"无匹配"）；
 * 单个过大条目保留（不变量是"可丢处有界"，绝不做隐藏真实结果的空卡片）。
 * 【新手阅读建议】先看两个投影入口（grepSearchMeta/globSearchMeta），再看
 * capMetaBytes 的丢弃逻辑，最后看 searchViewFromMeta 的双分支收窄。
 * ==========================================================================
 */
/**
 * Result-time search-card presentation for `grep` and `glob`. Both tools land on
 * one `card: 'search'` render intent ({@link SearchResultView}) with two
 * `shape`-discriminated variants: `grep` projects its matches grouped by file
 * ({@link SearchMatchesResultView}), `glob` projects a flat path list
 * ({@link SearchPathsResultView}). This module owns the value→`presentationMeta`
 * projection each tool declares and the defensive `meta`→view narrowing each
 * tool's `presentResult` reads back on replay.
 *
 * The canonical value never crosses the wire — only the model-facing render text
 * and this JSON `meta` do — so the structured shape a UI renders MUST ride in
 * `meta`. Each projection consumes the SAME retained matches/paths the
 * model-facing render consumes ({@link module:@deepseek-ai/dsh-tool-fs-search/search-core}
 * `retainGrepMatches`/`retainGlobPaths`), so text and card agree about which
 * results survived the inline cap, and reports `total` (every result found) and
 * `truncated`, so a UI never presents a capped result as complete.
 *
 * A second, independent cap bounds the JSON `meta` itself: the retained matches
 * of a broad search (hundreds of long lines) can still serialize to hundreds of
 * kilobytes, and `meta` is persisted with the session log and re-sent on every
 * request. {@link capMetaBytes} drops trailing groups/paths until the serialized
 * `meta` fits `maxMetaBytes` and marks the result `truncated`; a deployment's
 * final output budget (`dsh-spill-policy`) only shrinks `content`, never `meta`,
 * so this projection owns keeping `meta` bounded.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/presentation
 */
/*
 * 模块总览：本模块是搜索结果的"卡片投影层"：把规范结果变成 meta 里的结构化形状
 * （重放安全），并在重放时把 meta 收窄回视图。文本与卡片共用同一份保留结果。
 */

import type {
  SearchFileMatches,
  SearchLineMatch,
  SearchResultView,
} from '@deepseek-ai/dsh-tools'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { GrepMatch } from './search-core.ts'

/**
 * The retention fields a meta projection reads: the retained page, whether the
 * complete result was capped, and the pre-cap total. Both a full
 * {@link RetainedItems} (from `retainGrepMatches`) and `glob`'s sampled page
 * satisfy this structural subset, so a projection consumes either without a fake
 * `kept`/`omitted`.
 */
/*
 * meta 投影要读的保留字段：保留页、是否截断、截断前总数。完整 RetainedItems
 * （retainGrepMatches 产物）与 glob 的采样页都满足这个结构子集，因此投影可消费
 * 任一种而不需要伪造 kept/omitted。
 */
type RetainedPage<T> = Pick<RetainedItems<T>, 'items' | 'truncated' | 'seen'>

/**
 * The `grep`/`glob` tools' private `tool/result` `meta` payload: the capped,
 * structured search result. Attached opaquely (as `JsonValue`) on the tool result
 * and persisted with the session log, so `presentResult` reproduces the search
 * card on replay. The `matches` shape carries the by-file groups; the `paths`
 * shape carries the flat list. Both carry the pre-cap `total` and the `truncated`
 * flag. The producing tool owns and narrows this opaque shape.
 *
 * The member shapes use object-literal `type` aliases rather than the
 * {@link SearchFileMatches}/{@link SearchLineMatch} interfaces because only a type
 * alias is assignable to the `JsonValue` index signature `presentationMeta`
 * returns; the two are structurally identical, so the projected value still reads
 * back as a {@link SearchResultView}.
 */
/*
 * grep/glob 工具私有的 tool/result meta 载荷：被上限约束的结构化搜索结果。以不透明
 * JsonValue 形式附在工具结果上并随会话日志持久化，presentResult 因此能在重放时
 * 复现搜索卡片。matches 形状携带按文件分组；paths 形状携带扁平表；都带截断前 total
 * 与 truncated 标记。生产工具拥有并收窄这个不透明形状。
 * 成员形状用对象字面量 type 别名而非 SearchFileMatches/SearchLineMatch 接口，因为
 * 只有类型别名可赋给 presentationMeta 返回的 JsonValue 索引签名；两者结构相同，
 * 投影值仍能读回为 SearchResultView。
 */
export type SearchMeta =
  | { shape: 'matches'; files: MetaFileMatches[]; truncated: boolean; total: number }
  | { shape: 'paths'; paths: string[]; truncated: boolean; total: number }

/** One matched line in {@link SearchMeta} (the JSON-assignable form of {@link SearchLineMatch}). */
/* SearchMeta 里的一行匹配（SearchLineMatch 的 JSON 可赋值形式）。 */
type MetaLineMatch = { lineNumber: number; line: string }

/** One file's grouped matches in {@link SearchMeta} (the JSON-assignable form of {@link SearchFileMatches}). */
/* SearchMeta 里一个文件的匹配组（SearchFileMatches 的 JSON 可赋值形式）。 */
type MetaFileMatches = { path: string; matches: MetaLineMatch[] }

/**
 * Group flat matches by file (first-seen order) into the structured by-file shape
 * a UI renders as expandable per-file groups. The grouping matches the
 * model-facing text grouping
 * ({@link module:@deepseek-ai/dsh-tool-fs-search/grep} `formatGrepMatches`), so
 * card and text agree about file order and membership.
 *
 * @param matches - the retained matches to group, in output order.
 * @returns one entry per file, in first-seen order.
 */
/*
 * 把扁平匹配按文件分组（首见顺序）成结构化"按文件"形状，UI 渲染成可展开的逐文件组。
 * 分组与模型侧文本分组（grep 的 formatGrepMatches）一致，卡片与文本在文件顺序与
 * 成员上一致。
 * @param matches 要分组的保留匹配（输出顺序）。
 * @returns 每个文件一条，按首见顺序。
 */
export function groupMatchesByFile(matches: GrepMatch[]): MetaFileMatches[] {
  const byFile = new Map<string, MetaLineMatch[]>()
  for (const match of matches) {
    const entry: MetaLineMatch = { lineNumber: match.lineNumber, line: match.line }
    const group = byFile.get(match.path)
    if (group !== undefined) group.push(entry)
    else byFile.set(match.path, [entry])
  }
  return Array.from(byFile, ([path, fileMatches]) => ({ path, matches: fileMatches }))
}

/** The serialized UTF-8 byte size of one meta payload (the size persisted and re-sent). */
/* 一个 meta 载荷序列化后的 UTF-8 字节大小（被持久化并重发的尺寸）。 */
function metaBytes(meta: SearchMeta): number {
  return Buffer.byteLength(JSON.stringify(meta), 'utf8')
}

/**
 * Drop trailing top-level items (file groups or paths) until the serialized meta
 * fits `maxMetaBytes`, marking the result `truncated` when anything was dropped.
 * `total` is preserved (it counts what the search found, not what meta retains).
 * A single item too large to fit on its own is kept: the invariant is a bounded
 * payload wherever droppable, never an empty card that hides a real result.
 *
 * @param meta - the projected meta, already capped to the inline item count.
 * @param maxMetaBytes - the serialized-meta byte budget.
 * @returns the same meta when it fits, else a byte-bounded copy marked `truncated`.
 */
/*
 * 从尾部丢弃顶级条目（文件组或路径），直到序列化 meta 落在 maxMetaBytes 内；
 * 丢弃过任何东西就置 truncated。total 被保留（它数的是搜索找到的数量，不是 meta
 * 保留的数量）。单个过大条目仍保留：不变量是"可丢处有界"，绝不做隐藏真实结果的
 * 空卡片。
 * @param meta 已投影的 meta（内联条目数已封顶）。
 * @param maxMetaBytes 序列化 meta 的字节预算。
 * @returns 放得下时返回原 meta；否则返回标记 truncated 的字节有界副本。
 */
function capMetaBytes(meta: SearchMeta, maxMetaBytes: number): SearchMeta {
  if (metaBytes(meta) <= maxMetaBytes) return meta
  if (meta.shape === 'matches') {
    const files = [...meta.files]
    while (files.length > 1 && metaBytes({ ...meta, files, truncated: true }) > maxMetaBytes) files.pop()
    return { ...meta, files, truncated: true }
  }
  const paths = [...meta.paths]
  while (paths.length > 1 && metaBytes({ ...meta, paths, truncated: true }) > maxMetaBytes) paths.pop()
  return { ...meta, paths, truncated: true }
}

/**
 * Project the retained `grep` matches into {@link SearchMeta} for the search
 * card. Consumes the same {@link RetainedItems} the model-facing render consumes
 * (preview budget and inline match cap already applied), groups the retained
 * matches by file, reports `total` (every parsed match) and `truncated`, then
 * bounds the serialized meta to `maxMetaBytes`.
 *
 * @param retained - the retention outcome over every parsed match (previewed, capped).
 * @param maxMetaBytes - the serialized-meta byte budget.
 * @returns the `matches`-shaped search metadata.
 */
/*
 * 把保留的 grep 匹配投影成搜索卡片的 SearchMeta。消费与模型侧渲染相同的
 * RetainedItems（预览预算与内联匹配上限已应用），按文件分组，报告 total（每个
 * 解析出的匹配）与 truncated，再把序列化 meta 约束到 maxMetaBytes。
 * @param retained 覆盖每个解析匹配的保留结果（已预览、已封顶）。
 * @param maxMetaBytes 序列化 meta 的字节预算。
 * @returns matches 形状的搜索元数据。
 */
export function grepSearchMeta(retained: RetainedPage<GrepMatch>, maxMetaBytes: number): SearchMeta {
  const meta: SearchMeta = {
    shape: 'matches',
    files: groupMatchesByFile(retained.items),
    truncated: retained.truncated,
    total: retained.seen,
  }
  return capMetaBytes(meta, maxMetaBytes)
}

/**
 * Project the retained `glob` paths into {@link SearchMeta} for the search card.
 * Consumes the same {@link RetainedItems} the model-facing render consumes (inline
 * path cap already applied), reports `total` (every discovered path) and
 * `truncated`, then bounds the serialized meta to `maxMetaBytes`.
 *
 * @param retained - the retention outcome over every discovered path (capped).
 * @param maxMetaBytes - the serialized-meta byte budget.
 * @returns the `paths`-shaped search metadata.
 */
/*
 * 把保留的 glob 路径投影成搜索卡片的 SearchMeta。消费与模型侧渲染相同的
 * RetainedItems（内联路径上限已应用），报告 total（每个发现的路径）与 truncated，
 * 再把序列化 meta 约束到 maxMetaBytes。
 * @param retained 覆盖每个发现路径的保留结果（已封顶）。
 * @param maxMetaBytes 序列化 meta 的字节预算。
 * @returns paths 形状的搜索元数据。
 */
export function globSearchMeta(retained: RetainedPage<string>, maxMetaBytes: number): SearchMeta {
  const meta: SearchMeta = {
    shape: 'paths',
    paths: retained.items,
    truncated: retained.truncated,
    total: retained.seen,
  }
  return capMetaBytes(meta, maxMetaBytes)
}

/** Whether `value` is a valid {@link SearchLineMatch} (defensive narrowing from opaque `meta`). */
/* value 是否为合法的 SearchLineMatch（从不透明 meta 做的防御性收窄）。 */
function isSearchLineMatch(value: unknown): value is SearchLineMatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { lineNumber, line } = value as Record<string, unknown>
  return typeof lineNumber === 'number' && typeof line === 'string'
}

/** Whether `value` is a valid {@link SearchFileMatches} (defensive narrowing from opaque `meta`). */
/* value 是否为合法的 SearchFileMatches（从不透明 meta 做的防御性收窄）。 */
function isSearchFileMatches(value: unknown): value is SearchFileMatches {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, matches } = value as Record<string, unknown>
  return typeof path === 'string' && Array.isArray(matches) && matches.every(isSearchLineMatch)
}

/**
 * Narrow opaque live or replayed result metadata to a {@link SearchResultView}.
 * Malformed metadata returns `undefined` so `presentResult` can fall back to the
 * generic card instead of throwing during replay of an older or hand-edited log.
 * The view carries no result text: a UI without a search card falls back to the
 * raw `tool/result` content.
 *
 * A zero-result meta (`files: []` / `paths: []`) narrows to a valid empty card —
 * unlike the mirrored `diffsFromMeta`, which rejects empty diffs, because a
 * zero-match grep is a legitimate result a UI shows as "no matches", not an
 * absent projection.
 *
 * @param meta - result metadata (the {@link SearchMeta} the tool projected).
 * @returns the search view, or `undefined` for absent or malformed metadata.
 */
/*
 * 把不透明的实时/重放结果 meta 收窄成 SearchResultView。畸形 meta 返回 undefined，
 * 让 presentResult 在重放旧日志或手工编辑日志时回退到通用卡片而不是抛错。
 * 视图不携带结果文本：没有搜索卡片能力的 UI 回退到原始 tool/result 内容。
 * 零结果 meta（files: [] / paths: []）收窄为合法空卡片——与镜像的 diffsFromMeta
 * （拒绝空 diff）不同，因为零匹配 grep 是合法结果（UI 显示"无匹配"），不是投影缺失。
 * @param meta 结果元数据（工具投影的 SearchMeta）。
 * @returns 搜索视图；缺失或畸形元数据时为 undefined。
 */
export function searchViewFromMeta(meta: unknown): SearchResultView | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const record = meta as Record<string, unknown>
  const { truncated, total } = record
  if (typeof truncated !== 'boolean' || typeof total !== 'number') return undefined
  if (record.shape === 'matches') {
    const { files } = record
    if (!Array.isArray(files) || !files.every(isSearchFileMatches)) return undefined
    return { card: 'search', shape: 'matches', files: files, truncated, total }
  }
  if (record.shape === 'paths') {
    const { paths } = record
    if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string')) return undefined
    return { card: 'search', shape: 'paths', paths, truncated, total }
  }
  return undefined
}
