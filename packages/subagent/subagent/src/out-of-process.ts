/**
 * ================================ 文件注释 ================================
 * 【文件职责】进程外（out-of-process）子代理后端的共享词汇：零能力声明、定时上限校验、
 *   子代理工作目录解析（配置覆盖，否则取父会话工作区）、永不 reject 的结果结算、
 *   以及标准的运行句柄发布。
 * 【技术维度】无任何能力（NO_START_CAPABILITIES）是进程外后端的声明：父代理强制的启动特性
 *   无法在另一个进程里兑现，因此服务端在 start 前就拒绝；settleRunResult 用"本地取消优先 +
 *   失败扁平化为 error"保证 result 永不 reject。
 * 【产品维度】ACP、fork 等外部进程子代理在此统一契约，避免把服务器进程的工作目录
 *   意外当成子代理的工作区（一个服务器服务多个会话，各有各的 cwd）。
 * 【逻辑维度】按代码顺序：诊断文本截断 → NO_START_CAPABILITIES → assertPositiveFinite →
 *   isEnterableDirectory → assertUsableCwd → validateConfiguredCwd → resolveChildCwd →
 *   toError → RunResultSettlement → settleRunResult → SubprocessRunHandleParts →
 *   subprocessRunHandle。
 * 【关键边界】cwd 必须是绝对路径且可进入（X_OK）；diagnostic 截断不切断 UTF-8 序列；
 *   dispose() 幂等（记忆化一次 teardown）。
 * 【新手阅读建议】先读 settleRunResult 理解"result 永不 reject"的契约，再读
 *   subprocessRunHandle 的幂等 dispose。
 * ==========================================================================
 */

/**
 * Provider-side vocabulary for OUT-OF-PROCESS subagent backends — the pieces
 * that enforce this seam's own contracts around a child in another process:
 * the no-capabilities advertisement, timing-bound validation, child
 * working-directory resolution (config override, else the delegating parent
 * session's workspace), the never-reject result settlement, and the standard
 * run-handle publication. Backends compose these with their own wire drivers;
 * the process machinery itself (spawn, env scrub, tree-scoped teardown)
 * belongs to the `dsh-subprocess` seam.
 *
 * @module @deepseek-ai/dsh-subagent/out-of-process
 */

import { accessSync, constants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentCapabilities, SubagentResult, SubagentRun, SubagentStopReason } from './types.ts'

/** Maximum UTF-8 size of {@link SubagentResult.diagnostic}. */
const MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4_096

const DIAGNOSTIC_TRUNCATION_SUFFIX = '\n[diagnostic truncated]'
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * Limit provider-authored failure detail without splitting a UTF-8 sequence.
 * @param diagnostic - safe diagnostic text produced by the provider.
 * @returns the original text, or a visibly truncated value within the limit.
 */
// 中文：把 provider 提供的失败详情限制在 4KB 内；截断位置回退到 UTF-8 字符边界，
// 避免切断多字节序列产生乱码，并附加截断提示后缀。
function limitSubagentDiagnostic(diagnostic: string): string {
  const bytes = utf8Encoder.encode(diagnostic)
  if (bytes.byteLength <= MAX_SUBAGENT_DIAGNOSTIC_BYTES) return diagnostic

  const suffixBytes = utf8Encoder.encode(DIAGNOSTIC_TRUNCATION_SUFFIX).byteLength
  let prefixBytes = MAX_SUBAGENT_DIAGNOSTIC_BYTES - suffixBytes
  while (((bytes[prefixBytes] as number) & 0b1100_0000) === 0b1000_0000) {
    prefixBytes -= 1
  }
  return utf8Decoder.decode(bytes.subarray(0, prefixBytes))
    + DIAGNOSTIC_TRUNCATION_SUFFIX
}

/**
 * The capability advertisement of an out-of-process backend: NONE. A child in
 * another process cannot honor parent-enforced start features
 * (`outputSchema`/`maxDepth`/`toolFilter`/`persona`), so the service rejects a
 * request needing any of them before `start` runs — never accepted-then-ignored.
 */
// 中文：进程外后端的启动能力声明——全部为 false。另一个进程里的子代理无法兑现
// outputSchema/maxDepth/toolFilter/persona 这些父进程强制的特性，因此任何需要
// 这些能力的请求都会在 start 前被服务端拒绝（绝不接受后静默忽略）。
export const NO_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
})

/**
 * Assert a configured timing bound is a positive finite number (it bounds a
 * teardown or shutdown wait; zero, negative, or NaN would skip or wedge it).
 * @param prefix - the consuming plugin's diagnostic prefix (e.g. `subagent-acp`).
 * @param name - the config field name, for the diagnostic.
 * @param value - the configured value.
 */
// 中文：校验定时类配置必须是"正的有限数"（0、负数、NaN 会让等待被跳过或卡死）。
export function assertPositiveFinite(prefix: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${prefix}: ${name} must be a positive finite number`)
  }
}

/**
 * Whether `path` names an existing directory the harness can ENTER. The
 * search-permission probe matters: `statSync().isDirectory()` is true for a
 * mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
 */
function isEnterableDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    // statSync/accessSync throw only filesystem access errors here
    // (ENOENT/EACCES/ENOTDIR/…), and every one of them means the path cannot
    // serve as the child's cwd.
    return false
  }
}

/**
 * Assert `cwd` can actually host the child: absolute (it doubles as the
 * child's workspace identity, and a relative path would be re-anchored to the
 * server process's launch directory) and an existing directory (fail here,
 * before the process boundary, instead of as an ambiguous spawn ENOENT).
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param label - which source supplied the value, for the diagnostic.
 * @param cwd - the candidate working directory.
 * @returns `cwd`, validated.
 */
// 中文：校验候选工作目录：必须是绝对路径（相对路径会被重新锚定到服务器进程的启动目录）
// 且是"可进入"的目录（spawn 需要 X_OK 权限），失败在进程边界之前报错。
export function assertUsableCwd(prefix: string, label: string, cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new Error(`${prefix}: ${label} must be an absolute path: ${cwd}`)
  }
  if (!isEnterableDirectory(cwd)) {
    throw new Error(`${prefix}: ${label} is not an accessible directory: ${cwd}`)
  }
  return cwd
}

/**
 * Validate a configured `cwd` override ONCE, at plugin load: reject the empty
 * string (`path.resolve('')` is the process cwd — it would silently
 * reintroduce the launch-directory fallback this resolution removes),
 * interpret a relative path against the harness launch directory, and require
 * an enterable directory.
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param cwd - the configured override, or `undefined` when the config omits it.
 * @returns the validated absolute override, or `undefined` when omitted.
 */
// 中文：插件加载时一次性校验配置的 cwd 覆盖：拒绝空串（path.resolve('') 会悄悄退回
// 服务器启动目录）、相对路径按启动目录解析、并要求是"可进入"的目录。
export function validateConfiguredCwd(prefix: string, cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  if (cwd === '') {
    throw new Error(`${prefix}: config cwd must not be empty — omit the key to inherit the parent session cwd`)
  }
  return assertUsableCwd(prefix, 'config cwd', resolve(cwd))
}

/**
 * Resolve the child's working directory at start: the deployment override
 * when configured (already validated at load), else the parent session's
 * workspace cwd (validated here, its earliest resolvable point). Fails loud
 * when neither exists — falling back to the harness process cwd would
 * silently bind the child to the server's launch directory instead of the
 * delegating session's workspace (one server process serves many sessions,
 * each with its own cwd).
 * @param prefix - the consuming plugin's diagnostic prefix.
 * @param configured - the load-validated override, or `undefined`.
 * @param parentCwd - the delegating parent session's workspace cwd, if any.
 * @returns the absolute child working directory.
 */
// 中文：解析子代理工作目录：配置覆盖优先（加载时已校验），否则用父会话的工作区并在此
// 校验；两者都没有就报错，绝不悄悄退回服务器进程的启动目录。
export function resolveChildCwd(prefix: string, configured: string | undefined, parentCwd: string | undefined): string {
  if (configured !== undefined) return configured
  if (parentCwd === undefined) {
    throw new Error(`${prefix}: no working directory for the child — configure \`cwd\` or delegate from a parent session that has one`)
  }
  return assertUsableCwd(prefix, 'parent session cwd', parentCwd)
}

/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
// 中文：把 catch 到的 unknown 归一化为 Error：类型化表面只会抛 Error，
// String(value) 分支只是对非 Error 抛出的防御性兜底。
function toError(value: unknown): Error {
  // The rejecting surfaces (wire clients, spawn failures) only throw
  // `Error`s; the `String(value)` arm is a defensive fallback for a non-Error
  // throw the typed surfaces cannot produce.
  /* v8 ignore next */
  return value instanceof Error ? value : new Error(String(value))
}

/** Inputs to {@link settleRunResult}. */
// 中文：进程外结果结算的输入集合：attempt 是回合尝试、collectOutput 快照输出、
// collectDiagnostic 快照诊断、cancelled 判本地取消、onError 是失败诊断槽、
// signal/onAbort 是取消信号及其监听器。
export interface RunResultSettlement {
  /** The turn attempt (typically racing local cancellation); returns the terminal result. */
  attempt: () => Promise<SubagentResult>
  /** Snapshot the provider exposes when cancellation or failure wins settlement. */
  collectOutput: () => ContentBlock[]
  /** Snapshot safe provider-authored detail when a failure wins settlement. */
  collectDiagnostic?: (() => string | undefined) | undefined
  /** Whether local cancellation settled before the attempt's outcome is observed. */
  cancelled: () => boolean
  /** Diagnostic sink for a failure flattened to a stop reason; a throw from it is contained. */
  onError?: ((error: Error, stopReason: SubagentStopReason) => void) | undefined
  /** The request's cancellation signal (the listener is removed at settlement). */
  signal: AbortSignal
  /** The abort listener registered on {@link signal} at start. */
  onAbort: () => void
}

/**
 * Settle an out-of-process run result under the seam contract: `result` never
 * rejects after publication. A normally completed or rejected attempt resolves
 * as `aborted` when cancellation already settled locally; another rejection is
 * flattened to `stopReason: 'error'` through the contained diagnostic sink.
 * The abort listener is removed on every path.
 * @param parts - the attempt, output snapshot, cancellation state, sink, and signal wiring.
 * @returns the terminal result (never a rejection).
 */
// 中文：进程外运行结果的结算：attempt 正常完成且未取消则原样返回；本地取消已生效则
// 返回 aborted；其他拒绝被扁平化为 stopReason:'error'（诊断经 onError 记录）；任何
// 路径都在 finally 中移除 abort 监听器，保证 result 永不 reject。
export async function settleRunResult(parts: RunResultSettlement): Promise<SubagentResult> {
  try {
    const result = await parts.attempt()
    return parts.cancelled()
      ? { output: parts.collectOutput(), stopReason: 'aborted' }
      : result
  } catch (error: unknown) {
    // Cover a rejection already queued when cancellation arrives.
    if (parts.cancelled()) return { output: parts.collectOutput(), stopReason: 'aborted' }
    // Flatten post-publication transport failures while preserving diagnostics.
    try {
      parts.onError?.(toError(error), 'error')
    } catch {
      // The diagnostic sink cannot reject the run result.
    }
    const collected = parts.collectDiagnostic?.()
    const diagnostic = collected === undefined
      ? undefined
      : limitSubagentDiagnostic(collected)
    return {
      output: parts.collectOutput(),
      ...diagnostic === undefined ? {} : { diagnostic },
      stopReason: 'error',
    }
  } finally {
    parts.signal.removeEventListener('abort', parts.onAbort)
  }
}

/** Inputs to {@link subprocessRunHandle}. */
// 中文：subprocessRunHandle 的输入：父作用域运行 ID、永不 reject 的结果、取消信号
// 及其监听器、本地取消结算器、以及后端自带的"拆解到静默"流程。
export interface SubprocessRunHandleParts {
  /** The parent-scoped run id. */
  id: SubagentRun['id']
  /** The flattened, never-rejecting result (the seam contract). */
  result: Promise<SubagentResult>
  /** The request's cancellation signal (the listener is removed on dispose). */
  signal: AbortSignal
  /** The abort listener registered on {@link signal} at start. */
  onAbort: () => void
  /** Settle local cancellation so {@link result} resolves without the child. */
  requestCancel: () => void
  /** Tear the child process down to quiescence (backend-owned ladder). */
  teardown: () => Promise<void>
}

/**
 * Publish the seam run handle for an out-of-process child. `dispose()` is
 * idempotent (one memoized teardown): it removes the abort listener, settles
 * local cancellation — there is no assumption the child cooperates — and then
 * awaits the backend's teardown to actual exit.
 * @param parts - the run identity, result, cancellation wiring, and teardown.
 * @returns the seam run handle (`localAgent` is `undefined` for remote runs).
 */
// 中文：发布进程外子代理的运行句柄：dispose() 幂等——只执行一次"移除 abort 监听 →
// 结算本地取消 → 等待后端 teardown 到真正退出"的记忆化流程。
export function subprocessRunHandle(parts: SubprocessRunHandleParts): SubagentRun {
  let disposal: Promise<void> | undefined
  return {
    id: parts.id,
    localAgent: undefined,
    result: parts.result,
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal
      parts.signal.removeEventListener('abort', parts.onAbort)
      parts.requestCancel()
      disposal = parts.teardown()
      return disposal
    },
  }
}
