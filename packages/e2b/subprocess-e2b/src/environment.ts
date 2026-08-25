/** Shared remote-environment scrubbing for E2B process and terminal launchers. */
/*
 * 文件职责：实现E2B 远程沙箱的 environment.ts 模块。
 * 技术维度：TypeScript、Cordis、异步资源生命周期、远程文件/进程接口和 Vitest。
 * 产品维度：保证E2B 远程沙箱在真实组装、失败和清理场景中可靠。
 * 逻辑维度：注册能力，转换请求并管理远程资源。
 * 关键边界：凭据不得泄漏；远程句柄、终端和后台进程必须在取消或卸载时释放。
 * 新手阅读建议：先读接口和夹具，再按创建、操作、错误和清理流程阅读。
 */

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { e2bControlEnvs } from '@deepseek-ai/dsh-e2b'
import type { Sandbox } from '@deepseek-ai/dsh-e2b'
import { SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'

/** 中文说明：运行时局部值 BASE64，由紧邻初始化决定。 */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** 中文说明：函数 remoteEnvironmentEntries 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function remoteEnvironmentEntries(raw: string): Array<readonly [string, string]> {
  /** 中文说明：运行时局部值 entries，由紧邻初始化决定。 */
  const entries: Array<readonly [string, string]> = []
  /** 中文说明：运行时局部值 entry，由紧邻初始化决定。 */
  for (const entry of raw.split('\0')) {
    if (entry.length === 0) continue
    /** 中文说明：运行时局部值 separator，由紧邻初始化决定。 */
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    entries.push([entry.slice(0, separator), entry.slice(separator + 1)])
  }
  return entries
}

/**
 * Read the remote environment through ASCII base64 so SDK callback chunking cannot corrupt UTF-8.
 * @param sandbox - shared E2B execution world.
 * @param signal - optional cancellation for the control-plane request.
 * @returns the complete NUL-delimited UTF-8 environment.
 */
/*
 * 中文说明：函数 readRemoteEnvironment 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param sandbox 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param signal 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export async function readRemoteEnvironment(sandbox: Sandbox, signal?: AbortSignal): Promise<string> {
  // TODO(e2b-replace-environment): Remove this ambient probe when E2B can start
  // a command with a replacement environment instead of merged overrides.
  /** 中文说明：运行时局部值 result，由紧邻初始化决定。 */
  const result = await sandbox.commands.run(
    'set -o pipefail; dsh_e2b_passwd="$(getent passwd "$(id -u)")"; IFS=: read -r _ _ _ _ _ dsh_e2b_home _ <<<"$dsh_e2b_passwd"; test -n "$dsh_e2b_home" -a -d "$dsh_e2b_home"; printf \'%s\' "$dsh_e2b_home" | base64 -w 0; printf \'\\n\'; env -0 | base64 -w 0',
    { envs: e2bControlEnvs(), ...(signal === undefined ? {} : { signal }) },
  )
  /** 中文说明：运行时局部值 lines，由紧邻初始化决定。 */
  const lines = result.stdout.trim().split('\n')
  if (lines.length !== 2 || !lines.every(line => BASE64.test(line))) {
    throw new Error('subprocess-e2b: remote environment transport returned invalid base64')
  }
  /** 中文说明：运行时局部值 解构结果，由紧邻初始化决定。 */
  const [encodedHome, encodedEnvironment] = lines as [string, string]
  /** 中文说明：运行时局部值 home: string，由紧邻初始化决定。 */
  let home: string
  /** 中文说明：运行时局部值 raw: string，由紧邻初始化决定。 */
  let raw: string
  try {
    /** 中文说明：运行时局部值 decoder，由紧邻初始化决定。 */
    const decoder = new TextDecoder('utf-8', { fatal: true })
    home = decoder.decode(Buffer.from(encodedHome, 'base64'))
    raw = decoder.decode(Buffer.from(encodedEnvironment, 'base64'))
  } catch (error: unknown) {
    throw new Error('subprocess-e2b: remote environment is not valid UTF-8', { cause: error })
  }
  if (!posix.isAbsolute(home) || home.includes('\0')) {
    throw new Error(`subprocess-e2b: remote login home is invalid: ${JSON.stringify(home)}`)
  }
  /** 中文说明：运行时局部值 environment，由紧邻初始化决定。 */
  const environment = new Map(remoteEnvironmentEntries(raw))
  environment.set('HOME', home)
  return [...environment].map(([name, value]) => `${name}=${value}\0`).join('')
}

/**
 * Parse an E2B NUL-delimited environment while removing harness-private and credential-shaped names.
 * @param raw - The complete NUL-delimited remote environment.
 * @returns Mutable retained entries for the caller to overlay and serialize.
 */
/*
 * 中文说明：函数 scrubRemoteEnvironment 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param raw 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function scrubRemoteEnvironment(raw: string): Map<string, string> {
  /** 中文说明：运行时局部值 environment，由紧邻初始化决定。 */
  const environment = new Map<string, string>()
  /** 中文说明：运行时局部值 [name，由紧邻初始化决定。 */
  for (const [name, value] of remoteEnvironmentEntries(raw)) {
    if (name.startsWith('DSH_') || SENSITIVE_ENV_PATTERN.test(name)) continue
    environment.set(name, value)
  }
  return environment
}

/**
 * Isolate E2B's fixed login-shell bootstrap from user profiles and ambient credentials.
 * @param raw - The complete NUL-delimited remote environment.
 * @returns Explicit E2B command or PTY overrides for bootstrap-shell startup.
 */
/*
 * 中文说明：函数 bootstrapEnvironment 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param raw 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function bootstrapEnvironment(raw: string): Record<string, string> {
  /** 中文说明：运行时局部值 environment，由紧邻初始化决定。 */
  const environment: Record<string, string> = { TERM: 'dumb' }
  /** 中文说明：运行时局部值 [name]，由紧邻初始化决定。 */
  for (const [name] of remoteEnvironmentEntries(raw)) {
    if (name.startsWith('DSH_') || SENSITIVE_ENV_PATTERN.test(name)) environment[name] = ''
  }
  return environment
}

/**
 * Overlay explicit entries and serialize one validated E2B environment.
 * @param raw - The complete NUL-delimited remote environment.
 * @param explicit - Deliberate caller overrides applied after ambient scrubbing; an `undefined` tombstone removes an ambient entry.
 * @returns NUL-delimited `name=value` entries accepted by `env -i`.
 */
/*
 * 中文说明：函数 serializeRemoteEnvironment 的参数见签名，返回结果供相邻流程使用；示例见本文件。
 * @param raw 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @param explicit 中文说明：该参数的用途和取值约束见函数签名及调用上下文。
 * @returns 中文说明：返回值的类型和用途见函数签名，供调用方继续处理。
 */
export function serializeRemoteEnvironment(
  raw: string,
  explicit: Readonly<NodeJS.ProcessEnv> | undefined,
): string {
  /** 中文说明：运行时局部值 environment，由紧邻初始化决定。 */
  const environment = scrubRemoteEnvironment(raw)
  /** 中文说明：运行时局部值 [name，由紧邻初始化决定。 */
  for (const [name, value] of Object.entries(explicit ?? {})) {
    if (name.length === 0 || name.includes('=') || name.includes('\0') || value?.includes('\0') === true) {
      throw new Error('subprocess-e2b: environment entries require non-empty NUL-free names without = and NUL-free values')
    }
    // An explicit undefined is the seam's tombstone: remove the ambient entry.
    if (value === undefined) environment.delete(name)
    else environment.set(name, value)
  }
  return [...environment].map(([name, value]) => `${name}=${value}\0`).join('')
}
