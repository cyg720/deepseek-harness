/*
 * ================================ 文件注释 ================================
 * 【文件职责】沙箱执行器内部的"运行结果分类"辅助函数：把一次失败的运行归类为
 * "运行器启动失败（spawn 失败）""运行器自身故障""策略拒绝"等可区分结局，供
 * SandboxBashExecutor 在 run/start/onProcessDone 中判定并上报。
 * 【技术维度】纯函数集合，只依赖 node:fs 的两个同步探测（statSync/accessSync）与
 * 字符串签名匹配；通过错误对象里的 code/path/syscall 字段与 stderr 文本做分类。
 * 这是 bash 消费者与 pwsh 消费者共享的分类方言（pwsh 版是本文件的逐调用镜像）。
 * 【产品维度】安全边界的可诊断性：命令被沙箱拒绝、运行器本身不可用、还是命令自身失败，
 * 三者对用户意味着不同处理路径（升级审批 / 提示沙箱不可用 / 正常展示输出），必须能区分。
 * 【逻辑维度】isUsableWorkdir 探测 cwd 可用性 → isRunnerSpawnFailure 判定 spawn 失败归属 →
 * classifyRunnerFailure 按规则匹配 stderr 致命签名 → classifyDenial / matchesSignature 判定拒绝。
 * 【关键边界】只有 ENOENT/EACCES 且具备正向 argv[0] 证据的错误才算运行器启动失败；
 * workdir 在分类时检查而非与 spawn 原子化，并发路径替换可能改变归属但不会放行未受限执行。
 * 【新手阅读建议】先看 matchesSignature（最简单的签名匹配），再看 classifyRunnerFailure
 * 的规则循环，最后理解 isRunnerSpawnFailure 的"错误归属"判定。
 * ==========================================================================
 */

/**
 * Internal sandbox-result classification helpers.
 *
 * @module @deepseek-ai/dsh-bash-sandbox/helpers
 */

import { accessSync, constants, statSync } from 'node:fs'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { RunnerFailureRule } from '@deepseek-ai/dsh-sandbox'

/** Node-local spawn codes proven to identify executable resolution or permission failure. */
/* 已知能标识"可执行文件解析或权限失败"的 Node 本地 spawn 错误码集合。 */
const EXECUTABLE_SPAWN_CODES = new Set(['EACCES', 'ENOENT'])

/** Whether the caller-owned spawn cwd can be entered. */
/*
 * 判断调用方给定的 spawn 工作目录是否可进入（存在、是目录且有执行权限）。
 * @param path 调用方拥有的 spawn cwd 路径
 * @returns 目录存在且可进入时为 true，否则 false
 */
function isUsableWorkdir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Attribute only Node ENOENT/EACCES failures whose error path equals argv[0]
 * after independently ruling out the caller-owned cwd. A supplied error path
 * must exactly identify the runner; without one, the syscall must. With a
 * usable cwd, these codes describe resolution or execute permission for that
 * argv[0] or its shebang interpreter.
 * The workdir is checked at classification time, not atomically with spawn;
 * concurrent path replacement may change attribution but cannot permit an
 * unconfined execution.
 * @param error - the original spawn rejection.
 * @param runnerProgram - provider argv[0], the executable that establishes confinement.
 * @param workdir - the caller-owned spawn cwd, checked independently for usability.
 * @returns whether the rejection has executable-specific runner evidence.
 */
/*
 * 仅在独立排除调用方 cwd 之后，把 Node 的 ENOENT/EACCES 失败归因于带正向 argv[0] 证据
 * 的错误。提供错误路径时必须精确标识运行器；没有路径时则由 syscall 判定。cwd 可用时，
 * 这些错误码描述的是 argv[0] 或其 shebang 解释器的解析/执行权限问题。
 * @param error 原始的 spawn 拒绝原因
 * @param runnerProgram 提供者的 argv[0]，即建立隔离的可执行文件
 * @param workdir 调用方拥有的 spawn cwd，被独立检查可用性
 * @returns 该拒绝是否具备针对可执行文件的运行器证据
 */
export function isRunnerSpawnFailure(
  error: unknown,
  runnerProgram: string | undefined,
  workdir: string,
): boolean {
  // 无运行器程序或 cwd 不可用时无法归因，直接判定为不是运行器启动失败。
  if (runnerProgram === undefined || !isUsableWorkdir(workdir)) return false
  if (typeof error !== 'object' || error === null) return false
  // 从错误对象提取判定所需的三个字段（error 是 unknown，先做窄化再断言结构）。
  const { code, path, syscall } = error as { code?: unknown; path?: unknown; syscall?: unknown }
  if (typeof code !== 'string' || !EXECUTABLE_SPAWN_CODES.has(code)) return false
  if (typeof syscall !== 'string') return false
  // spawn 系统调用会带被启动程序路径，据此区分失败是否针对运行器本身。
  const exactSyscall = `spawn ${runnerProgram}`
  if (path === undefined) return syscall === exactSyscall
  if (typeof path !== 'string' || path.length === 0 || path !== runnerProgram) return false
  return syscall === 'spawn' || syscall === exactSyscall
}

/** Fatal runner evidence retained for infrastructure-error detail. */
/* 保留用于基础设施错误详情的致命运行器证据。 */
interface RunnerFailureMatch {
  /** The original stderr line that matched a fatal signature. */
  /* 与致命签名匹配的原始 stderr 行。 */
  detail: string
}

/**
 * Classify a failed run against the selected backend's denial dialect.
 * @param result - settled foreground run.
 * @param signatures - case-insensitive denial substrings from the active wrap.
 * @returns whether the failed run matches that denial dialect.
 */
/*
 * 依据所选后端的"拒绝方言"对一次失败的运行分类。
 * @param result 已落定的前台运行
 * @param signatures 当前包装给出的大小写不敏感拒绝子串
 * @returns 该失败运行是否匹配此拒绝方言
 */
export function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSignature(result.exitCode, result.stderr.text, signatures)
}

/**
 * Classify one settled process against the selected backend's structured
 * runner-failure rules. Each rule requires a nonzero exit, its optional
 * exit-code gate, and a fatal signature on one stderr line after exact
 * informational lines are excluded.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text, left unchanged.
 * @param rules - structured runner-failure rules from the active wrap.
 * @returns the first matching fatal line, or undefined when evidence is insufficient.
 */
/*
 * 依据所选后端的结构化运行器失败规则对一次已落定的进程分类。每条规则要求非零退出、
 * 可选的退出码门槛，以及排除精确信息行后某一 stderr 行上的致命签名。
 * @param exitCode 进程退出码；null 表示信号终止
 * @param stderr 收集到的 stderr 文本，保持原样
 * @param rules 当前包装给出的结构化运行器失败规则
 * @returns 命中的第一条致命行；证据不足时为 undefined
 */
export function classifyRunnerFailure(
  exitCode: number | null,
  stderr: string,
  rules: readonly RunnerFailureRule[],
): RunnerFailureMatch | undefined {
  // 无退出码（信号致死）或退出码为 0 都不构成运行器失败。
  if (exitCode === null || exitCode === 0) return undefined
  // 按行切分 stderr，逐行做精确信息行排除与致命签名匹配。
  const lines = stderr.split(/\r?\n/)
  // 依次尝试每条规则，首个满足门槛的规则胜出。
  for (const rule of rules) {
    if (rule.allowedExitCodes !== undefined && !rule.allowedExitCodes.includes(exitCode)) continue
    // 预先小写化信息行，用于整行精确排除。
    const informationalLines = new Set((rule.informationalLines ?? []).map(line => line.toLowerCase()))
    // An empty or whitespace-only substring is not meaningful runner evidence.
    // Ignore it while keeping any valid signatures beside it active.
    // 空或纯空白子串不是有意义的运行器证据：过滤掉，同时保留其旁的合法签名。
    const fatalSignatures = rule.fatalSignatures
      .filter(signature => signature.trim().length > 0)
      .map(signature => signature.toLowerCase())
    // 逐行检查：先跳过精确信息行，再试致命签名。
    for (const line of lines) {
      const lowered = line.toLowerCase()
      if (informationalLines.has(lowered)) continue
      if (fatalSignatures.some(signature => lowered.includes(signature))) return { detail: line }
    }
  }
  return undefined
}

/**
 * Match a non-zero exit against case-insensitive stderr signatures.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text.
 * @param signatures - substrings identifying the selected backend's dialect.
 * @returns whether this is a non-zero exit whose stderr matches a signature.
 */
/*
 * 用大小写不敏感的 stderr 签名匹配非零退出。
 * @param exitCode 进程退出码；null 表示信号终止
 * @param stderr 收集到的 stderr 文本
 * @param signatures 标识所选后端方言的子串
 * @returns 是否为非零退出且 stderr 匹配某个签名
 */
export function matchesSignature(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some(signature => lowered.includes(signature.toLowerCase()))
}
