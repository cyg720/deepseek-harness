/*
 * ================================ 文件注释 ================================
 * 【文件职责】glob/grep 两个搜索工具共享的执行管道：包私有的 SEARCH_* 错误词汇、
 * 一个用普通 argv 向量运行打包 ripgrep 二进制（@vscode/ripgrep）并返回完整原始
 * stdout 的 spawn 助手、尽力而为的"格式化结果 spill"交接、以及工作目录相对化展示。
 * 【技术维度】两个工具都作为普通前台 spawn 经 ctx.subprocess 执行——绝不走
 * ctx.shell、绝不 start()、绝不做模型可见的后台任务。ripgrep 二进制随 npm 包分发，
 * 无需系统 rg；argv 与 ripgrep 之间没有 shell 层，所以没有 shell 引号问题。
 * 原始 rg stdout 是内部传输细节：工具向子进程接缝请求按次 stdout 捕获预算，只在
 * rawOutputMaxBytes 内解析完整内存 stdout，绝不读 spill 文件。模型可见的恢复工件是
 * 经 ctx.spillStore.saveText() 保存的格式化结果。
 * 【产品维度】让 glob/grep 具备"大结果可恢复"能力：内联展示有界，完整结果存成
 * spill 文件供模型继续读取；SEARCH_* 错误码让重试/权限/UI 层无需解析消息。
 * 【逻辑维度】按出现顺序：默认上限常量 → SearchErrorCode/SearchError → RipgrepRun
 * → stderrExcerpt/classifyRunFailure → completeStdout → resolveRgPath → runRipgrep
 * → toWorkdirRelative → GrepMatch/previewLine/retainGrepMatches/retainGlobPaths →
 * trySaveFormattedResult。
 * 【关键边界】spawn 不加围栏（普通 ctx.subprocess 调用），所以前置 --no-config：
 * 宿主 RIPGREP_CONFIG_PATH（或二进制旁的 rg.conf）可能注入 --pre 让 ripgrep 对每个
 * 匹配文件执行任意预处理器；退出语义由工具拥有（0 成功有结果、1 成功零结果、其它
 * 分类成 SEARCH_*）；启动期两类失败域（spawn 创建同步抛错 / handle.done 拒绝）都
 * 归为 SEARCH_FAILED（cause 链原始错误），创建时已观察到的中止归 SEARCH_ABORTED。
 * 【新手阅读建议】先看 runRipgrep 的退出语义与失败分类，再看 resolveRgPath 的
 * 单文件运行时 sidecar 逻辑，最后看 trySaveFormattedResult 的"尽力而为"保存。
 * ==========================================================================
 */
/**
 * Shared execution plumbing for the `glob` / `grep` search tools: the
 * package-owned `SEARCH_*` error vocabulary, one spawn helper that runs the
 * PACKAGED ripgrep binary (`@vscode/ripgrep`) with a plain argv vector and
 * returns complete raw stdout, the best-effort formatted-result spill handoff,
 * and workdir-relative path display.
 *
 * Both tools execute as ordinary foreground spawns through `ctx.subprocess` —
 * never `ctx.shell`, never `ctx.shell.start()`, never a model-visible background
 * task. The ripgrep binary ships inside the npm package, so no system `rg`
 * install is required, and no shell layer exists between the argv vector and
 * ripgrep, so no shell quoting is involved. Raw `rg` stdout is an internal
 * transport detail: the tools request a per-run stdout capture budget from the
 * subprocess seam, parse only complete in-memory stdout within
 * `rawOutputMaxBytes`, and never read spill files. The model-facing recovery
 * artifact is the formatted result saved through `ctx.spillStore.saveText()`
 * ({@link trySaveFormattedResult}).
 *
 * @module @deepseek-ai/dsh-tool-fs-search/search-core
 */
/*
 * 模块总览：本文件是 glob/grep 的"执行管道"——spawn、错误分类、结果保留与 spill
 * 保存；argv 构造与结果解析在 glob.ts / grep.ts。
 */

import { existsSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { ItemRetainer, TextRetainer } from '@deepseek-ai/dsh-output-retention'
import type { RetainedItems } from '@deepseek-ai/dsh-output-retention'
import type { SubprocessHandle, SubprocessOutcome, SubprocessOutputRead, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Default cap on the complete raw `rg` stdout the tools will parse (the
 * `rawOutputMaxBytes` config), matching Claude Code's ripgrep raw buffer.
 */
/*
 * 工具将解析的完整原始 rg stdout 默认上限（rawOutputMaxBytes 配置的默认值）：
 * 20 MB，与 Claude Code 的 ripgrep 原始缓冲一致。
 */
export const RAW_OUTPUT_MAX_BYTES = 20_000_000

/**
 * Default cooperative tool-call timeout budget in milliseconds (the `timeoutMs`
 * config), attached to both tool definitions for
 * `@deepseek-ai/dsh-tool-call-timeout-policy` to enforce through `exec.signal`.
 */
/*
 * 默认协作式工具调用超时预算（毫秒，timeoutMs 配置的默认值）：30 秒。附到两个工具
 * 定义上，由 dsh-tool-call-timeout-policy 经 exec.signal 强制。
 */
export const SEARCH_TIMEOUT_MS = 30_000

/**
 * Default cap in bytes on the retained stderr tail of one search run — a
 * diagnostic excerpt only (the tool never reads a stderr spill path, and the
 * collect disposition requests none).
 */
/*
 * 单次搜索保留 stderr 尾部的默认字节上限（64 KiB）——仅作诊断摘录（工具从不读
 * stderr spill 路径，collect 处置也不请求它）。
 */
export const SEARCH_STDERR_MAX_BYTES = 64 * 1024

/** Default terminate grace period for a search process (ms). */
/* 搜索进程默认的终止宽限期（毫秒）：3 秒。 */
export const SEARCH_GRACE_MS = 3_000

/**
 * Default cap in bytes on one search's serialized `presentationMeta` (the
 * `searchMetaMaxBytes` config). The inline match/path caps already bound the item
 * COUNT, but retained matches of a broad search (many long lines) can still
 * serialize to hundreds of kilobytes, and `meta` is persisted with the session
 * log and re-sent on every request. A deployment's final output budget
 * (`dsh-spill-policy`) only shrinks a result's `content`, never its `meta`, so the
 * projection owns this cap. 64 KiB holds the full default-capped result of a
 * typical search while bounding the pathological one.
 */
/*
 * 单次搜索序列化 presentationMeta 的默认字节上限（searchMetaMaxBytes 配置的默认值）：
 * 64 KiB。内联匹配/路径上限已约束条目数量，但宽泛搜索保留的匹配（很多长行）仍可能
 * 序列化成几百 KB，且 meta 随会话日志持久化并在每个请求重发。部署的最终输出预算
 * （dsh-spill-policy）只收缩结果的 content、从不收缩 meta，所以投影层拥有此上限。
 * 64 KiB 能装下典型搜索的完整默认上限结果，同时约束住病态结果。
 */
export const SEARCH_META_MAX_BYTES = 65_536

/**
 * Stable, machine-routable codes for search failures. Package-owned (not
 * `FsErrorCode`) because these tools are spawn-backed discovery, not `ctx.fs`
 * provider operations: `SEARCH_INVALID_PATTERN` — ripgrep rejected the regex or
 * glob; `SEARCH_FAILED` — the search could not run or its output could not be
 * parsed (a failed `rg` launch, inaccessible target, signal kill, malformed
 * `--json`); `SEARCH_RAW_OUTPUT_OVERFLOW` — raw `rg` output exceeded
 * `rawOutputMaxBytes` or stayed truncated after that requested stdout budget;
 * `SEARCH_ABORTED` — the cooperative tool timeout or caller cancellation cut
 * the search short.
 */
/*
 * 搜索失败的稳定、可机器路由错误码。包私有（不是 FsErrorCode），因为这些工具是
 * spawn 支持的文件发现，不是 ctx.fs 提供者操作：SEARCH_INVALID_PATTERN——ripgrep
 * 拒绝了正则或 glob；SEARCH_FAILED——搜索无法运行或输出无法解析（rg 启动失败、
 * 目标不可访问、被信号杀、畸形 --json）；SEARCH_RAW_OUTPUT_OVERFLOW——原始 rg
 * 输出超过 rawOutputMaxBytes 或在该 stdout 预算后仍被截断；SEARCH_ABORTED——
 * 协作式工具超时或调用方取消中断了搜索。
 */
export type SearchErrorCode =
  | 'SEARCH_INVALID_PATTERN'
  | 'SEARCH_FAILED'
  | 'SEARCH_RAW_OUTPUT_OVERFLOW'
  | 'SEARCH_ABORTED'

/**
 * Typed search failure. Extends {@link HarnessError} so it carries a stable
 * {@link SearchErrorCode} and chains `cause`; the tool registry exposes
 * `{ name, code }` on `isError` results so retry/permission/UI layers can
 * branch without parsing messages.
 */
/*
 * 类型化搜索失败。继承 HarnessError，携带稳定 SearchErrorCode 并链上 cause；
 * 工具注册表在 isError 结果里暴露 { name, code }，让重试/权限/UI 层无需解析消息
 * 即可分支。
 */
export class SearchError extends HarnessError {
  override readonly code: SearchErrorCode

  constructor(message: string, code: SearchErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** The completed acquisition of one `rg` run: complete stdout plus the resolved workdir. */
/* 一次 rg 运行的完整结果：完整 stdout + 解析出的工作目录。 */
export interface RipgrepRun {
  /** Complete raw stdout retained by the subprocess seam within the requested cap. */
  /* 子进程接缝在请求上限内保留的完整原始 stdout。 */
  stdout: string
  /** True when ripgrep exited 1: a successful search with zero results. */
  /* ripgrep 以 1 退出时为 true：成功搜索但零结果。 */
  noMatches: boolean
  /** The resolved working directory the command ran in (the display-relativization base). */
  /* 命令运行所在的工作目录（展示相对化的基准）。 */
  workdir: string
}

/**
 * The retained stderr tail as a diagnostic excerpt, with a truncation note when
 * the subprocess seam dropped bytes.
 */
/*
 * 把保留的 stderr 尾部整理成诊断摘录；接缝丢弃过字节时附截断说明。
 */
function stderrExcerpt(stderrText: string, truncated: boolean): string {
  const text = stderrText.trim()
  if (text.length === 0) return ''
  return truncated ? `${text} [stderr truncated]` : text
}

/**
 * Classify a nonzero-exit `rg` run into the search error vocabulary. There is
 * no shell layer, so an exit 127 or shell "command not found" text cannot
 * occur — a launch failure rejects at spawn (see {@link runRipgrep}).
 */
/*
 * 把非零退出的 rg 运行分类进搜索错误词汇。没有 shell 层，所以 exit 127 或 shell 的
 * "command not found" 文本不可能出现——启动失败在 spawn 处就拒绝（见 runRipgrep）。
 */
function classifyRunFailure(toolName: string, exitCode: number, stderrText: string, stderrTruncated: boolean): SearchError {
  const stderr = stderrExcerpt(stderrText, stderrTruncated)
  if (/regex parse error|error parsing glob/i.test(stderr)) {
    return new SearchError(`${toolName} pattern rejected by ripgrep: ${stderr}`, 'SEARCH_INVALID_PATTERN')
  }
  return new SearchError(`${toolName} search failed (exit ${exitCode})${stderr.length > 0 ? `: ${stderr}` : ''}`, 'SEARCH_FAILED')
}

/**
 * Acquire the COMPLETE raw stdout of a finished run, enforcing
 * `rawOutputMaxBytes` on the in-memory transport. A truncated result means the
 * subprocess seam could not retain complete stdout within the requested
 * budget, so the tool fails clearly instead of parsing a silently-partial
 * stream.
 */
/*
 * 获取已完成运行的"完整原始 stdout"，在内存传输上强制 rawOutputMaxBytes。
 * 截断结果意味着子进程接缝无法在请求预算内保留完整 stdout，所以工具明确失败，
 * 而不是解析一个悄悄不完整的流。
 */
function completeStdout(toolName: string, stdout: SubprocessOutputRead, rawOutputMaxBytes: number): string {
  const narrow = 'narrow pattern, path, or include and retry'
  if (!stdout.lossy) {
    const inlineBytes = Buffer.byteLength(stdout.text, 'utf8')
    if (inlineBytes > rawOutputMaxBytes) {
      throw new SearchError(
        `${toolName} produced ${inlineBytes} bytes of raw output, over the ${rawOutputMaxBytes}-byte cap; ${narrow}`,
        'SEARCH_RAW_OUTPUT_OVERFLOW',
      )
    }
    return stdout.text
  }
  throw new SearchError(
    `${toolName} produced more raw output than the subprocess seam retained within the ${rawOutputMaxBytes}-byte cap; ${narrow}`,
    'SEARCH_RAW_OUTPUT_OVERFLOW',
  )
}

// 打包 ripgrep 二进制路径的进程级记忆化 Promise。
let rgPathPromise: Promise<string> | undefined

/**
 * The packaged ripgrep binary path, resolved lazily once per process.
 *
 * A single-file runtime uses the executable's `-rg` sidecar because a native
 * helper cannot be spawned from pkg's virtual filesystem. Node-mode builds
 * fall back to the platform package selected by `@vscode/ripgrep`. Resolving
 * at the call boundary keeps a missing or corrupt binary at the first search
 * call as `SEARCH_FAILED`, rather than failing the Loader composition.
 *
 * @returns the packaged binary's absolute path; the memoized promise rejects
 *   when the platform package cannot be resolved.
 */
/*
 * 打包 ripgrep 二进制路径，每进程懒解析一次并记忆化。
 * 单文件运行时用可执行文件的 -rg 伴生文件（原生助手无法从 pkg 的虚拟文件系统
 * spawn）；Node 模式构建回退到 @vscode/ripgrep 选择的平台包。在调用边界解析，
 * 让缺失/损坏的二进制在首次搜索调用时报 SEARCH_FAILED，而不是让 Loader 组合失败。
 * @returns 打包二进制的绝对路径；平台包无法解析时记忆化 Promise 拒绝。
 */
export function resolveRgPath(): Promise<string> {
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executableSidecar = `${process.execPath}-rg`
    if ('pkg' in process && existsSync(executableSidecar)) return executableSidecar
    return (await import('@vscode/ripgrep')).rgPath
  })
  return rgPathPromise
}

/**
 * Run the packaged ripgrep binary with a plain argv vector and return its
 * complete raw stdout. The working directory is the calling agent's session
 * cwd (`exec.agent.session.header.cwd`) when available, else
 * `process.cwd()`. `exec.signal` is forwarded so the cooperative tool timeout
 * (`@deepseek-ai/dsh-tool-call-timeout-policy`) and caller cancellation terminate the
 * process tree.
 *
 * The spawn is unconfined (a plain `ctx.subprocess` call), so `--no-config`
 * is prepended: a host `RIPGREP_CONFIG_PATH` (or `rg.conf` next to the
 * binary) can otherwise inject `--pre` and make ripgrep execute an arbitrary
 * preprocessor for every matched file. The collect dispositions are the
 * seam's diagnostic-tail shape (no spill files): the tools never read a raw
 * spill path, and truncated stdout fails as `SEARCH_RAW_OUTPUT_OVERFLOW`.
 *
 * Exit semantics are tool-owned: exit 0 is success with results, exit 1 is
 * success with zero results (`noMatches`), anything else throws a
 * {@link SearchError} (abort/timeout → `SEARCH_ABORTED`, invalid pattern →
 * `SEARCH_INVALID_PATTERN`, the rest → `SEARCH_FAILED` /
 * `SEARCH_RAW_OUTPUT_OVERFLOW`). Both launch-time failure domains are
 * classified: a synchronous throw at spawn CREATION (a NUL in argv, an abort
 * racing the pre-check, a rejected `@vscode/ripgrep` resolution) and a
 * rejection of `handle.done` (the seam's infrastructure failures) both become
 * `SEARCH_FAILED` with the original as `cause` — an abort already observed by
 * creation time becomes `SEARCH_ABORTED` instead.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param exec - the tool-execution context; supplies the session cwd and the abort signal.
 * @param toolName - `glob` or `grep`, used in error messages.
 * @param argv - the ripgrep arguments (every model value an unquoted argv element; no shell layer exists).
 * @param rawOutputMaxBytes - cap on the complete raw stdout the tool will parse.
 * @param graceMs - the seam's terminate-escalation grace period.
 * @param stderrMaxBytes - cap on the retained stderr diagnostic tail.
 * @returns the complete stdout, the zero-result flag, and the resolved workdir.
 */
/*
 * 用普通 argv 向量运行打包 ripgrep 二进制并返回其完整原始 stdout。工作目录为调用
 * 代理的会话 cwd（exec.agent.session.header.cwd，有则用之），否则 process.cwd()。
 * 转发 exec.signal，让协作式工具超时与调用方取消终止进程树。
 * spawn 不加围栏（普通 ctx.subprocess 调用），所以前置 --no-config：否则宿主的
 * RIPGREP_CONFIG_PATH（或二进制旁的 rg.conf）可能注入 --pre，让 ripgrep 对每个匹配
 * 文件执行任意预处理器。collect 处置是接缝的诊断尾部形状（无 spill 文件）：工具
 * 从不读原始 spill 路径，截断 stdout 以 SEARCH_RAW_OUTPUT_OVERFLOW 失败。
 * 退出语义由工具拥有：0 成功有结果，1 成功零结果（noMatches），其它抛 SearchError
 * （中止/超时 → SEARCH_ABORTED，无效模式 → SEARCH_INVALID_PATTERN，其余 →
 * SEARCH_FAILED / SEARCH_RAW_OUTPUT_OVERFLOW）。两类启动失败域都分类：
 * spawn 创建时的同步抛错（argv 含 NUL、中止与预检竞争、@vscode/ripgrep 解析被拒）
 * 与 handle.done 的拒绝（接缝基础设施失败）都归为 SEARCH_FAILED（cause 链原始
 * 错误）；创建时已观察到的中止归 SEARCH_ABORTED。
 * @param ctx 插件上下文；执行使用其 subprocess 服务。
 * @param exec 工具执行上下文；提供会话 cwd 与中止信号。
 * @param toolName glob 或 grep，用于报错文案。
 * @param argv ripgrep 参数（每个模型值都是不带引号的 argv 元素；无 shell 层）。
 * @param rawOutputMaxBytes 工具将解析的完整原始 stdout 上限。
 * @param graceMs 接缝的终止升级宽限期。
 * @param stderrMaxBytes 保留 stderr 诊断尾部的上限。
 * @returns 完整 stdout、零结果标记、解析出的工作目录。
 */
export async function runRipgrep(
  ctx: Context,
  exec: ToolExecution,
  toolName: string,
  argv: readonly string[],
  rawOutputMaxBytes: number,
  graceMs: number,
  stderrMaxBytes: number,
): Promise<RipgrepRun> {
  // 调用前已中止：直接报 SEARCH_ABORTED（协作超时或调用方取消）。
  if (exec.signal.aborted) {
    throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
  }
  const cwd = exec.agent?.session.header.cwd
  const workdir = cwd ?? process.cwd()
  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [await resolveRgPath(), '--no-config', ...argv],
      cwd: workdir,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: rawOutputMaxBytes },
        stderr: { maxBytes: stderrMaxBytes },
      },
      graceMs,
      signal: exec.signal,
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    // Node's spawn() throws synchronously for a NUL in argv, and the local
    // impl can throw synchronously when the signal aborts between the check
    // above and this call (or when the platform-package resolution rejects).
    // The static narrowing that proves this re-check "always false" cannot
    // see AbortSignal state changes.
    // 中文说明：Node 的 spawn() 对 argv 含 NUL 会同步抛错；本地实现在上述检查与
    // 本次调用之间信号中止时（或平台包解析被拒时）也可能同步抛错。证明此重查
    // "恒为 false" 的静态收窄看不到 AbortSignal 状态变化，故此处需 oxlint 豁免。
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (exec.signal.aborted) {
      throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
    }
    throw new SearchError(`${toolName} could not start its search command (ripgrep launch failed)`, 'SEARCH_FAILED', { cause: error })
  }
  let outcome: SubprocessOutcome
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new SearchError(`${toolName} could not start its search command (ripgrep launch failed)`, 'SEARCH_FAILED', { cause: error })
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined) {
    throw new SearchError(`${toolName} search command produced no collected output streams`, 'SEARCH_FAILED')
  }
  // The signal can abort while the spawn is awaited; the static narrowing that
  // proves this re-check "always false" cannot see AbortSignal state changes.
  // 中文说明：等待 spawn 期间信号可能中止；证明此重查"恒为 false"的静态收窄
  // 看不到 AbortSignal 状态变化，故此处需 oxlint 豁免。
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (exec.signal.aborted) {
    throw new SearchError(`${toolName} was aborted before completion (tool timeout or caller cancellation)`, 'SEARCH_ABORTED')
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new SearchError(`${toolName} search command was killed by signal ${outcome.signal ?? '(unknown)'}`, 'SEARCH_FAILED')
  }
  // 非零非一退出：按 stderr 分类（无效模式/普通失败）。
  if (outcome.exitCode !== 0 && outcome.exitCode !== 1) {
    throw classifyRunFailure(toolName, outcome.exitCode, stderr.text, stderr.lossy)
  }
  const text = completeStdout(toolName, stdout, rawOutputMaxBytes)
  return { stdout: text, noMatches: outcome.exitCode === 1, workdir }
}

/**
 * Map an `rg` output path to its display form: absolute paths inside the
 * resolved workdir become workdir-relative; everything else (relative output,
 * paths outside the workdir) passes through unchanged. Display-only —
 * returned paths are follow-up-readable in co-located workdir/filesystem
 * deployments where both resolve the same workspace (the documented v1
 * deployment requirement).
 *
 * @param path - one path as ripgrep printed it.
 * @param workdir - the resolved workdir the command ran in.
 * @returns the workdir-relative display path when possible, else `path` unchanged.
 */
/*
 * 把 rg 输出路径映射成展示形式：工作目录内的绝对路径变成工作目录相对路径；
 * 其它（相对输出、工作目录外的路径）原样通过。仅展示用途——返回的路径在"工作目录
 * 与文件系统读根解析同一工作区"的共址部署里可继续读取（文档化的 v1 部署要求）。
 * @param path ripgrep 打印出的一条路径。
 * @param workdir 命令运行所在的工作目录。
 * @returns 可能时的工作目录相对展示路径；否则原样返回 path。
 */
export function toWorkdirRelative(path: string, workdir: string): string {
  if (!isAbsolute(path)) return path
  const rel = relative(workdir, path)
  if (rel.length === 0) return '.'
  if (rel === '..' || rel.startsWith(`..${sep}`)) return path
  return rel
}

/** One parsed match: the file, the 1-based line number, and the (possibly previewed) line text. */
/* 一条解析出的匹配：文件、1 基行号、（可能已预览的）行文本。 */
export interface GrepMatch {
  path: string
  lineNumber: number
  line: string
}

/**
 * Bound one matched-line preview to `maxBytes` (UTF-8 boundary preserved) and
 * mark the cut. The cap is a per-line budget fact; the complete line stays in
 * the searched file for `read`.
 *
 * @param line - the matched line text (trailing newline already stripped).
 * @param maxBytes - the preview budget in bytes.
 * @returns the preview, suffixed with ` (line truncated)` when bytes were cut.
 */
/*
 * 把一行匹配预览约束到 maxBytes（保留 UTF-8 边界）并标记截断。上限是每行的预算
 * 事实；完整行仍留在被搜文件里供 read 读取。
 * @param line 匹配行文本（尾换行已剥掉）。
 * @param maxBytes 预览预算（字节）。
 * @returns 预览；截断过字节时附 " (line truncated)" 后缀。
 */
export function previewLine(line: string, maxBytes: number): string {
  const retainer = new TextRetainer({ kind: 'head', maxBytes })
  retainer.push(line)
  const kept = retainer.finish()
  return kept.truncated ? `${kept.text} (line truncated)` : kept.text
}

/**
 * Apply the shared inline cap to a canonical `grep` match list: preview each
 * retained line to `maxLineBytes` and keep the first `maxMatches`. The single
 * retention pass both the model-facing render ({@link module:@deepseek-ai/dsh-tool-fs-search/grep}
 * `formatGrepOutput`) and the search-card projection
 * ({@link module:@deepseek-ai/dsh-tool-fs-search/presentation} `grepSearchMeta`)
 * consume, so text and card never disagree about which matches survived.
 *
 * @param matches - every match the search parsed (the canonical value's matches).
 * @param maxMatches - the inline match cap (the `grepMaxMatches` config).
 * @param maxLineBytes - the per-matched-line preview budget in bytes.
 * @returns the retention outcome over the previewed matches.
 */
/*
 * 对规范的 grep 匹配表应用共享内联上限：把每条保留行预览到 maxLineBytes 并保留
 * 前 maxMatches 条。这单次保留过程同时被模型侧渲染（grep 的 formatGrepOutput）与
 * 搜索卡片投影（presentation 的 grepSearchMeta）消费，文本与卡片对"哪些匹配存活"
 * 永不分歧。
 * @param matches 搜索解析出的每条匹配（规范值的 matches）。
 * @param maxMatches 内联匹配上限（grepMaxMatches 配置）。
 * @param maxLineBytes 每条匹配行的预览预算（字节）。
 * @returns 对预览后匹配的保留结果。
 */
export function retainGrepMatches(matches: GrepMatch[], maxMatches: number, maxLineBytes: number): RetainedItems<GrepMatch> {
  const retainer = new ItemRetainer<GrepMatch>({ kind: 'head', maxItems: maxMatches })
  for (const match of matches) retainer.push({ ...match, line: previewLine(match.line, maxLineBytes) })
  return retainer.finish()
}

/**
 * Apply the shared inline cap to a canonical `glob` path list: keep the first
 * `maxResults`. The single retention pass both the model-facing render and the
 * search-card projection consume.
 *
 * @param paths - every path the search discovered (the canonical value's paths).
 * @param maxResults - the inline path cap (the `globMaxResults` config).
 * @returns the retention outcome over the paths.
 */
/*
 * 对规范的 glob 路径表应用共享内联上限：保留前 maxResults 条。这单次保留过程同时
 * 被模型侧渲染与搜索卡片投影消费。
 * @param paths 搜索发现的每条路径（规范值的 paths）。
 * @param maxResults 内联路径上限（globMaxResults 配置）。
 * @returns 对路径的保留结果。
 */
export function retainGlobPaths(paths: string[], maxResults: number): RetainedItems<string> {
  const retainer = new ItemRetainer<string>({ kind: 'head', maxItems: maxResults })
  for (const path of paths) retainer.push(path)
  return retainer.finish()
}

/**
 * Best-effort save of one COMPLETE formatted search result through
 * `ctx.spillStore.saveText()` — the model-facing recovery path for a capped
 * result. `spillStore` is read with `ctx.get()` (not static inject) because
 * formatted-result spill is optional; the spill owner is the calling agent's
 * session header id and the source is the tool execution identity. A missing
 * backend, a call with no session owner, or a `saveText()` rejection logs a
 * warning and returns `undefined` — the caller keeps the inline result and
 * reports that the complete result could not be saved; search success never
 * turns into `isError` because spill storage is unavailable.
 *
 * @param ctx - the plugin context; `spillStore` is looked up opportunistically.
 * @param exec - the tool-execution context; supplies the owning session, tool name, and call id.
 * @param suggestedName - the backend-sanitized filename hint (e.g. `grep-results.txt`).
 * @param content - the complete formatted result to persist.
 * @returns the saved spill reference, or `undefined` when the result could not be saved.
 */
/*
 * 通过 ctx.spillStore.saveText() "尽力而为"地保存一份完整格式化搜索结果——封顶结果
 * 的模型侧恢复路径。spillStore 用 ctx.get()（而非静态 inject）读取，因为格式化结果
 * spill 是可选的；spill 拥有者是调用代理的会话头 id，来源是工具执行身份。后端缺失、
 * 无会话拥有者的调用、或 saveText() 拒绝都会记警告并返回 undefined——调用方保留
 * 内联结果并报告"完整结果未能保存"；搜索成功绝不会因为 spill 存储不可用而变成
 * isError。
 * @param ctx 插件上下文；spillStore 按机会查找。
 * @param exec 工具执行上下文；提供拥有会话、工具名与调用 id。
 * @param suggestedName 后端净化过的文件名提示（如 grep-results.txt）。
 * @param content 要持久化的完整格式化结果。
 * @returns 已保存的 spill 引用；结果无法保存时为 undefined。
 */
export async function trySaveFormattedResult(
  ctx: Context,
  exec: ToolExecution,
  suggestedName: string,
  content: string,
): Promise<SpillRef | undefined> {
  const sessionId = exec.agent?.session.header.id
  if (sessionId === undefined) {
    ctx.logger.warn(`tool-fs-search: no session owner for ${exec.name} result; complete result not saved`)
    return undefined
  }
  const spillStore = ctx.get('spillStore')
  if (!spillStore) {
    ctx.logger.warn(`tool-fs-search: no ctx.spillStore backend loaded; complete ${exec.name} result not saved`)
    return undefined
  }
  const save: SaveTextSpill = {
    owner: { sessionId },
    source: { toolName: exec.name, callId: exec.callId, label: 'result' },
    suggestedName,
    content,
  }
  try {
    return await spillStore.saveText(save)
  } catch (error: unknown) {
    // Best-effort: a storage failure must never fail the search or hide the
    // inline result — the footer reports the unsaved remainder instead.
    // 中文说明：尽力而为——存储失败绝不能失败搜索或隐藏内联结果，脚注报告未保存
    // 的剩余部分即可。
    ctx.logger.warn(`tool-fs-search: saveText failed for ${exec.name}: ${String(error)}; complete result not saved`)
    return undefined
  }
}
