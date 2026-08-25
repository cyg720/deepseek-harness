/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是面向模型的 web_search 工具：发现最新网络信息。执行经 ctx.web 完成，
 *             本模块只拥有面向模型的 schema、参数校验、结果条数上限与结果格式化。
 * 【技术维度】defineTool 定义工具；多查询并发执行并在结果合并时去重、轮转、截断；
 *             render 与 presentationMeta 双通道：渲染文本给模型，结构化 meta 供卡片展示。
 * 【产品维度】模型通过"问问题"的方式获取最新信息；返回上限由产品控制（searchMaxResults），
 *             而不是由模型或提供者决定，防止上下文被无界结果撑爆。
 * 【逻辑维度】默认常量 → 参数校验 → 格式化/展示辅助 → meta 投影与回读 → 并发执行与合并
 *             → applyWebSearchTool 注册工具与提示词。
 * 【关键边界】查询数受 maxQueries 限制、每词非空；多查询时任一失败会中止同伴并重抛首个
 *             错误；合并结果按 URL 去重、轮转填充、最后截断到 maxResults。
 * 【新手阅读建议】先读 parseSearchArgs 与 formatSearchOutput（纯函数），再读
 *             runSearchQueries / mergeSearchResults 看多查询合并，最后看注册逻辑。
 * ==========================================================================
 */
/**
 * The model-facing `web_search` tool: discover current information on the web.
 * Execution goes through `ctx.web` — this module owns only the model-facing
 * schema, argument validation, the result-count bound, and result formatting,
 * never provider selection or network access.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, JsonValue, ToolResult, WebSearchResultView, WebSource } from '@deepseek-ai/dsh-tools'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-system-prompt'

/**
 * Default upper bound on returned sources (the `searchMaxResults` config).
 * Owned by the consumer (not the provider or model), mirroring `dsh-tool-fs`'s
 * `READ_LIMIT`. The model just asks a question; the product controls how much
 * context returns. The default `8` aligns with OpenCode's Exa default.
 */
// 返回来源条数的默认上限（即 searchMaxResults 配置）。归消费方（而非提供者或模型）所有，
// 与 dsh-tool-fs 的 READ_LIMIT 同思路：模型只提问，产品决定返回多少上下文。
// 默认 8 与 OpenCode 的 Exa 默认值一致。
export const WEB_SEARCH_MAX_RESULTS = 8

/** Default upper bound on concurrent searches in one tool call. */
// 单次工具调用中并发搜索数量的默认上限。
export const WEB_SEARCH_MAX_QUERIES = 4

/** Model-facing `web_search` arguments. */
// 面向模型的 web_search 参数。
interface WebSearchArgs {
  queries: string[]
}

/**
 * Validate value constraints the schema DSL can't express: `queries` is
 * non-empty, contains only non-blank strings, and fits the deployment's
 * query-count bound. Exact duplicate strings are collapsed after the bound
 * check. Throws a plain `Error` otherwise.
 *
 * @param args - the schema-validated `web_search` arguments.
 * @param maxQueries - the deployment's upper bound on queries in one call.
 * @returns the accepted queries in their first-occurrence order.
 */
// 校验 schema DSL 表达不了的值约束：queries 非空、只含非空字符串、不超部署的查询数上限；
// 在条数校验之后折叠完全相同的重复串。违反时抛普通 Error。
export function parseSearchArgs(
  args: WebSearchArgs,
  maxQueries: number,
): string[] {
  const queries = args.queries
  if (queries.length === 0) throw new Error('queries must contain at least one query')
  if (queries.length > maxQueries) {
    const noun = maxQueries === 1 ? 'query' : 'queries'
    throw new Error(`queries must contain at most ${maxQueries} ${noun}`)
  }
  if (queries.some(query => query.trim().length === 0)) throw new Error('each query must be a non-empty string')
  return [...new Set(queries)]
}

/** Display label for a source: its title, else its hostname. */
// 来源的显示标签：优先标题，缺省取 URL 的主机名。
function sourceLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title.length > 0) return title
  try {
    return new URL(url).hostname
  } catch {
    // A provider should return a valid URL, but never let a malformed one throw
    // out of pure formatting — fall back to the raw string.
    // 提供者应返回合法 URL，但纯格式化绝不能被畸形 URL 打挂——回退到原始字符串。
    return url
  }
}

/**
 * Format a search result as one model-facing text block.
 *
 * @param result - the seam's search outcome.
 * @returns the provider answer (when any), a markdown source list with snippet
 *   and date metadata (or `No results found.`), a refine-the-query note when
 *   truncated, and a standing cite-your-sources instruction.
 */
// 把搜索结果格式化为一段面向模型的文本：提供方回答（若有）、带摘要与日期的 Markdown
// 来源列表（或"无结果"提示）、截断时的"请精化查询"提示，以及固定的"引用来源"指令。
export function formatSearchOutput(result: WebSearchResult): string {
  const parts: string[] = []
  if (result.content !== undefined && result.content.length > 0) parts.push(result.content)

  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const label = sourceLabel(source.url, source.title)
      const meta: string[] = []
      if (source.snippet !== undefined && source.snippet.length > 0) meta.push(source.snippet)
      if (source.publishedAt !== undefined && source.publishedAt.length > 0) meta.push(`(${source.publishedAt})`)
      const suffix = meta.length > 0 ? ` — ${meta.join(' ')}` : ''
      return `- [${label}](${source.url})${suffix}`
    })
    parts.push(`Sources:\n${lines.join('\n')}`)
  } else if (result.content === undefined || result.content.length === 0) {
    parts.push('No results found.')
  }

  if (result.truncated) parts.push(`(Showing the first ${result.sources.length} sources. Refine the query for more.)`)
  parts.push('Cite the relevant URLs above as markdown links in your answer.')
  return parts.join('\n\n')
}

/**
 * Pending-call presentation: a search card titled by the query list.
 *
 * @param args - the raw tool arguments; only the query text feeds the view.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
// 调用进行中的展示：以查询列表为标题的搜索卡片。
export function presentSearchCall(args: WebSearchArgs): GenericCallView {
  const title = args.queries.join(', ')
  return { card: 'generic', title, kind: 'search', rawInput: title }
}

/**
 * The `web_search` tool's private `tool/result` `meta` payload: the structured
 * sources, the optional provider answer, and the truncation flag. Attached
 * opaquely (as `JsonValue`) on the tool result and persisted with the session
 * log, so `presentResult` reproduces the search card on replay. This projection
 * is the only faithful route to the per-source fields, which the lossy render
 * text cannot carry (the owning rationale is the web-result-card Agent Note).
 */
// web_search 工具私有的 tool/result meta 负载：结构化来源、可选的提供方回答、截断标记。
// 以不透明 JSON 形式挂在工具结果上并随会话日志持久化，使 presentResult 在回放时能还原
// 搜索卡片。这是拿到各来源字段的唯一可靠通道——有损的渲染文本承载不了这些字段
// （设计理由见 web-result-card Agent Note）。
export interface WebSearchMeta {
  /** The faithful structured sources, in result order. */
  // 忠实保真的结构化来源，按结果顺序排列。
  sources: WebSource[]
  /** True when the seam or multi-query merge cut the source list to honor the result cap. */
  // seam 或多查询合并为遵守结果上限而截断来源列表时为 true。
  truncated: boolean
  /** The provider-generated answer text, when any. */
  // 提供方生成的回答文本（若有）。
  answer?: string
}

/**
 * Project one seam source into a plain object that omits every absent optional
 * field. Shared by the canonical `execute` result and its replayable
 * presentation meta so both carry byte-identical source shapes.
 *
 * @param source - one source from the `ctx.web` search outcome.
 * @returns `{ url }` plus each present optional field.
 */
// 把一条 seam 来源投影为"省略一切缺失可选字段"的普通对象。规范的 execute 结果与可回放的
// 展示 meta 共用此函数，保证两者携带的源形状逐字节一致。
function projectSource(source: WebSearchSource): {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
} {
  return {
    url: source.url,
    ...source.title !== undefined ? { title: source.title } : {},
    ...source.snippet !== undefined ? { snippet: source.snippet } : {},
    ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
  }
}

/**
 * Project a validated `web_search` output value into its replayable
 * presentation meta ({@link WebSearchMeta} as opaque JSON).
 *
 * @param value - the canonical `web_search` output value (the seam's result shape).
 * @returns the structured sources, the truncation flag, and the answer when present.
 */
// 把校验过的 web_search 输出值投影为可回放的展示 meta（即不透明 JSON 化的 WebSearchMeta）。
export function searchMetaFromValue(value: WebSearchResult): JsonValue {
  return {
    sources: value.sources.map(projectSource),
    truncated: value.truncated,
    ...value.content !== undefined ? { answer: value.content } : {},
  }
}

/** Whether `value` is a valid {@link WebSource} (defensive narrowing from opaque `meta`). */
// value 是否为合法的 WebSource（从透明 meta 做防御性收窄）。
function isWebSource(value: unknown): value is WebSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { url, title, snippet, publishedAt } = value as Record<string, unknown>
  return typeof url === 'string'
    && (title === undefined || typeof title === 'string')
    && (snippet === undefined || typeof snippet === 'string')
    && (publishedAt === undefined || typeof publishedAt === 'string')
}

/**
 * Narrow opaque live or replayed result metadata to a {@link WebSearchMeta}.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic card instead of throwing during replay.
 *
 * @param meta - result metadata.
 * @returns the validated search meta, or `undefined` for absent or malformed data.
 */
// 把不透明的实时或回放结果元数据收窄为 WebSearchMeta。畸形元数据返回 undefined，
// 让展示层回退到通用卡片，而不是在回放中抛错。
export function searchMetaFromResult(meta: unknown): WebSearchMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { sources, truncated, answer } = meta as Record<string, unknown>
  if (!Array.isArray(sources) || !sources.every(isWebSource)) return undefined
  if (typeof truncated !== 'boolean') return undefined
  if (answer !== undefined && typeof answer !== 'string') return undefined
  return {
    sources,
    truncated,
    ...answer !== undefined ? { answer } : {},
  }
}

/**
 * Completed-call presentation: a `web` search card carrying the faithful
 * structured sources from `meta`. It sets no `content` copy — a UI without the
 * `web` capability falls back to the raw `tool/result` content, which is the
 * same text (see the web-result-card Agent Note).
 *
 * @param args - the raw tool arguments; the queries become the result-state
 *   title so a window-truncated replay that dropped the call head still has one.
 * @param result - the final model-facing tool result; `meta` carries the sources.
 * @returns the search result view, or `undefined` (generic card) on failure or
 *   malformed meta.
 */
// 调用完成后的展示：从 meta 取忠实结构化来源的 web 搜索卡片。不额外复制 content——
// 没有 web 能力的 UI 会回退到原始 tool/result 内容，而它们本就是同一段文本
// （见 web-result-card Agent Note）。
export function presentSearchResult(args: WebSearchArgs, result: ToolResult): WebSearchResultView | undefined {
  if (result.isError) return undefined
  const meta = searchMetaFromResult(result.meta)
  if (meta === undefined) return undefined
  return {
    card: 'web',
    kind: 'search',
    title: args.queries.join(', '),
    sources: meta.sources,
    truncated: meta.truncated,
    ...meta.answer !== undefined ? { answer: meta.answer } : {},
  }
}

/**
 * Run one or more searches through the web seam. A single query keeps the
 * provider's exact result; multiple queries run concurrently and are merged
 * into one normalized result capped at `maxResults`. A failed search aborts
 * its siblings, and this function waits for every search to settle before
 * rethrowing the first failure.
 *
 * @param ctx - context whose `web` service performs the searches.
 * @param queries - validated non-empty queries.
 * @param maxResults - the deployment's source cap for the combined result.
 * @param signal - cancellation signal forwarded to every search.
 * @returns the combined search result.
 */
// 通过 web seam 执行一次或多次搜索。单查询保持提供者的精确结果；多查询并发执行后合并为
// 一个截断到 maxResults 的归一化结果。任一搜索失败会中止其它同伴，并且本函数会等所有
// 搜索 settle 之后再重抛第一个失败。
async function runSearchQueries(
  ctx: Context,
  queries: string[],
  maxResults: number,
  signal: AbortSignal,
): Promise<WebSearchResult> {
  if (queries.length === 1) {
    return ctx.web.search({ query: queries[0] as string, maxResults }, signal)
  }
  const controller = new AbortController()
  const batchSignal = AbortSignal.any([signal, controller.signal])
  let firstFailure: { error: unknown } | undefined
  const results: WebSearchResult[] = []
  const searches = queries.map(async (query, index) => {
    try {
      results[index] = await ctx.web.search({ query, maxResults }, batchSignal)
    } catch (error) {
      if (firstFailure === undefined) firstFailure = { error }
      controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(searches)
  if (firstFailure !== undefined) throw firstFailure.error
  return mergeSearchResults(queries, results, maxResults)
}

/** Merge per-query results into one deduplicated, round-robin, capped result. */
// 把各查询结果合并为一份：按 URL 去重、轮转填充、最后截断到上限。
function mergeSearchResults(
  queries: string[],
  results: WebSearchResult[],
  maxResults: number,
): WebSearchResult {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  let sourceRanks = 0
  for (const result of results) {
    sourceRanks = Math.max(sourceRanks, result.sources.length)
  }
  let droppedSource = false
  merge: for (let rank = 0; rank < sourceRanks; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source !== undefined && !seen.has(source.url)) {
        seen.add(source.url)
        if (sources.length === maxResults) {
          droppedSource = true
          break merge
        }
        sources.push(source)
      }
    }
  }
  const contents = results.flatMap((result, index) => {
    if (result.content === undefined || result.content.length === 0) return []
    return [`### ${queries[index]}\n\n${result.content}`]
  })
  return {
    ...contents.length > 0 ? { content: contents.join('\n\n') } : {},
    sources,
    truncated: results.some(result => result.truncated) || droppedSource,
  }
}

/**
 * Register the `web_search` tool and its system-prompt guidance.
 *
 * @param ctx - context whose `tools` and `systemPrompt` registries receive the
 *   registrations; both are effect-scoped and unregister on plugin dispose.
 * @param maxResults - the deployment's source cap, sent as every seam
 *   request's `maxResults`.
 * @param maxQueries - the deployment's query cap enforced before provider calls.
 * @param timeoutMs - the cooperative tool-call budget (ms) attached as the tool's
 *   `ToolDefinition.timeoutMs` for `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce.
 * @param fetchEnabled - whether the same composition exposes `web_fetch`, which
 *   controls whether search guidance may recommend that follow-up tool.
 */
// 注册 web_search 工具及其系统提示词指引。maxResults/maxQueries 是部署级上限；
// timeoutMs 以 ToolDefinition.timeoutMs 形式交给超时策略插件；fetchEnabled 决定搜索提示
// 词是否建议使用 web_fetch 作为后续工具。
export function applyWebSearchTool(
  ctx: Context,
  maxResults: number,
  maxQueries: number,
  timeoutMs: number,
  fetchEnabled: boolean,
): void {
  ctx.systemPrompt.section({
    name: 'tool:web_search',
    order: 110,
    text: fetchEnabled
      ? `Use the web_search tool to discover current information on the web. The required queries array accepts 1–${maxQueries} non-empty search queries; use a one-item array for a single search. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.`
      : `Use the web_search tool to discover current information on the web. The required queries array accepts 1–${maxQueries} non-empty search queries; use a one-item array for a single search. It returns an optional answer plus a list of source URLs. Use the returned source snippets when available, and cite the relevant URLs as markdown links.`,
  })

  ctx.tools.register(defineTool({
    name: 'web_search',
    description: `Search the web for current information. Provide 1–${maxQueries} queries in the required queries array. Returns an optional summary answer and a list of source URLs.`,
    parameters: {
      queries: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: `Required search queries; accepts 1–${maxQueries} items and merges their results.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string', required: true },
                title: { type: 'string' },
                snippet: { type: 'string' },
                publishedAt: { type: 'string' },
              },
            },
          },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatSearchOutput(value) }],
      presentationMeta: (_args, value) => searchMetaFromValue(value),
    },
    timeoutMs,
    // Provider reads do not mutate parent-agent state.
    // 提供方只读，不会改动父代理的状态，因此可并发执行。
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const queries = parseSearchArgs(args, maxQueries)
      const result = await runSearchQueries(ctx, queries, maxResults, exec.signal)
      return {
        ...result.content !== undefined ? { content: result.content } : {},
        sources: result.sources.map(projectSource),
        truncated: result.truncated,
      }
    },
    presentCall: presentSearchCall,
    presentResult: (args, result) => presentSearchResult(args, result),
  }))
}
