/** Restricted-token adapters over the shared Win32 process owner. */

import {
  spawnInheritedJobProcess,
  spawnPipedProcess,
  waitForProcessExit,
} from '@deepseek-ai/dsh-win32-process'
import type {
  NativePtr,
  SpawnedJobProcess,
  SpawnedPipedProcess,
} from '@deepseek-ai/dsh-win32-process'
import type { Win32Bindings } from './ffi.ts'

export { drainPipe } from '@deepseek-ai/dsh-win32-process'

/** Restricted-token child with piped stdio resources. */
export interface SpawnedNative extends SpawnedPipedProcess {}
/** Restricted-token child assigned to a kill-on-close Job. */
export interface SpawnedInherited extends SpawnedJobProcess {}

/**
 * Spawn a restricted-token child with piped stdout/stderr.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and caller-owned pipe handles.
 */
/*
 * 中文说明：函数 spawnSandboxed 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param api 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param token 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function spawnSandboxed(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string },
): SpawnedNative {
  return spawnPipedProcess(api, { ...options, token })
}

/**
 * Spawn a restricted-token child in a kill-on-close Job with inherited stdio.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and Job handles after assignment and resume.
 */
/*
 * 中文说明：函数 spawnSandboxedInherited 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。
 * @param api 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param token 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param options 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function spawnSandboxedInherited(
  api: Win32Bindings,
  token: NativePtr,
  options: { command: string; args: readonly string[]; cwd: string },
): SpawnedInherited {
  return spawnInheritedJobProcess(api, { ...options, token })
}

/**
 * Wait for a restricted child and close its process handle.
 * @param api - ACL/token binding table.
 * @param process - caller-owned process handle.
 * @returns direct process exit code.
 */
export function waitForExit(api: Win32Bindings, process: NativePtr): number {
  return waitForProcessExit(api, process)
}
