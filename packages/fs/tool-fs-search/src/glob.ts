/**
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的 glob 工具：发现路径匹配 glob 模式的文件，按修改时间排序。
 * 执行时通过子进程接缝、用普通 argv 向量直接启动打包的 ripgrep 二进制
 * （@vscode/ripgrep）；本模块拥有模型侧 schema、参数校验、argv 构造、结果解析、
 * 内联采样与格式化；进程关注点（spawn 执行、进程树终止、环境清理、输出捕获）留在
 * ctx.subprocess。
 * 【技术维度】buildGlobCommand 生成固定 rg --files argv（--sort=modified 按修改时间、
 * --no-ignore --hidden 搜索被忽略与隐藏文件、每 VCS 名两条取反 glob 排除 VCS 元数据）；
 * 超限结果按部署开关决定"取修改时间头"还是"跨顶级条目轮询采样"（sampleAcrossTopLevel）；
 * 展示与卡片共用同一份采样/头部，保证文本与卡片一致；超限的完整结果经
 * trySaveFormattedResult 存成 spill 文件。
 * 【产品维度】让模型按路径模式发现文件（替代 shell find）：结果只含文件（绝不目录）、
 * 含隐藏与被忽略文件（排除 VCS 目录）、内联有界、完整排序结果可 spill 恢复。
 * 【逻辑维度】按出现顺序：GLOB_MAX_RESULTS/GLOB_VCS_EXCLUDES（默认常量）→
 * GlobToolCaps/GlobInput（类型）→ parseGlobArgs（校验）→ buildGlobCommand（argv）→
 * GlobSample/relativeToSearchRoot/stripLeadingSeparators/topLevelSegment →
 * sampleAcrossTopLevel（跨顶级采样）→ formatGlobOutput/formatGlobPage/renderGlobPaths/
 * globCardPage（展示）→ presentGlobCall/presentGlobResult（卡片）→ applyGlobTool（注册）。
 * 【关键边界】每个模型控制值都是普通 argv 元素（无 shell 层，无引号问题），搜索根
 * 跟在 -- 后（前导横线路径不会被解析成旗标）；每个 VCS 名用两条取反 glob（裸形式
 * 在遍历中剪枝目录，/** 形式在搜索根位于该目录内/上时仍排除其内部）；结果路径相对
 * 工作目录展示（共址部署要求）。
 * 【新手阅读建议】先看 buildGlobCommand 理解 argv 模板，再看 sampleAcrossTopLevel
 * 的轮询采样，最后看 applyGlobTool 的注册与超限 spill 交接。
 * ==========================================================================
 */
/**
 * The model-facing `glob` tool: discover files whose paths match a glob
 * pattern, sorted by modification time. Execution spawns the packaged
 * ripgrep binary (`@vscode/ripgrep`) directly through the subprocess seam
 * with a plain argv vector — this module owns the model-facing schema,
 * argument validation, argv construction, result parsing, inline sampling,
 * and formatting; process concerns (spawn execution, tree termination,
 * environment scrubbing, output capture) stay behind `ctx.subprocess`.
 * @module @deepseek-ai/dsh-tool-fs-search/glob
 */
/**
 * 模块总览：本文件是 glob 工具的定义与执行体。argv 构造与结果解析在这里，
 * spawn/终止/捕获在 search-core.ts 与 ctx.subprocess。
 */

import type { Context } from '@deepseek-ai/cordis'
import { sep } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, SearchResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { SpillRef } from '@deepseek-ai/dsh-spill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { runRipgrep, toWorkdirRelative, trySaveFormattedResult } from './search-core.ts'
import { globSearchMeta, searchViewFromMeta } from './presentation.ts'
import { acceptedDirectCallValue } from './direct-call.ts'

/**
 * Default cap on paths retained inline by one `glob` call (the `globMaxResults`
 * config), matching Claude Code's default `GlobTool` result limit.
 */
/**
 * 单次 glob 调用内联保留路径数的默认上限（globMaxResults 配置的默认值）：100，
 * 与 Claude Code 默认 GlobTool 的结果上限一致。
 */
export const GLOB_MAX_RESULTS = 100

/**
 * Directory names ripgrep must never descend into for a discovery listing: VCS
 * metadata stores. `--no-ignore --hidden` would otherwise surface them in every
 * broad search. Each name is excluded with TWO negated `--glob`s (see
 * {@link buildGlobCommand}): an any-depth directory glob that matches — and
 * prunes — the directory during traversal, and a contents glob that still
 * excludes the internals when the search root itself is at or inside the
 * directory (an explicit `path` of `.git` or `sub/.git`), where the prune glob
 * alone never matches.
 */
/**
 * 发现列举中 ripgrep 绝不能下探的目录名：VCS 元数据存储。--no-ignore --hidden
 * 否则会在每个宽泛搜索里暴露它们。每个名字用两条取反 --glob 排除（见
 * buildGlobCommand）：一条任意深度目录 glob（遍历时匹配并剪枝该目录），一条内容
 * glob（搜索根本身在目录内/上时——如显式 path 为 .git 或 sub/.git——仍排除其内部，
 * 因为此时单独的剪枝 glob 永不匹配）。
 */
export const GLOB_VCS_EXCLUDES: readonly string[] = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl']

/** Resolved glob-tool caps — plugin config after defaulting (see `Config` in index.ts). */
/** 已解析的 glob 工具上限——默认化后的插件配置（见 index.ts 的 Config）。 */
export interface GlobToolCaps {
  /** Whether over-cap pages are sampled across top-level entries instead of taking the modification-time head. */
  /** 超限页是否跨顶级条目采样（而不是取修改时间头）。 */
  sampleOverCapGlobResults: boolean
  /** Max paths retained inline; later paths go to the formatted spill file. */
  /** 内联保留的最大路径数；后面的路径进格式化 spill 文件。 */
  maxResults: number
  /** Max bytes of serialized `presentationMeta`; trailing paths drop past it. */
  /** 序列化 presentationMeta 的最大字节数；超出后尾部路径被丢弃。 */
  maxMetaBytes: number
  /** Cap on the complete raw `rg` stdout the tool will parse. */
  /** 工具将解析的完整原始 rg stdout 上限。 */
  rawOutputMaxBytes: number
  /** Terminate-escalation grace period (ms) for the search process. */
  /** 搜索进程的终止升级宽限期（毫秒）。 */
  graceMs: number
  /** Cap on the retained stderr diagnostic tail. */
  /** 保留 stderr 诊断尾部的上限。 */
  stderrMaxBytes: number
  /** Cooperative tool-call budget (ms) attached as `ToolDefinition.timeoutMs`. */
  /** 协作式工具调用预算（毫秒），作为 ToolDefinition.timeoutMs 附加。 */
  timeoutMs: number
}

/** Validated `glob` arguments. */
/** 已校验的 glob 参数。 */
export interface GlobInput {
  pattern: string
  path?: string
}

/**
 * Validate value constraints the schema DSL can't express: a non-blank
 * `pattern`, and a non-blank `path` when given. Throws a plain `Error` (an
 * ordinary tool argument error) otherwise.
 *
 * @param args - the schema-validated `glob` arguments.
 * @returns the accepted input, unchanged.
 */
/**
 * 校验 schema DSL 表达不了的值约束：pattern 非空白；给出 path 时它也非空白。
 * 否则抛普通 Error（常规工具参数错误）。
 * @param args 已通过 schema 校验的 glob 参数。
 * @returns 被接受的输入，原样返回。
 */
export function parseGlobArgs(args: { pattern: string; path?: string }): GlobInput {
  if (args.pattern.trim().length === 0) throw new Error('pattern must be a non-empty string')
  if (args.path !== undefined && args.path.trim().length === 0) throw new Error('path must be a non-empty string when given')
  return { pattern: args.pattern, ...args.path !== undefined ? { path: args.path } : {} }
}

/**
 * Build the fixed `rg --files` argv for one `glob` call. Every
 * model-controlled value ({@link GlobInput.pattern}, {@link GlobInput.path})
 * is a plain argv element — no shell layer exists, so no quoting applies; the
 * search root rides behind `--` so a leading-dash path can never be parsed as
 * a flag. `--sort=modified` orders by modification time, `--no-ignore
 * --hidden` searches ignored and hidden files, and
 * {@link GLOB_VCS_EXCLUDES} keeps VCS metadata out.
 *
 * @param input - the validated arguments.
 * @returns the complete ripgrep argument vector (excluding the binary itself).
 */
/**
 * 为一次 glob 调用构造固定的 rg --files argv。每个模型控制值（pattern、path）都是
 * 普通 argv 元素——没有 shell 层，所以不存在引号问题；搜索根跟在 -- 后，前导横线
 * 路径绝不会被解析成旗标。--sort=modified 按修改时间排序，--no-ignore --hidden
 * 搜索被忽略与隐藏文件，GLOB_VCS_EXCLUDES 把 VCS 元数据排除在外。
 * @param input 已校验的参数。
 * @returns 完整 ripgrep 参数向量（不含二进制本身）。
 */
export function buildGlobCommand(input: GlobInput): string[] {
  const parts = [
    '--files',
    `--glob=${input.pattern}`,
    '--sort=modified',
    '--no-ignore',
    '--hidden',
    // Two negated globs per VCS name: the bare form prunes the directory
    // during traversal; the /** form still excludes the contents when the
    // search root is AT or INSIDE the directory (where the bare form,
    // matched against root-prefixed paths, never fires).
    // 中文说明：每个 VCS 名两条取反 glob——裸形式在遍历中剪枝目录；/** 形式在
    // 搜索根本身在目录内/上时仍排除其内部（此时裸形式对根前缀路径永不命中）。
    ...GLOB_VCS_EXCLUDES.flatMap(name => [
      `--glob=!**/${name}`,
      `--glob=!**/${name}/**`,
    ]),
  ]
  if (input.path !== undefined) parts.push('--', input.path)
  return parts
}

/**
 * The inline page of a capped `glob` result, plus how much of the complete
 * result's top level it reaches.
 */
/**
 * 被上限约束的 glob 结果的内联页，加上它覆盖了完整结果顶级条目的多少。
 */
export interface GlobSample {
  /** Paths to show inline: grouped by top-level entry, modification-time ordered within each group. */
  /** 内联展示的路径：按顶级条目分组，组内按修改时间排序。 */
  items: string[]
  /** Distinct top-level entries the shown paths reach. */
  /** 展示路径触及的不同顶级条目数。 */
  shown: number
  /** Distinct top-level entries across the complete result. */
  /** 完整结果里不同的顶级条目数。 */
  total: number
}

/** Remove the displayed search-root prefix before choosing a top-level group. */
/** 选择顶级分组前，去掉展示的搜索根前缀。 */
function relativeToSearchRoot(path: string, root: string): string {
  if (root === '.') return path.startsWith(`.${sep}`) ? path.slice(2) : path
  let rootEnd = root.length
  while (rootEnd > 0 && root[rootEnd - 1] === sep) rootEnd -= 1
  const trimmedRoot = root.slice(0, rootEnd)
  if (trimmedRoot.length === 0) return stripLeadingSeparators(path)
  if (path === trimmedRoot) return ''
  if (path.startsWith(`${trimmedRoot}${sep}`)) {
    return path.slice(trimmedRoot.length + 1)
  }
  return path
}

/** Strip only separators recognized by the execution platform. */
/** 只剥掉执行平台识别的分隔符。 */
function stripLeadingSeparators(path: string): string {
  let start = 0
  while (path[start] === sep) start += 1
  return path.slice(start)
}

/**
 * The leading path segment of one display path — the top-level entry, relative
 * to the search root, that the path sits under. A path with no separator is its
 * own top-level entry. Leading separators are stripped first so an absolute path
 * (one outside the workdir, which {@link toWorkdirRelative} leaves untouched)
 * groups by its first real name instead of collapsing every such path into one
 * empty group.
 */
/**
 * 一条展示路径的首段——该路径所在的（相对搜索根的）顶级条目。无分隔符的路径就是
 * 自己的顶级条目。先剥前导分隔符，这样绝对路径（工作目录外、toWorkdirRelative
 * 原样保留的路径）按第一个真实名字分组，而不是把每条都塌进一个空组。
 */
function topLevelSegment(path: string): string {
  const trimmed = stripLeadingSeparators(path)
  const cut = trimmed.indexOf(sep)
  return cut === -1 ? trimmed : trimmed.slice(0, cut)
}

/**
 * Choose the inline page of an over-cap result by round-robin across the
 * complete result's top-level entries, instead of taking its head.
 *
 * Every top-level entry receives a slot before any receives a second; exhausted
 * groups drop out. Group order and order within each group follow `paths`, so a
 * flat result reproduces the modification-time head.
 *
 * @param paths - the complete result, in ripgrep's modification-time order.
 * @param maxItems - how many paths the page may hold; the caller has already established it is smaller than `paths`.
 * @param root - the search root in the same display-path space as `paths`.
 * @returns the page grouped by top-level entry, with the shown/total top-level spread.
 */
/**
 * 超限结果的"轮询采样"内联页，而不是取头部：每个顶级条目先拿一个槽位，然后才是
 * 第二个；组耗尽即退出。组顺序与组内顺序跟随 paths，所以扁平结果复现修改时间头。
 * @param paths 完整结果（ripgrep 修改时间顺序）。
 * @param maxItems 页面可容纳的路径数；调用方已确认它小于 paths。
 * @param root 与 paths 同一展示路径空间的搜索根。
 * @returns 按顶级条目分组的页面，附 shown/total 顶级覆盖度。
 */
export function sampleAcrossTopLevel(paths: readonly string[], maxItems: number, root = '.'): GlobSample {
  type ActiveGroup = { key: string; items: string[]; index: number; current: string }
  // 先按顶级条目分组。
  const groups = new Map<string, string[]>()
  let active: ActiveGroup[] = []
  for (const path of paths) {
    const key = topLevelSegment(relativeToSearchRoot(path, root))
    const group = groups.get(key)
    if (group === undefined) {
      const items = [path]
      groups.set(key, items)
      active.push({ key, items, index: 0, current: path })
    } else {
      group.push(path)
    }
  }
  // 轮询取件：每轮每个活跃组取一个，直到凑满 maxItems 或组耗尽。
  const taken = new Map<string, string[]>()
  let count = 0
  while (active.length > 0 && count < maxItems) {
    const nextActive: ActiveGroup[] = []
    for (const { key, items, index, current } of active) {
      if (count >= maxItems) break
      count += 1
      const bucket = taken.get(key)
      if (bucket === undefined) taken.set(key, [current])
      else bucket.push(current)
      const nextIndex = index + 1
      const nextPath = items[nextIndex]
      if (nextPath !== undefined) nextActive.push({ key, items, index: nextIndex, current: nextPath })
    }
    active = nextActive
  }
  return { items: [...taken.values()].flat(), shown: taken.size, total: groups.size }
}

/**
 * Format a capped sampled page and its complete-result recovery path. A flat
 * result keeps the plain footer because its sample is the modification-time head.
 *
 * @param sample - the inline page and its top-level spread.
 * @param seen - how many paths the complete result holds; always more than the page.
 * @param spillRef - the saved complete-result reference, or `undefined` when unsaved.
 * @returns the model-facing text.
 */
/**
 * 格式化一个被上限约束的采样页与它的完整结果恢复路径。扁平结果保留普通脚注，
 * 因为它的采样就是修改时间头。
 * @param sample 内联页与顶级覆盖度。
 * @param seen 完整结果持有的路径数；总是多于页面。
 * @param spillRef 已保存完整结果的引用；未保存时为 undefined。
 * @returns 模型可见文本。
 */
export function formatGlobOutput(sample: GlobSample, seen: number, spillRef: SpillRef | undefined): string {
  const basis = sample.total === seen
    ? '.'
    : `, sampled across ${sample.shown} of the ${sample.total} top-level entries this pattern matched instead of taken in modification-time order.`
      + (sample.shown < sample.total ? ' Narrow path to inspect a specific subtree.' : '')
  return formatGlobPage(sample.items, seen, spillRef, basis)
}

/** Format one bounded page and the recovery path for its complete sorted result. */
/** 格式化一个有界页及其完整排序结果的恢复路径。 */
function formatGlobPage(items: readonly string[], seen: number, spillRef: SpillRef | undefined, basis: string): string {
  const body = items.join('\n')
  const recovery = spillRef !== undefined
    ? `Full sorted result stored at: ${spillRef.locator}. ${spillRef.retrievalHint}`
    : 'The complete result could not be saved; narrow pattern or path to see more.'
  return `${body}\n\n(Showing ${items.length} of ${seen} paths${basis} ${recovery})`
}

/** Bound and format one canonical path list for the Native surface relative to its search root. */
/** 为 Native 面相对其搜索根约束并格式化一条规范路径表。 */
function renderGlobPaths(paths: string[], caps: GlobToolCaps, root: string, spillRef?: SpillRef): string {
  if (paths.length === 0) return 'No files found'
  // A result that fits is shown whole, untouched: modification-time order is the
  // tool's contract, and over a complete result it is what answers age questions.
  // 中文说明：装得下的结果整表展示、原样不动——修改时间顺序是工具契约，完整结果
  // 正是回答"文件年龄"问题的依据。
  if (paths.length <= caps.maxResults) return paths.join('\n')
  if (!caps.sampleOverCapGlobResults) {
    return formatGlobPage(paths.slice(0, caps.maxResults), paths.length, spillRef, '.')
  }
  return formatGlobOutput(sampleAcrossTopLevel(paths, caps.maxResults, root), paths.length, spillRef)
}

/**
 * The inline page of paths a completed `glob` card shows, computed the SAME way
 * {@link renderGlobPaths} computes its model-facing page so the card and the text
 * agree on which paths survived the cap. A result within the cap is shown whole;
 * an over-cap result is either the modification-time head or the top-level sample,
 * matching the deployment's `sampleOverCapGlobResults`.
 *
 * @param paths - the complete discovered path list, in modification-time order.
 * @param caps - the resolved glob caps (the inline cap and the sampling switch).
 * @param root - the search root in the same display-path space as `paths`.
 * @returns the inline page and whether the complete result was capped.
 */
/**
 * 已完成 glob 卡片展示的内联路径页，用与 renderGlobPaths 相同的方式计算，保证卡片
 * 与文本对"哪些路径活过了上限"一致。上限内整表展示；超限结果是修改时间头或顶级
 * 采样，取决于部署的 sampleOverCapGlobResults。
 * @param paths 完整发现路径表（修改时间顺序）。
 * @param caps 已解析的 glob 上限（内联上限与采样开关）。
 * @param root 与 paths 同一展示路径空间的搜索根。
 * @returns 内联页与完整结果是否被截断。
 */
function globCardPage(paths: string[], caps: GlobToolCaps, root: string): { items: string[]; truncated: boolean } {
  if (paths.length <= caps.maxResults) return { items: paths, truncated: false }
  if (!caps.sampleOverCapGlobResults) return { items: paths.slice(0, caps.maxResults), truncated: true }
  return { items: sampleAcrossTopLevel(paths, caps.maxResults, root).items, truncated: true }
}

/**
 * Pending-call presentation: a search card titled by the pattern (and root).
 *
 * @param args - the raw tool arguments; `pattern` and `path` feed the title.
 * @returns the generic card view (`kind: 'search'`) shown while the call runs.
 */
/**
 * 挂起调用展示：以模式（与根）为标题的搜索卡片。
 * @param args 原始工具参数；pattern 与 path 进入标题。
 * @returns 调用运行期间展示的通用卡片视图（kind: 'search'）。
 */
export function presentGlobCall(args: { pattern: string; path?: string }): GenericCallView {
  const where = args.path !== undefined ? ` in ${args.path}` : ''
  return { card: 'generic', title: `Glob ${args.pattern}${where}`, kind: 'search', rawInput: args.pattern }
}

/**
 * Completed-call presentation: the search card projected from the result's
 * `presentationMeta` (the discovered path list, with the truncation signal). A UI
 * without a search card falls back to the raw `tool/result` content, so the view
 * carries no result text of its own. Malformed or absent metadata (an obsolete or
 * hand-edited replayed log) falls back to the generic card.
 *
 * @param _args - the raw tool arguments; unused, the view derives from the result.
 * @param result - the final model-facing tool result carrying the projected metadata.
 * @returns the search card view, or `undefined` for the generic fallback.
 */
/**
 * 完成调用展示：从结果 presentationMeta（发现路径表 + 截断信号）投影搜索卡片。
 * 没有搜索卡片能力的 UI 回退到原始 tool/result 内容，所以视图自身不携带结果文本。
 * 畸形/缺失元数据（过时或手工编辑的重放日志）回退到通用卡片。
 * @param _args 原始工具参数；未使用，视图从结果派生。
 * @param result 携带投影元数据的最终模型侧工具结果。
 * @returns 搜索卡片视图；通用兜底时为 undefined。
 */
export function presentGlobResult(_args: { pattern: string; path?: string }, result: ToolResult): SearchResultView | undefined {
  if (result.isError) return undefined
  const view = searchViewFromMeta(result.meta)
  if (view === undefined || view.shape !== 'paths') return undefined
  return view
}

/**
 * Register the `glob` tool and its system-prompt guidance.
 *
 * @param ctx - the plugin context; registrations are effects scoped to it, and
 *   execution uses its `subprocess` service.
 * @param caps - the deployment's resolved glob caps (plugin config after defaulting).
 */
/**
 * 注册 glob 工具与其系统提示指南。
 * @param ctx 插件上下文；注册是作用域于它的副作用，执行使用其 subprocess 服务。
 * @param caps 部署的已解析 glob 上限（默认化后的插件配置）。
 */
export function applyGlobTool(ctx: Context, caps: GlobToolCaps): void {
  const overCapGuidance = caps.sampleOverCapGlobResults
    ? 'while a larger one is sampled across top-level entries, so it spans the tree instead of one subtree.'
    : 'while a larger one keeps the modification-time-ordered head.'
  ctx.systemPrompt.section({
    name: 'tool:glob',
    order: 103,
    text: 'Use the glob tool — not shell find — to discover files by path pattern. A pattern with no "/" matches basenames at any depth, so "*" matches every file in the tree rather than its top level. '
      + `Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order, ${overCapGuidance}`,
  })

  const overCapDescription = caps.sampleOverCapGlobResults
    ? `a larger result instead returns ${caps.maxResults} paths sampled across top-level entries`
    : `a larger result returns the first ${caps.maxResults} paths in modification-time order`
  const tool = defineTool({
    name: 'glob',
    description: 'Find files whose paths match a glob pattern. Returns matching file paths — never directories — '
      + 'including hidden and ignored files (VCS metadata directories are excluded). '
      + `Up to ${caps.maxResults} paths come back in modification-time order; ${overCapDescription}, `
      + 'says so, and reports where the complete sorted list was saved. This tool does not enumerate directory entries.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). '
          + 'A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.',
      },
      path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
    },
    timeoutMs: caps.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderGlobPaths(value.paths, caps, value.root) }],
      presentationMeta: (_args, value) => {
        const page = globCardPage(value.paths, caps, value.root)
        return globSearchMeta({ items: page.items, truncated: page.truncated, seen: value.paths.length }, caps.maxMetaBytes)
      },
    },
    async execute(args, exec) {
      const input = parseGlobArgs(args)
      const run = await runRipgrep(ctx, exec, 'glob', buildGlobCommand(input), caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
      const root = input.path === undefined ? '.' : toWorkdirRelative(input.path, run.workdir)
      if (run.noMatches) return { root, paths: [] }

      // 把 rg 输出按行解析成工作目录相对路径表。
      const all: string[] = []
      for (const line of run.stdout.split('\n')) {
        if (line.length === 0) continue
        const displayPath = toWorkdirRelative(line, run.workdir)
        all.push(displayPath)
      }
      return { root, paths: all }
    },
    presentCall: presentGlobCall,
    presentResult: presentGlobResult,
  })
  ctx.tools.register(tool)

  // 顶级直接调用的超限结果：把完整排序结果存成格式化 spill 文件。
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    const value = acceptedDirectCallValue(ctx, tool, exec, result, decision) as { root: string; paths: string[] } | undefined
    if (value === undefined) return decision
    const paths = value.paths
    if (paths.length <= caps.maxResults) return decision
    const spillRef = await trySaveFormattedResult(ctx, exec, 'glob-results.txt', paths.join('\n'))
    return {
      kind: 'accept',
      content: [{ type: 'text', text: renderGlobPaths(paths, caps, value.root, spillRef) }],
      ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {},
    }
  })
}
