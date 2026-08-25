/*
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 grep 工具：用 ripgrep 正则表达式搜索文件内容。执行时通过
 * 子进程接缝、用普通 argv 向量直接启动打包的 ripgrep 二进制（@vscode/ripgrep），
 * 命令固定为面向行的 rg --json，使文件路径、行号与行文本无需冒号切分歧义即可解析；
 * 本模块拥有模型侧 schema、参数校验、argv 构造、--json 记录解析、每行预览保留、
 * 匹配保留、分组与格式化；进程关注点留在 ctx.subprocess。
 * 【技术维度】buildGrepCommand 生成固定 rg --json argv（--regexp=pattern 与
 * --glob=include 用 --flag=value 形式、目标跟在 -- 后）；parseRecord 消费 NDJSON
 * 行（只取 type === 'match' 的记录，begin/end/context/summary 是传输框架直接跳过）；
 * 每行匹配经 previewLine 预览、retainGrepMatches 统一封顶；展示与卡片共用同一份
 * 保留结果；超限完整结果经 trySaveFormattedResult 存成 spill 文件。
 * 【产品维度】让模型按正则搜索文件内容（替代 shell grep/rg）：带行号、按文件分组、
 * 内联有界、完整匹配表可 spill 恢复；行预览截断保留 UTF-8 边界。
 * 【逻辑维度】按出现顺序：GREP_MAX_MATCHES/GREP_MAX_LINE_BYTES（默认常量）→
 * GrepToolCaps/GrepInput（类型）→ validateInclude/parseGrepArgs（校验）→
 * buildGrepCommand（argv）→ malformedRecord/parseRecord/parseGrepMatches（解析）→
 * matchNoun/formatGrepMatches/formatGrepOutput/formatRetainedGrep（展示）→
 * presentGrepCall/presentGrepResult（卡片）→ applyGrepTool（注册）。
 * 【关键边界】include 必须是"一个正向 glob 过滤器"：空白、取反（!…）与逗号列表
 * 都被拒绝（大括号里的逗号合法，*.{ts,tsx} 是一个带交替的 glob）；非 UTF-8 行用
 * 占位预览而非失败整次搜索；畸形 --json 统一报 SEARCH_FAILED（内部传输，宁可失败
 * 不给部分结果）。
 * 【新手阅读建议】先看 parseRecord 理解 --json 记录如何解析，再看
 * retainGrepMatches 的保留与 formatGrepOutput 的脚注，最后看 applyGrepTool 的
 * 超限 spill 交接。
 * ==========================================================================
 */
/**
 * The model-facing `grep` tool: search file contents with a ripgrep regular
 * expression. Execution spawns the packaged ripgrep binary
 * (`@vscode/ripgrep`) directly through the subprocess seam with a plain argv
 * vector using a fixed line-oriented `rg --json` command so file path, line
 * number, and line text parse without colon-splitting ambiguity — this module
 * owns the model-facing schema, argument validation, argv construction,
 * `--json` record parsing, per-line preview retention, match retention,
 * grouping, and formatting; process concerns stay behind `ctx.subprocess`.
 *
 * @module @deepseek-ai/dsh-tool-fs-search/grep
 */
/*
 * 模块总览：本文件是 grep 工具的定义与执行体。--json 记录解析与结果格式化在这里，
 * spawn/终止/捕获在 search-core.ts 与 ctx.subprocess。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, SearchResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { SpillRef } from '@deepseek-ai/dsh-spill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { GrepMatch } from './search-core.ts'
import { SearchError, previewLine, retainGrepMatches, runRipgrep, toWorkdirRelative, trySaveFormattedResult } from './search-core.ts'
import { grepSearchMeta, searchViewFromMeta } from './presentation.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

/**
 * Default cap on flat matches retained inline by one `grep` call (the
 * `grepMaxMatches` config), matching Claude Code's default `GrepTool`
 * `head_limit`.
 */
/*
 * 单次 grep 调用内联保留扁平匹配数的默认上限（grepMaxMatches 配置的默认值）：
 * 250，与 Claude Code 默认 GrepTool 的 head_limit 一致。
 */
export const GREP_MAX_MATCHES = 250

/**
 * Default cap in bytes on one matched-line preview (the `grepMaxLineBytes`
 * config); the cut preserves UTF-8 boundaries.
 */
/*
 * 单条匹配行预览的默认字节上限（grepMaxLineBytes 配置的默认值）：2000；
 * 截断保留 UTF-8 边界。
 */
export const GREP_MAX_LINE_BYTES = 2000

/** Resolved grep-tool caps — plugin config after defaulting (see `Config` in index.ts). */
/* 已解析的 grep 工具上限——默认化后的插件配置（见 index.ts 的 Config）。 */
export interface GrepToolCaps {
  /** Max flat matches retained inline; later matches go to the formatted spill file. */
  /* 内联保留的最大扁平匹配数；后面的匹配进格式化 spill 文件。 */
  maxMatches: number
  /** Max bytes retained per matched-line preview. */
  /* 每条匹配行预览保留的最大字节数。 */
  maxLineBytes: number
  /** Max bytes of serialized `presentationMeta`; trailing file groups drop past it. */
  /* 序列化 presentationMeta 的最大字节数；超出后尾部文件组被丢弃。 */
  maxMetaBytes: number
  /** Cap on the complete raw `rg` stdout the tool will parse. */
  /* 工具将解析的完整原始 rg stdout 上限。 */
  rawOutputMaxBytes: number
  /** Terminate-escalation grace period (ms) for the search process. */
  /* 搜索进程的终止升级宽限期（毫秒）。 */
  graceMs: number
  /** Cap on the retained stderr diagnostic tail. */
  /* 保留 stderr 诊断尾部的上限。 */
  stderrMaxBytes: number
  /** Cooperative tool-call budget (ms) attached as `ToolDefinition.timeoutMs`. */
  /* 协作式工具调用预算（毫秒），作为 ToolDefinition.timeoutMs 附加。 */
  timeoutMs: number
}

/** Validated `grep` arguments. */
/* 已校验的 grep 参数。 */
export interface GrepInput {
  pattern: string
  path?: string
  include?: string
}

/**
 * Reject an `include` that is not ONE positive glob filter: blank strings,
 * negated patterns (`!…`), and comma-separated lists. A comma inside a brace
 * group is fine — `*.{ts,tsx}` is one glob with alternation, not a list.
 */
/*
 * 拒绝不是"一个正向 glob 过滤器"的 include：空白字符串、取反模式（!…）、逗号分隔
 * 列表。大括号组里的逗号合法——*.{ts,tsx} 是带交替的一个 glob，不是列表。
 */
function validateInclude(include: string): void {
  if (include.trim().length === 0) throw new Error('include must be a non-empty glob when given')
  if (include.startsWith('!')) throw new Error('include must be a positive glob filter; negated patterns ("!…") are not supported')
  let braceDepth = 0
  for (const char of include) {
    if (char === '{') braceDepth++
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (char === ',' && braceDepth === 0) {
      throw new Error('include must be one glob, not a comma-separated list (use {a,b} alternation instead)')
    }
  }
}

/**
 * Validate value constraints the schema DSL can't express: a non-EMPTY
 * `pattern` (whitespace is a legitimate regex), a non-blank `path` when given,
 * and a single positive `include` glob ({@link GrepInput}). Throws a plain
 * `Error` (an ordinary tool argument error) otherwise.
 *
 * @param args - the schema-validated `grep` arguments.
 * @returns the accepted input, unchanged.
 */
/*
 * 校验 schema DSL 表达不了的值约束：pattern 非空（空白是合法正则）、给出时 path
 * 非空白、include 是单个正向 glob。否则抛普通 Error（常规工具参数错误）。
 * @param args 已通过 schema 校验的 grep 参数。
 * @returns 被接受的输入，原样返回。
 */
export function parseGrepArgs(args: { pattern: string; path?: string; include?: string }): GrepInput {
  if (args.pattern.length === 0) throw new Error('pattern must be a non-empty string')
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  if (args.include !== undefined) validateInclude(args.include)
  return {
    pattern: args.pattern,
    ...args.path !== undefined ? { path: args.path } : {},
    ...args.include !== undefined ? { include: args.include } : {},
  }
}

/**
 * Build the fixed line-oriented `rg --json` argv for one `grep` call. Every
 * model-controlled value ({@link GrepInput.pattern}, {@link GrepInput.path},
 * {@link GrepInput.include}) is a plain argv element — no shell layer exists,
 * so no quoting applies; the pattern and include ride in `--flag=value` form
 * and the target behind `--`, so a leading-dash value can never be parsed as
 * a flag.
 *
 * @param input - the validated arguments.
 * @returns the complete ripgrep argument vector (excluding the binary itself).
 */
/*
 * 为一次 grep 调用构造固定的面向行 rg --json argv。每个模型控制值（pattern、path、
 * include）都是普通 argv 元素——没有 shell 层，所以不存在引号问题；pattern 与
 * include 用 --flag=value 形式、目标跟在 -- 后，前导横线值绝不会被解析成旗标。
 * @param input 已校验的参数。
 * @returns 完整 ripgrep 参数向量（不含二进制本身）。
 */
export function buildGrepCommand(input: GrepInput): string[] {
  const parts = ['--json', `--regexp=${input.pattern}`]
  if (input.include !== undefined) parts.push(`--glob=${input.include}`)
  if (input.path !== undefined) parts.push('--', input.path)
  return parts
}

/**
 * The uniform malformed-output failure: raw `rg --json` is an internal
 * transport, so missing or invalid response fields cause a search failure, not a partial result.
 */
/*
 * 统一的畸形输出失败：原始 rg --json 是内部传输，所以缺失或无效的响应字段导致搜索
 * 失败，而不是给出部分结果。
 */
function malformedRecord(detail: string, cause?: unknown): SearchError {
  return new SearchError(`grep received malformed ripgrep --json output (${detail})`, 'SEARCH_FAILED', cause !== undefined ? { cause } : undefined)
}

/**
 * Parse one `rg --json` NDJSON line into a match, `undefined` for the
 * non-match record types (`begin`/`end`/`context`/`summary`). A line that is
 * not JSON, or a `match` record missing its path / line number / line content,
 * throws {@link SearchError} `SEARCH_FAILED`. A match whose line is not valid
 * UTF-8 (ripgrep sends base64 `bytes` instead of `text`) yields a placeholder
 * preview rather than failing the whole search.
 */
/*
 * 把一行 rg --json NDJSON 解析成匹配；非匹配记录类型（begin/end/context/summary）
 * 返回 undefined。不是 JSON 的行、或缺 path/行号/行内容的 match 记录抛 SearchError
 * SEARCH_FAILED。行不是合法 UTF-8 的匹配（ripgrep 发 base64 bytes 而非 text）用
 * 占位预览，而不是失败整次搜索。
 */
function parseRecord(line: string): GrepMatch | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error: unknown) {
    throw malformedRecord('a line is not JSON', error)
  }
  if (typeof parsed !== 'object' || parsed === null) throw malformedRecord('a record is not an object')
  const record = parsed as { type?: unknown; data?: unknown }
  // Non-match record types (begin/end/context/summary — and any future type)
  // are transport framing, not results: skipped, not malformed.
  // 中文说明：非匹配记录类型（begin/end/context/summary——以及任何未来类型）是
  // 传输框架而非结果：跳过，不算畸形。
  if (record.type !== 'match') return undefined
  if (typeof record.data !== 'object' || record.data === null) throw malformedRecord('a match record has no data')
  const data = record.data as { path?: unknown; line_number?: unknown; lines?: unknown }
  const pathText = typeof data.path === 'object' && data.path !== null ? (data.path as { text?: unknown }).text : undefined
  if (typeof pathText !== 'string') throw malformedRecord('a match record has no path text')
  if (typeof data.line_number !== 'number') throw malformedRecord('a match record has no line number')
  if (typeof data.lines !== 'object' || data.lines === null) throw malformedRecord('a match record has no line content')
  const lines = data.lines as { text?: unknown; bytes?: unknown }
  // 有 text 用 text（去掉尾换行）；只有 bytes（非 UTF-8）用占位预览。
  if (typeof lines.text === 'string') {
    return { path: pathText, lineNumber: data.line_number, line: lines.text.replace(/\r?\n$/, '') }
  }
  if (typeof lines.bytes === 'string') {
    return { path: pathText, lineNumber: data.line_number, line: '(line is not valid UTF-8)' }
  }
  throw malformedRecord('a match record has neither line text nor bytes')
}

/**
 * Parse complete `rg --json` stdout into flat matches, in output order (ripgrep
 * emits one file's matches contiguously). Only `match` records are consumed.
 *
 * @param stdout - the complete raw `rg --json` stdout.
 * @returns the flat matches; empty for output with no match records.
 */
/*
 * 把完整 rg --json stdout 解析成扁平匹配表（输出顺序；ripgrep 连续发出一个文件的
 * 匹配）。只消费 match 记录。
 * @param stdout 完整原始 rg --json stdout。
 * @returns 扁平匹配表；没有 match 记录时为空。
 */
export function parseGrepMatches(stdout: string): GrepMatch[] {
  const matches: GrepMatch[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const match = parseRecord(line)
    if (match !== undefined) matches.push(match)
  }
  return matches
}

/** `match` / `matches` for a count. */
/* 按计数给出 match/matches 单复数。 */
function matchNoun(count: number): string {
  return count === 1 ? 'match' : 'matches'
}

/**
 * Group flat matches by file (first-seen order) into the model-facing body:
 * each file's display path, then one `Line N: <text>` row per match.
 *
 * @param matches - the flat matches to render.
 * @returns the grouped body text.
 */
/*
 * 把扁平匹配按文件分组（首见顺序）成模型可见正文：每个文件的展示路径，然后每个
 * 匹配一行 `Line N: <text>`。
 * @param matches 要渲染的扁平匹配。
 * @returns 分组正文文本。
 */
export function formatGrepMatches(matches: GrepMatch[]): string {
  const byFile = new Map<string, GrepMatch[]>()
  for (const match of matches) {
    const group = byFile.get(match.path)
    if (group !== undefined) group.push(match)
    else byFile.set(match.path, [match])
  }
  const sections: string[] = []
  for (const [path, group] of byFile) {
    sections.push(`${path}\n${group.map(m => `Line ${m.lineNumber}: ${m.line}`).join('\n')}`)
  }
  return sections.join('\n\n')
}

/**
 * Format the model-facing `grep` result: a found-count header, the retained
 * matches grouped by file, then — when the result was capped — a footer
 * carrying either the formatted-spill recovery locator or the could-not-save
 * explanation. The omitted count is a budget fact: the search itself completed.
 *
 * @param retained - the retention outcome over every parsed match.
 * @param spillRef - the saved complete-result reference, or `undefined` when unsaved.
 * @returns the model-facing text.
 */
/*
 * 格式化模型侧 grep 结果：找到计数头、按文件分组的保留匹配，然后——结果被截断
 * 时——脚注携带格式化 spill 的恢复定位符或"无法保存"说明。省略的计数是预算事实：
 * 搜索本身完成了。
 * @param retained 覆盖每个解析匹配的保留结果。
 * @param spillRef 已保存完整结果的引用；未保存时为 undefined。
 * @returns 模型可见文本。
 */
export function formatGrepOutput(retained: RetainedItems<GrepMatch>, spillRef: SpillRef | undefined): string {
  const header = retained.truncated
    ? `Found ${retained.kept} of ${retained.seen} matches`
    : `Found ${retained.seen} ${matchNoun(retained.seen)}`
  const body = formatGrepMatches(retained.items)
  if (!retained.truncated) return `${header}\n\n${body}`
  const recovery = spillRef !== undefined
    ? `Full grep result stored at: ${spillRef.locator}. ${spillRef.retrievalHint}`
    : 'The complete result could not be saved; narrow pattern, path, or include to see more.'
  return `${header}\n\n${body}\n\n(${recovery})`
}

/** Format one already-retained match list for the Native surface. */
/* 为 Native 面格式化一份已保留的匹配表。 */
function formatRetainedGrep(retained: RetainedItems<GrepMatch>, spillRef?: SpillRef): string {
  if (retained.seen === 0) return 'No matches found'
  return formatGrepOutput(retained, spillRef)
}

/**
 * Pending-call presentation: a search card titled by the pattern (and target /
 * include filter).
 *
 * @param args - the raw tool arguments; `pattern`, `path`, and `include` feed the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
/*
 * 挂起调用展示：以模式（与目标/include 过滤器）为标题的搜索卡片。
 * @param args 原始工具参数；pattern、path 与 include 进入标题。
 * @returns 调用运行期间展示的通用卡片视图（kind: 'search'）。
 */
export function presentGrepCall(args: { pattern: string; path?: string; include?: string }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  const filter = args.include !== undefined ? ` (${args.include})` : ''
  return { card: 'generic', title: `Grep ${args.pattern}${where}${filter}`, kind: 'search', rawInput: args.pattern }
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (matches grouped by file, with the truncation signal). A UI
 * without a search card falls back to the raw `tool/result` content, so the view
 * carries no result text of its own. Malformed or absent metadata (an obsolete or
 * hand-edited replayed log) falls back to the generic card.
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the search card view, or `undefined` for the generic fallback.
 */
/*
 * 完成调用展示：从结果 presentationMeta（按文件分组的匹配 + 截断信号）投影搜索
 * 卡片。没有搜索卡片能力的 UI 回退到原始 tool/result 内容，所以视图自身不携带
 * 结果文本。畸形/缺失元数据（过时或手工编辑的重放日志）回退到通用卡片。
 * @param _args 原始工具参数；未使用，视图从结果派生。
 * @param result 携带投影元数据的最终模型侧工具结果。
 * @returns 搜索卡片视图；通用兜底时为 undefined。
 */
export function presentGrepResult(
  _args: { pattern: string; path?: string; include?: string },
  result: ToolResult,
): SearchResultView | undefined {
  if (result.isError) return undefined
  const view = searchViewFromMeta(result.meta)
  if (view === undefined || view.shape !== 'matches') return undefined
  return view
}

/**
 * Register the `grep` tool and its system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved grep caps (plugin config after defaulting).
 */
/*
 * 注册 grep 工具与其系统提示指南。
 * @param ctx 插件上下文；注册是作用域于它的副作用，执行使用其 subprocess 服务。
 * @param caps 部署的已解析 grep 上限（默认化后的插件配置）。
 */
export function applyGrepTool(ctx: Context, caps: GrepToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:grep',
    order: 104,
    text: 'Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context.',
  })

  const tool = defineTool({
    name: 'grep',
    description: 'Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. '
      + `Returns the first ${caps.maxMatches} matches inline; a capped result reports where the complete match list was saved. `
      + 'Use read on a matched file for surrounding context.',
    parameters: {
      pattern: { type: 'string', required: true, description: 'Regular expression to search for (ripgrep syntax).' },
      path: { type: 'string', description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.' },
      include: { type: 'string', description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          matches: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                lineNumber: { type: 'integer', required: true },
                line: { type: 'string', required: true },
              },
            },
          },
        },
      },
      // 模型侧渲染与卡片投影共用同一份保留结果（预览 + 内联上限）。
      render: (_args, value) => [{
        type: 'text',
        text: formatRetainedGrep(retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes)),
      }],
      presentationMeta: (_args, value) =>
        grepSearchMeta(retainGrepMatches(value.matches, caps.maxMatches, caps.maxLineBytes), caps.maxMetaBytes),
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args)
      const run = await runRipgrep(ctx, exec, 'grep', buildGrepCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      if (run.noMatches) return { matches: [] }

      // 解析 --json 并做工作目录相对化。
      const all: GrepMatch[] = []
      for (const raw of parseGrepMatches(run.stdout)) {
        const match: GrepMatch = {
          path: toWorkdirRelative(raw.path, run.workdir),
          lineNumber: raw.lineNumber,
          line: raw.line,
        }
        all.push(match)
      }
      return { matches: all }
    },
    presentCall: presentGrepCall,
    presentResult: presentGrepResult,
  })
  ctx.tools.register(tool)

  // 顶级直接调用的超限结果：把完整匹配表（全量预览、无内联上限）存成格式化 spill 文件。
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as { matches: GrepMatch[] } | undefined
    if (value === undefined) return decision
    const matches = value.matches
    if (matches.length <= caps.maxMatches) return decision
    // The spill artifact holds the COMPLETE result: preview each line, but keep
    // every match (no inline cap), so the recovery file is the full search.
    // 中文说明：spill 工件持有完整结果：预览每行，但保留每条匹配（无内联上限），
    // 恢复文件就是完整搜索。
    const previewedAll = matches.map(match => ({ ...match, line: previewLine(match.line, caps.maxLineBytes) }))
    const spillRef = await trySaveFormattedResult(
      ctx,
      exec,
      'grep-results.txt',
      `Found ${matches.length} ${matchNoun(matches.length)}\n\n${formatGrepMatches(previewedAll)}`,
    )
    return {
      kind: 'accept',
      content: [{
        type: 'text',
        text: formatRetainedGrep(retainGrepMatches(matches, caps.maxMatches, caps.maxLineBytes), spillRef),
      }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
