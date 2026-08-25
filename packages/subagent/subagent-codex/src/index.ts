/**
 * Profile-named Codex one-shot subagent provider. Every accepted run starts a
 * fresh official package-local Codex wrapper with `app-server --stdio` in the
 * delegating Session's workspace and publishes only after an ephemeral thread exists.
 *
 * @module @deepseek-ai/dsh-subagent-codex
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
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  /** 中文说明：type ResolvedSubagentStartRequest 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type ResolvedSubagentStartRequest,
  /** 中文说明：type SubagentCapabilities 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentCapabilities,
  /** 中文说明：type SubagentProvider 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_DISPOSE_GRACE_MS,
  codexStartupFailure,
  startCodexRun,
  /** 中文说明：type CodexPermissionMode 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type CodexPermissionMode,
  /** 中文说明：type CodexRunSpec 定义本模块所需的数据或行为，用于表达子代理场景。 */
  type CodexRunSpec,
} from './run.ts'

/** 中文说明：变量 name 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const name = 'subagent-codex'
/** 中文说明：变量 inject 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const inject = ['subagents', 'subprocess']

/** 中文说明：常量 DEFAULT_PROVIDER_NAME 保存本模块共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const DEFAULT_PROVIDER_NAME = 'codex'

/** Deployment-owned permission, environment, and process-release settings. */
/** 中文说明：interface Config 定义本模块所需的数据或行为，用于表达子代理场景。 */
export interface Config {
  /** Provider name on `ctx.subagents` (default `codex`). */
  providerName?: string
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Native non-interactive permission mode fixed for this Provider instance. */
  permissionMode?: CodexPermissionMode
  /** Grace in milliseconds for app-server process-tree termination. */
  disposeGraceMs?: number
}

/** 中文说明：变量 Config 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  env: z.dict(z.string()).default({}),
  permissionMode: z.union([...CODEX_PERMISSION_MODES])
    .default(DEFAULT_CODEX_PERMISSION_MODE),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

/** 中文说明：type ResolvedConfig 定义本模块所需的数据或行为，用于表达子代理场景。 */
type ResolvedConfig = Required<Config>

/** 中文说明：class CodexProvider 定义本模块所需的数据或行为，用于表达子代理场景。 */
class CodexProvider implements SubagentProvider {
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  start(request: ResolvedSubagentStartRequest) {
    /** 中文说明：变量 parentCwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        'subagent-codex: no working directory for the child — delegate from a parent session that has one',
      )
    }
    /** 中文说明：变量 cwd 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let cwd: string
    try {
      cwd = resolveChildCwd(
        'subagent-codex',
        undefined,
        parentCwd,
      )
    } catch (error: unknown) {
      if (request.signal.aborted) {
        throw new Error(
          'subagent-codex: request was aborted before app-server startup',
        )
      }
      throw codexStartupFailure(error)
    }
    /** 中文说明：变量 spec 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const spec: CodexRunSpec = {
      cwd,
      permissionMode: this.config.permissionMode,
      env: this.config.env,
      disposeGraceMs: this.config.disposeGraceMs,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`,
        )
      },
    }
    return startCodexRun(request, spec)
  }
}

/**
 * Register one Profile-named Codex provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - registry name, permission mode, child environment, and disposal grace.
 */
/** 中文说明：函数 apply 承担本模块的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本模块调用。 */
export function apply(ctx: Context, config: Config): void {
  /** 中文说明：变量 resolved 保存本模块当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    env: config.env as Record<string, string>,
    permissionMode: config.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE,
    disposeGraceMs: config.disposeGraceMs as number,
  }
  assertPositiveFinite(
    'subagent-codex',
    'disposeGraceMs',
    resolved.disposeGraceMs,
  )
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  ctx.subagents.registerProvider(new CodexProvider(
    resolved.providerName,
    ctx,
    resolved,
  ))
}
