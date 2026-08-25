/*
 * ================================ 文件注释 ================================
 * 【文件职责】面向模型的文件系统发现工具套件（glob、grep），建立在打包的 ripgrep
 * 二进制（@vscode/ripgrep）之上。这个单一插件注册两个工具；二进制随 npm 依赖分发，
 * 不需要系统 rg、也没有 shell 层。
 * 【技术维度】spawn 支持而非 ctx.fs 提供者方法：本地工作区发现是进程支撑的 rg
 * 工作流，经 ctx.subprocess.spawn() 带固定 ripgrep argv 模板执行——绝不走 ctx.shell。
 * 工具层拥有 schema、参数校验、argv 构造（glob.ts/grep.ts）、结果解析、保留、
 * 格式化结果 spill 与超时声明；子进程接缝拥有 spawn 执行、进程树终止、环境清理与
 * 原始输出捕获。注入 tools/systemPrompt/subprocess（刻意不注入 fs），ctx.spillStore
 * 用 ctx.get() 按机会读取（格式化结果 spill 可选）。
 * 【产品维度】让模型用 glob/grep 高效发现工作区文件与内容，替代 shell find/grep；
 * 结果内联有界、完整结果可 spill 恢复。
 * 【逻辑维度】按出现顺序：export 桶 → name/inject → Config 与 Config（含强制项
 * sampleOverCapGlobResults）→ ResolvedConfig → assertPositiveInteger → apply
 * （校验所有上限后注册 glob/grep）。
 * 【关键边界】返回路径相对解析出的工作目录展示，且只在"工作目录与文件系统读根是
 * 同一工作区"的共址部署里可继续读取（文档化 v1 部署要求，非运行时校验）；apply 为
 * async（oxlint 豁免），让加载期配置拒绝表现为 rejection 而非同步抛出。
 * 【新手阅读建议】先看 Config 理解所有上限旋钮，再看 apply 的校验与两个工具的注册，
 * 最后深入 glob.ts/grep.ts。
 * ==========================================================================
 */
/**
 * The model-facing filesystem discovery tool suite (`glob`, `grep`) over the
 * packaged ripgrep binary (`@vscode/ripgrep`). This single plugin registers
 * both tools; the binary ships inside the npm dependency, so no system `rg`
 * install and no shell layer is involved.
 *
 * ## Spawn-backed, not a `ctx.fs` provider method
 *
 * Local workspace discovery is a process-backed `rg` workflow, so these tools
 * execute through `ctx.subprocess.spawn()` with fixed ripgrep argv templates —
 * never `ctx.shell`, never `ctx.shell.start()`, never a model-visible background
 * task. The tool layer owns schemas, argument validation, argv construction
 * ({@link module:@deepseek-ai/dsh-tool-fs-search/glob} /
 * {@link module:@deepseek-ai/dsh-tool-fs-search/grep}), result parsing,
 * retention, formatted-result spill, and timeout declaration; the subprocess
 * seam owns spawn execution, process-tree termination, environment scrubbing,
 * and raw output capture. The package injects `tools`, `systemPrompt`, and
 * `subprocess` — deliberately NOT `fs`, and `ctx.spillStore` is read
 * opportunistically with `ctx.get()` because formatted-result spill is optional.
 *
 * Returned paths are displayed relative to the resolved workdir and are
 * follow-up-readable only in co-located deployments where the workdir and the
 * filesystem `read` root are the same workspace — a documented v1 deployment
 * requirement, not runtime-validated.
 *
 * @module @deepseek-ai/dsh-tool-fs-search
 */
/*
 * 模块总览：本文件是搜索工具套件的插件组装层：配置校验 + 注册 glob/grep。
 * 两个工具的 argv 构造与结果解析分别在 glob.ts / grep.ts。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { GLOB_MAX_RESULTS, applyGlobTool } from './glob.ts'
import { GREP_MAX_LINE_BYTES, GREP_MAX_MATCHES, applyGrepTool } from './grep.ts'
import { RAW_OUTPUT_MAX_BYTES, SEARCH_GRACE_MS, SEARCH_META_MAX_BYTES, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS } from './search-core.ts'

// 对外再导出：glob/grep/search-core 的常量、函数与类型（供组合方与测试使用）。
export { GLOB_MAX_RESULTS, GLOB_VCS_EXCLUDES, applyGlobTool, buildGlobCommand, formatGlobOutput, parseGlobArgs, presentGlobCall, presentGlobResult, sampleAcrossTopLevel } from './glob.ts'
export type { GlobInput, GlobSample, GlobToolCaps } from './glob.ts'
export {
  GREP_MAX_LINE_BYTES,
  GREP_MAX_MATCHES,
  applyGrepTool,
  buildGrepCommand,
  formatGrepMatches,
  formatGrepOutput,
  parseGrepArgs,
  parseGrepMatches,
  presentGrepCall,
  presentGrepResult,
} from './grep.ts'
export type { GrepInput, GrepToolCaps } from './grep.ts'
export {
  RAW_OUTPUT_MAX_BYTES,
  SEARCH_GRACE_MS,
  SEARCH_META_MAX_BYTES,
  SEARCH_STDERR_MAX_BYTES,
  SEARCH_TIMEOUT_MS,
  SearchError,
  previewLine,
  resolveRgPath,
  runRipgrep,
  toWorkdirRelative,
  trySaveFormattedResult,
} from './search-core.ts'
export type { GrepMatch, RipgrepRun, SearchErrorCode } from './search-core.ts'

/** Cordis plugin name used by loader diagnostics. */
/* 插件名（供加载器诊断使用）。 */
export const name = 'tool-fs-search'

/** Services required by the search tool suite (`spillStore` is optional, read via `ctx.get()`). */
/* 搜索工具套件依赖的服务（spillStore 可选，经 ctx.get() 读取）。 */
export const inject = ['tools', 'systemPrompt', 'subprocess']

/** Plugin config; over-cap glob sampling is an explicit deployment choice and the remaining fields have defaults. */
/*
 * 插件配置：超过上限的 glob 采样是显式部署选择（必填），其余字段有默认值。
 */
export interface Config {
  /** Whether an over-cap `glob` page is sampled across top-level entries instead of taking the modification-time head. */
  /* 超限 glob 页是否跨顶级条目采样（而不是取修改时间头）。 */
  sampleOverCapGlobResults: boolean
  /** Max paths one `glob` call retains inline; later paths go to the formatted spill file. */
  /* 单次 glob 调用内联保留的最大路径数；后面的路径进格式化 spill 文件。 */
  globMaxResults?: number
  /** Max flat matches one `grep` call retains inline; later matches go to the formatted spill file. */
  /* 单次 grep 调用内联保留的最大扁平匹配数；后面的匹配进格式化 spill 文件。 */
  grepMaxMatches?: number
  /** Max bytes retained for one matched-line preview (the cut preserves UTF-8 boundaries). */
  /* 一条匹配行预览保留的最大字节数（截断保留 UTF-8 边界）。 */
  grepMaxLineBytes?: number
  /** Max bytes of one search's serialized `presentationMeta`; trailing groups/paths drop past it so the persisted card stays bounded. */
  /* 单次搜索序列化 presentationMeta 的最大字节数；超出的尾部组/路径被丢弃，持久化卡片保持有界。 */
  searchMetaMaxBytes?: number
  /** Max complete raw `rg` stdout bytes a search will parse; larger raw output fails with `SEARCH_RAW_OUTPUT_OVERFLOW`. */
  /* 搜索将解析的完整原始 rg stdout 最大字节数；更大输出以 SEARCH_RAW_OUTPUT_OVERFLOW 失败。 */
  rawOutputMaxBytes?: number
  /** Terminate-escalation grace (ms), handed to the subprocess seam and bounded by `MAX_TIMER_DELAY_MS`. */
  /* 终止升级宽限（毫秒），交给子进程接缝，并以 MAX_TIMER_DELAY_MS 为界。 */
  graceMs?: number
  /** Max bytes retained for one search's stderr tail; the excerpt is embedded in `SEARCH_*` error messages, never shown on success. */
  /* 单次搜索保留 stderr 尾部的最大字节数；摘录嵌入 SEARCH_* 错误消息，成功时绝不展示。 */
  stderrMaxBytes?: number
  /**
   * Cooperative tool-call timeout budget (ms) on both tools, enforced by
   * `@deepseek-ai/dsh-tool-call-timeout-policy` through `exec.signal`.
   */
  /*
   * 两个工具的协作式工具调用超时预算（毫秒），由 dsh-tool-call-timeout-policy
   * 经 exec.signal 强制。
   */
  timeoutMs?: number
}

// schemastery 配置校验器：sampleOverCapGlobResults 必填，其余各带默认值。
export const Config: z<Config> = z.object({
  sampleOverCapGlobResults: z.boolean().required(),
  globMaxResults: z.number().default(GLOB_MAX_RESULTS),
  grepMaxMatches: z.number().default(GREP_MAX_MATCHES),
  grepMaxLineBytes: z.number().default(GREP_MAX_LINE_BYTES),
  searchMetaMaxBytes: z.number().default(SEARCH_META_MAX_BYTES),
  rawOutputMaxBytes: z.number().default(RAW_OUTPUT_MAX_BYTES),
  graceMs: z.number().default(SEARCH_GRACE_MS),
  stderrMaxBytes: z.number().default(SEARCH_STDERR_MAX_BYTES),
  timeoutMs: z.number().default(SEARCH_TIMEOUT_MS),
})

/** The shape after schemastery applied the defaults. */
/* schemastery 套用默认值后的配置形态。 */
type ResolvedConfig = Required<Config>

/** Every search cap counts items/bytes/milliseconds — a positive integer, or retention and timeout arithmetic misbehaves silently. */
/*
 * 每个搜索上限都是条目/字节/毫秒计数——必须是正整数，否则保留与超时算术会静默出错。
 */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs-search: ${name} must be a positive integer`)
  }
}

/**
 * Register the `glob`/`grep` filesystem discovery tool suite. The packaged
 * ripgrep binary is always available (an npm dependency), so registration is
 * unconditional.
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
/*
 * 注册 glob/grep 文件系统发现工具套件。打包的 ripgrep 二进制总是可用（npm 依赖），
 * 所以注册无条件。
 * @param ctx 插件上下文；注册是作用域于本插件的副作用。
 * @param config schemastery 解析出的插件配置。
 */
// 中文说明（须位于 oxlint 豁免 pragma 的上方）：async 让加载期配置拒绝表现为
// rejection，而不是同步抛出（与插件加载契约一致）。
// oxlint-disable-next-line typescript/require-await -- async keeps a load-time config rejection a rejection, not a synchronous throw
export async function apply(ctx: Context, config: Config): Promise<void> {
  // schemastery (Config) has already filled every defaulted field.
  // 中文说明：schemastery（Config）已填充所有带默认值的字段。
  const resolved = config as ResolvedConfig
  assertPositiveInteger('globMaxResults', resolved.globMaxResults)
  assertPositiveInteger('grepMaxMatches', resolved.grepMaxMatches)
  assertPositiveInteger('grepMaxLineBytes', resolved.grepMaxLineBytes)
  assertPositiveInteger('searchMetaMaxBytes', resolved.searchMetaMaxBytes)
  assertPositiveInteger('rawOutputMaxBytes', resolved.rawOutputMaxBytes)
  assertPositiveInteger('graceMs', resolved.graceMs)
  if (resolved.graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-fs-search: graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  assertPositiveInteger('stderrMaxBytes', resolved.stderrMaxBytes)
  assertPositiveInteger('timeoutMs', resolved.timeoutMs)
  applyGlobTool(ctx, {
    sampleOverCapGlobResults: resolved.sampleOverCapGlobResults,
    maxResults: resolved.globMaxResults,
    maxMetaBytes: resolved.searchMetaMaxBytes,
    rawOutputMaxBytes: resolved.rawOutputMaxBytes,
    graceMs: resolved.graceMs,
    stderrMaxBytes: resolved.stderrMaxBytes,
    timeoutMs: resolved.timeoutMs,
  })
  applyGrepTool(ctx, {
    maxMatches: resolved.grepMaxMatches,
    maxLineBytes: resolved.grepMaxLineBytes,
    maxMetaBytes: resolved.searchMetaMaxBytes,
    rawOutputMaxBytes: resolved.rawOutputMaxBytes,
    graceMs: resolved.graceMs,
    stderrMaxBytes: resolved.stderrMaxBytes,
    timeoutMs: resolved.timeoutMs,
  })
}
