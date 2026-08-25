/**
 * Projection from the shared managed-process handle to the official Claude
 * Agent SDK's custom-spawn process interface.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/process
 */
/**
 * 文件职责：实现 process.ts 覆盖的子代理进程与协议行为与生命周期。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、文件存储或受控子进程协议。
 * 产品维度：保障 Agent 的子代理进程与协议能力稳定、安全且可诊断。
 * 逻辑维度：准备或解析输入，执行核心流程，再处理结果、错误与资源清理。
 * 关键边界：外部进程和持久化数据不可信；敏感环境需净化；清理必须等待资源完全停止。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注协议错误、恢复和清理。
 */

import { EventEmitter } from 'node:events'
import type {
  SpawnedProcess,
  SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import {
  scrubbedParentEnv,
  /** 中文说明：type SubprocessHandle 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessHandle,
  /** 中文说明：type SubprocessOutcome 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessOutcome,
  /** 中文说明：type SubprocessSpawnSpec 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** 中文说明：函数 thrown 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
function thrown(value: unknown): Error {
  /* v8 ignore next -- the subprocess seam rejects with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Encode the SDK's complete child environment as a subprocess overlay.
 * @param env - SDK-composed child environment after its removals and replacements.
 * @returns explicit values plus tombstones for surviving ambient names the SDK removed.
 */
/** 中文说明：函数 sdkEnvironmentOverlay 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function sdkEnvironmentOverlay(
  env: SpawnOptions['env'],
): NodeJS.ProcessEnv {
  /** 中文说明：变量 overlay 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const overlay: NodeJS.ProcessEnv = { ...env }
  /** 中文说明：该循环依次处理输入数据；循环变量仅在当前循环中有效。 */
  for (const name of Object.keys(scrubbedParentEnv())) {
    if (!(name in env)) overlay[name] = undefined
  }
  return overlay
}

/**
 * Translate one official SDK spawn request to the shared process owner.
 * @param options - command, arguments, workspace, environment, and forwarded signal from the SDK.
 * @param graceMs - process-tree termination grace.
 * @returns the fully explicit shared subprocess request.
 */
/** 中文说明：函数 claudeSpawnSpec 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function claudeSpawnSpec(
  options: SpawnOptions,
  graceMs: number,
): SubprocessSpawnSpec {
  if (options.cwd === undefined || options.cwd.length === 0) {
    throw new Error('subagent-claude-code: SDK spawn request omitted its workspace')
  }
  return {
    argv: [options.command, ...options.args],
    cwd: options.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs,
    signal: options.signal,
    env: sdkEnvironmentOverlay(options.env),
  }
}

/**
 * SDK-facing view of one shared managed process. Protocol transport remains
 * in the official SDK; this adapter only projects streams and exit events.
 */
/** 中文说明：class ManagedClaudeCodeProcess 定义本模块所需的数据或行为，用于表达子代理进程与协议场景。 */
export class ManagedClaudeCodeProcess implements SpawnedProcess {
  readonly stdin
  readonly stdout
  private readonly events = new EventEmitter()
  private outcomeValue: SubprocessOutcome | undefined
  private killRequested = false

  /**
   * Project a managed process with piped stdin and stdout.
   * @param child - shared handle that remains the process-tree authority.
   */
  constructor(private readonly child: SubprocessHandle) {
    this.stdin = child.stdin as NonNullable<SubprocessHandle['stdin']>
    this.stdout = child.stdout as NonNullable<SubprocessHandle['stdout']>
    // EventEmitter gives `error` special throw semantics without a listener.
    // The SDK attaches its listener synchronously after custom spawn returns,
    // while this no-op also contains an already-rejected spawn handle.
    this.events.on('error', () => {})
    void child.done.then(
      (outcome) => {
        this.outcomeValue = outcome
        this.events.emit('exit', outcome.exitCode, outcome.signal)
      },
      (error: unknown) => {
        this.events.emit('error', thrown(error))
      },
    )
  }

  /** Whether the SDK has requested managed tree termination. */
  get killed(): boolean {
    return this.killRequested
  }

  /** Direct-child exit code, or null while running or after signal exit. */
  get exitCode(): number | null {
    return this.outcomeValue?.exitCode ?? null
  }

  /** Direct-child terminating signal, if any. */
  get signalCode(): NodeJS.Signals | null {
    return this.outcomeValue?.signal ?? null
  }

  /** Exact managed-process outcome after exit, or undefined while running. */
  get outcome(): SubprocessOutcome | undefined {
    return this.outcomeValue
  }

  /**
   * Route the SDK's termination request to the tree-scoped process owner.
   * @param _signal - SDK-selected signal; the shared seam owns its escalation ladder.
   * @returns false only after exit or a previous termination request.
   */
  kill(_signal: NodeJS.Signals): boolean {
    if (
      this.killRequested
      || this.outcomeValue !== undefined
    ) {
      return false
    }
    this.killRequested = true
    this.child.terminate()
    return true
  }

  /** Register a persistent process lifecycle listener. */
  on(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.on(event, listener)
  }

  /** Register a one-shot process lifecycle listener. */
  once(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.once(event, listener)
  }

  /** Remove a process lifecycle listener. */
  off(
    event: 'exit' | 'error',
    listener: ((code: number | null, signal: NodeJS.Signals | null) => void)
      | ((error: Error) => void),
  ): void {
    this.events.off(event, listener)
  }
}
