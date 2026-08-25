/**
 * Out-of-process SDK subagent backend. Each child is a complete DeepSeek
 * Harness runtime in its own process — own `cordis.yml`-decided composition,
 * session, model route, and tools — driven over stdio JSON-RPC through the
 * TypeScript SDK client, so it shares no Cordis context and advertises no
 * parent-enforced start capabilities; the ONE thing it reads off
 * `request.parent` is the session's workspace cwd. This plugin uses named
 * exports only; a default would hide its loader metadata (see
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @deepseek-ai/dsh-subagent-dsh-sdk
 */
/**
 * 文件职责：实现 index.ts 覆盖的子代理启动、协议、继承与生命周期行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、进程协议或同进程代理驱动。
 * 产品维度：保障 Agent 能可靠委派任务、继承上下文并收集子代理结果。
 * 逻辑维度：准备代理配置，启动或连接子代理，转发事件，再处理结果、取消与清理。
 * 关键边界：异步状态不等于单次任务结果；外部输出不可信；清理必须等待子代理完全停止。
 * 新手阅读建议：先看公开配置和测试夹具，再读启动/事件流程，最后关注继承、取消与失败路径。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubagentCapabilities, SubagentProvider, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { assertPositiveFinite, NO_START_CAPABILITIES, resolveChildCwd, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent'
import {
  DEFAULT_DISPOSE_EOF_GRACE_MS,
  DEFAULT_DISPOSE_GRACE_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  startSdkRun,
  /** 中文说明：type SdkRunSpec 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SdkRunSpec,
} from './run.ts'

/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'subagent-dsh-sdk'
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['subagents']

/** Config: how to spawn and drive the child SDK runtime process. */
/** 中文说明：interface Config 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dsh-sdk`). */
  providerName: string
  /** The executable to spawn for each run (the child runtime bin or packaged exe). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /**
   * Working directory override for the child process and its SDK session
   * workspace. Must be non-empty; a relative path resolves against the
   * harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child inherits its delegating parent
   * session's cwd — and starting one from a parent session that has no cwd
   * fails.
   */
  cwd?: string
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG` naming its
   * config. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}

/** 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  providerName: z.string().default('dsh-sdk'),
  command: z.string().required(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  provider: z.string().default('deepseek-official'),
  model: z.string().default('deepseek-v4-flash'),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  env: z.dict(z.string()).default({}),
  shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
  disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** The shape after schemastery applied the defaults (`cwd` and `maxTokens` have none). */
/** 中文说明：type ResolvedConfig 定义本模块所需的数据或行为，用于表达子代理场景。 */
type ResolvedConfig = Required<Omit<Config, 'cwd' | 'maxTokens'>> & Pick<Config, 'cwd' | 'maxTokens'>

/**
 * The SDK provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `outputSchema`/`maxDepth`/`toolFilter`/`persona` (the
 * service rejects a request needing any of them before `start` runs).
 */
/** 中文说明：class SdkSubagentProvider 定义本模块所需的数据或行为，用于表达子代理场景。 */
class SdkSubagentProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  // Context contract: an out-of-process SDK child starts fresh — no parent conversation crosses the process boundary.
  readonly inheritsParentContext = false

  constructor(readonly name: string, private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  start(request: SubagentStartRequest) {
    /** 中文说明：变量 spec 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: SdkRunSpec = {
      command: this.config.command,
      args: this.config.args,
      cwd: resolveChildCwd('subagent-dsh-sdk', this.config.cwd, request.parent.session.header.cwd),
      provider: this.config.provider,
      model: this.config.model,
      ...this.config.maxTokens === undefined ? {} : { maxTokens: this.config.maxTokens },
      env: this.config.env,
      shutdownTimeoutMs: this.config.shutdownTimeoutMs,
      disposeEofGraceMs: this.config.disposeEofGraceMs,
      disposeGraceMs: this.config.disposeGraceMs,
      onError: (error, stopReason) => {
        // The seam forbids `result` rejecting, so a child-level failure is
        // flattened to a stop reason — preserve it here rather than losing it.
        this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`)
      },
    }
    return startSdkRun(request, spec)
  }
}

/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  /** 中文说明：变量 resolved 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolved = config as ResolvedConfig
  assertPositiveFinite('subagent-dsh-sdk', 'shutdownTimeoutMs', resolved.shutdownTimeoutMs)
  assertPositiveFinite('subagent-dsh-sdk', 'disposeEofGraceMs', resolved.disposeEofGraceMs)
  assertPositiveFinite('subagent-dsh-sdk', 'disposeGraceMs', resolved.disposeGraceMs)
  if (resolved.maxTokens !== undefined && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) {
    throw new TypeError('subagent-dsh-sdk maxTokens must be a positive safe integer')
  }
  // Interpret a relative configured cwd against the harness launch directory
  // ONCE, at load, and fail a misconfigured directory here — not per start.
  /** 中文说明：变量 configuredCwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const configuredCwd = validateConfiguredCwd('subagent-dsh-sdk', resolved.cwd)
  /** 中文说明：变量 validated 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const validated: ResolvedConfig = configuredCwd === undefined
    ? resolved
    : { ...resolved, cwd: configuredCwd }
  ctx.subagents.registerProvider(new SdkSubagentProvider(validated.providerName, ctx, validated))
}
