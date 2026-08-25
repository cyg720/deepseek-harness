/**
 * Shared remote-control helpers for the E2B subprocess adapter: SDK option
 * shaping, poll ticks, and the one tolerant process-group signal used by both
 * the ordinary-process and terminal teardown ladders.
 */
/**
 * 文件职责：实现E2B 远程沙箱的 remote.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { CommandExitError, e2bControlEnvs, SandboxNotFoundError } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'

/**
 * Normalize an unknown rejection into an Error.
 * @param error - Any thrown or rejected value.
 * @returns The value itself when already an Error, else a stringified wrapper.
 */
/** 中文说明：函数 asError 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Shape the optional-signal SDK options object.
 * @param signal - Optional cancellation for one SDK request.
 * @returns An options fragment that omits an undefined signal.
 */
/** 中文说明：函数 signalOpts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function signalOpts(signal: AbortSignal | undefined): { signal?: AbortSignal } {
  return signal === undefined ? {} : { signal }
}

/**
 * Shape control-shell command options with the isolated HOME override.
 * @param envs - Explicit environment entries for the control command.
 * @param signal - Optional cancellation for the SDK request.
 * @returns Options for `sandbox.commands.run` control invocations.
 */
/** 中文说明：函数 commandOpts 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function commandOpts(
  envs: Record<string, string>,
  signal?: AbortSignal,
): { envs: Record<string, string>; signal?: AbortSignal } {
  return { envs: e2bControlEnvs(envs), ...signalOpts(signal) }
}

/**
 * Resolve after one duration.
 * @param ms - Milliseconds to wait.
 * @returns Settles after the timeout.
 */
/** 中文说明：函数 delay 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Wait one poll interval or until the signal aborts.
 * @param pollMs - Poll cadence in milliseconds.
 * @param signal - Optional abort that ends the wait early.
 * @returns `true` after a full tick, `false` when aborted first.
 */
/** 中文说明：函数 waitTick 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export function waitTick(pollMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted === true) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    /** 中文说明：运行时局部值 timer，由紧邻初始化决定。 */
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, pollMs)
    /** 中文说明：运行时局部值 onAbort，由紧邻初始化决定。 */
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Signal remote process groups, tolerating the shared teardown outcomes: a
 * nonzero `kill` (groups already gone) and a disappeared sandbox. Both the
 * pgid-keyed process ladder and the sid-keyed terminal ladder deliver signals
 * through this single tolerance so they cannot drift apart.
 * @param sandbox - Live SDK handle.
 * @param envs - Control-shell environment entries.
 * @param groups - Positive process-group ids to signal.
 * @param signal - `TERM` or `KILL`.
 */
/** 中文说明：函数 signalRemoteGroups 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
export async function signalRemoteGroups(
  sandbox: Sandbox,
  envs: Record<string, string>,
  groups: readonly number[],
  signal: 'TERM' | 'KILL',
): Promise<void> {
  // TODO(e2b-pgid-identity): Prefer an atomic identity-bound group signal if E2B adds one;
  // a userspace identity precheck cannot close the numeric-PGID reuse race.
  try {
    await sandbox.commands.run(
      `kill -${signal} -- ${groups.map(group => `-${group}`).join(' ')}`,
      commandOpts(envs),
    )
  } catch (error: unknown) {
    if (!(error instanceof CommandExitError) && !(error instanceof SandboxNotFoundError)) throw error
  }
}
