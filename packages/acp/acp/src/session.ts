/** One standard ACP session's Agent, configuration, prompt, update, and teardown lifecycle.
 * @remarks 文件说明：文件职责：实现 acp/acp 中 session 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 acp/acp 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import {
  RequestError,
  type McpServer,
  type PromptRequest,
  type PromptResponse,
  type SessionConfigOption,
  type SessionNotification,
  type StopReason,
} from '@agentclientprotocol/sdk'
import type { Agent, AgentHandle, AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage, errorChain, type UserMessage } from '@deepseek-ai/dsh-llm'
import { type Session, type SessionEvent, type SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { AcpContentError, admitAcpPrompt } from './content.ts'
import { turnEndToStopReason } from './codec.ts'
import { mountAcpMcpServers } from './mcp.ts'
import { AcpModelControl } from './model-control.ts'
import { assistantUpdates, toolCallUpdate, toolResultUpdate } from './updates.ts'

/** The continuable-subagent teardown used without depending on the subagent package. */
interface ContinuableDrain {
  /** Dispose continuable descendants below exact host-owned parents child-first.
   * @remarks 中文说明：功能说明：处理 drainContinuableDescendants 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：parents（readonly Agent[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * drainContinuableDescendants(parents)，并按返回类型处理结果。 */
  drainContinuableDescendants(parents: readonly Agent[]): Promise<void>
}

/** Inputs shared by fresh and resumed ACP session construction. */
interface AcpSessionBuildOptions {
  cwd: string
  mcpServers: readonly McpServer[]
  agentOptions: AgentOptions
  fallbackSelection: ModelSelection | undefined
  signal: AbortSignal
  notify: (notification: SessionNotification) => Promise<void>
}

/** Fresh ACP session construction inputs. */
export interface CreateAcpSessionOptions extends AcpSessionBuildOptions {
  sessionId: SessionId
}

/** Persisted ACP session construction inputs. */
export interface ResumeAcpSessionOptions extends AcpSessionBuildOptions {
  sessionId: SessionId
}

interface InflightPrompt {
  resolve: (reason: StopReason) => void
  reject: (error: Error) => void
  messageId: string | undefined
  messageQueued: boolean
  turn: number | undefined
  endReason: TurnEndReason | undefined
  admissionDone: Promise<void>
  finishAdmission: () => void
  admissionController: AbortController
  cancelRequested: boolean
  settlementStarted: boolean
  outputError: Error | undefined
  agentError: Error | undefined
}

/** Standard invalid-parameter failure with protocol-safe detail.
 * @remarks 中文说明：功能说明：处理 invalidParams 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：detail（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RequestError；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 invalidParams(detail)，
 * 并按返回类型处理结果。 */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Standard internal failure with protocol-safe detail.
 * @remarks 中文说明：功能说明：处理 internalError 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：detail（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：RequestError；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 internalError(detail)，
 * 并按返回类型处理结果。 */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** Restore the latest logged route before falling back to deployment config.
 * @remarks 中文说明：功能说明：处理 selectionFor 相关流程；使用场景由所在模块及调用位置决定。；参数说明：logged（{
 * config: { provider: string; model: string; reasoningEffor…）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：fallback（ModelSelection | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：ModelSelection | undefined；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 selectionFor(logged, fallback)，
 * 并按返回类型处理结果。 */
function selectionFor(
  logged: {
    config: { provider: string; model: string; reasoningEffort?: ModelSelection['reasoningEffort'] }
    adapterDefaults?: { reasoningEffort?: boolean }
  } | undefined,
  fallback: ModelSelection | undefined,
): ModelSelection | undefined {
  return logged === undefined
    ? fallback
    : {
      provider: logged.config.provider,
      model: logged.config.model,
      ...logged.config.reasoningEffort === undefined || logged.adapterDefaults?.reasoningEffort === true
        ? {}
        : { reasoningEffort: logged.config.reasoningEffort },
    }
}

/**
 * Per-session ACP module. It owns the unpublished Agent composition, selected
 * route, one-prompt admission slot, ordered standard updates, and memoized
 * quiescent teardown.
 * @remarks 中文说明：类说明：AcpSession 用于集中封装 处理 AcpSession 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 acp/acp 在对应插件或业务生命周期内创建和调用。
 */
export class AcpSession {
  /** The exact top-level Agent owned by this ACP session.
   * @remarks 中文说明：常量说明：agent 用于处理 agent 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。 */
  readonly agent: Agent
  /**
   * 常量说明：modelControl 用于处理 modelControl 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly modelControl: AcpModelControl
  /**
   * 变量说明：outputTail 用于处理 outputTail 相关数据，作用于成员；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  private outputTail = Promise.resolve()
  /**
   * 变量说明：inflight 用于处理 inflight 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private inflight: InflightPrompt | undefined
  /**
   * 变量说明：closing 用于处理 closing 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  private closing: Promise<void> | undefined
  /**
   * 常量说明：pendingSelections 用于处理 pendingSelections 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly pendingSelections = new Map<string, ModelSelection>()

  /**
   * 功能说明：处理 AcpSession 相关流程；使用场景由所在模块及调用位置决定。
   * @param ctx （Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
   * @param handle （AgentHandle）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param modelControl （AcpModelControl）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param notify （(notification: SessionNotification) =>
   * Promise<void>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new AcpSession(ctx, handle, modelControl, notify) 创建实例，
   * 并在所属生命周期内使用。
   */
  private constructor(
    private readonly ctx: Context,
    handle: AgentHandle,
    modelControl: AcpModelControl,
    private readonly notify: (notification: SessionNotification) => Promise<void>,
  ) {
    this.agent = handle.agent
    this.modelControl = modelControl
    this.disposeAgent = /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => handle.dispose()
  }

  /**
   * 常量说明：disposeAgent 用于处理 disposeAgent 相关数据，作用于成员；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  private readonly disposeAgent: () => Promise<void>

  /**
   * Compose a fresh Agent and all requested MCP clients before publication.
   * @param ctx - ACP plugin context with Agent, LLM, and persistence services.
   * @param options - fresh session identity, workspace, route, MCP, and notifier.
   * @returns the fully composed per-session module.
   * @remarks 中文说明：功能说明：创建 create 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（CreateAcpSessionOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<AcpSession>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * create(ctx, options)，并按返回类型处理结果。
   */
  static async create(ctx: Context, options: CreateAcpSessionOptions): Promise<AcpSession> {
    /**
     * 常量说明：modelControl 用于处理 modelControl 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const modelControl = new AcpModelControl(ctx.llm, options.fallbackSelection)
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = await ctx.agents.create({
      sessionId: options.sessionId,
      meta: { cwd: options.cwd },
      agentOptions: options.agentOptions,
      signal: options.signal,
      setup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
 */ async (agentCtx) => {
        modelControl.install(agentCtx)
        await mountAcpMcpServers(agentCtx, options.mcpServers, options.cwd)
      },
    })
    return new AcpSession(ctx, handle, modelControl, options.notify)
  }

  /**
   * Restore a persisted Agent and compose the request's fresh MCP connections.
   * @param ctx - ACP plugin context with Agent, LLM, and persistence services.
   * @param options - persisted identity, workspace, fallback route, MCP, and notifier.
   * @returns the restored per-session module.
   * @remarks 中文说明：功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：options（ResumeAcpSessionOptions）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<AcpSession>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * resume(ctx, options)，并按返回类型处理结果。
   */
  static async resume(ctx: Context, options: ResumeAcpSessionOptions): Promise<AcpSession> {
    /**
     * 变量说明：modelControl 用于处理 modelControl 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let modelControl: AcpModelControl | undefined
    /**
     * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const handle = await ctx.agents.resume({
      resumeSessionId: options.sessionId,
      agentOptions: options.agentOptions,
      signal: options.signal,
      setup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
 */ async (agentCtx) => {
        /**
         * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const agent = agentCtx.agent
        /* v8 ignore next -- Agent factory setup always carries its unpublished Agent. */
        if (agent === undefined) throw new Error('acp: resumed Agent is absent during setup')
        modelControl = new AcpModelControl(
          ctx.llm,
          selectionFor(agent.session.requestHeader(), options.fallbackSelection),
        )
        modelControl.install(agentCtx)
        await mountAcpMcpServers(agentCtx, options.mcpServers, options.cwd)
      },
    })
    /* v8 ignore start -- a fulfilled Agent resume necessarily ran setup to completion. */
    if (modelControl === undefined) {
      await handle.dispose()
      throw internalError('session/resume did not compose model selection')
    }
    /* v8 ignore stop */
    return new AcpSession(ctx, handle, modelControl, options.notify)
  }

  /**
   * Whether this module owns an exact Agent reference.
   * @param agent - Agent observed on a scoped runtime event.
   * @returns true only for this session's owned Agent.
   * @remarks 中文说明：功能说明：处理 owns 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 owns(agent)，并按返回类型处理结果。
   */
  owns(agent: Agent): boolean {
    return this.agent === agent
  }

  /**
   * Whether this module owns an exact Session reference.
   * @param session - Session observed on a durable event.
   * @returns true only for this session's owned Session.
   * @remarks 中文说明：功能说明：处理 ownsSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：boolean；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 ownsSession(session)，
   * 并按返回类型处理结果。
   */
  ownsSession(session: Session): boolean {
    return this.agent.session === session
  }

  /**
   * Return the complete standard model configuration state.
   * @param signal - optional request cancellation.
   * @returns provider-grouped model and exact-model reasoning options.
   * @remarks 中文说明：功能说明：处理 configOptions 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionConfigOption[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 configOptions(signal)，并按返回类型处理结果。
   */
  configOptions(signal?: AbortSignal): Promise<SessionConfigOption[]> {
    this.assertActive()
    return this.modelControl.options(signal)
  }

  /**
   * Apply one standard configuration option to later ACP turns.
   * @param configId - advertised standard option id.
   * @param value - selected standard option value.
   * @param signal - optional request cancellation.
   * @returns the complete resulting option state.
   * @remarks 中文说明：功能说明：设置 Config 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：configId（string）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；
   * 参数说明：value（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionConfigOption[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 setConfig(configId, value, signal)，并按返回类型处理结果。
   */
  setConfig(configId: string, value: unknown, signal?: AbortSignal): Promise<SessionConfigOption[]> {
    this.assertActive()
    return this.modelControl.set(configId, value, signal)
  }

  /** Resolve topology state off-chain, then serialize its notification without blocking execution updates.
   * @remarks 中文说明：功能说明：处理 topologyChanged 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 topologyChanged()，
   * 并按返回类型处理结果。 */
  topologyChanged(): void {
    if (this.closing !== undefined) return
    void this.modelControl.options()
      .then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：configOptions（由 TypeScript
 * 根据调用位置推断的类型）：提供本次操作使用的配置选项；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(configOptions)，并按返回类型处理结果。
 */ (configOptions) => {
          if (this.closing !== undefined) return
          /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
          const previous = this.outputTail
          this.outputTail = previous
            .then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => this.notify({
                sessionId: this.agent.session.id,
                update: { sessionUpdate: 'config_option_update', configOptions },
              }))
          /* v8 ignore start -- the bridge notifier contains transport failure. */
            .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
                this.ctx.logger.warn(`acp: config-option update failed: ${errorChain(error)}`)
              })
        /* v8 ignore stop */
        })
      /* v8 ignore start -- option discovery contains per-provider failure. */
      .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
          this.ctx.logger.warn(`acp: config-option update failed: ${errorChain(error)}`)
        })
    /* v8 ignore stop */
  }

  /**
   * Admit, enqueue, and settle one prompt at whole-Agent quiescence.
   * @param params - standard ACP prompt request for this session.
   * @param imageEnabled - connection capability advertised at initialization.
   * @param requestSignal - JSON-RPC request cancellation signal.
   * @returns the correlated standard stop reason after ordered updates drain.
   * @remarks 中文说明：功能说明：处理 prompt 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：params（PromptRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：imageEnabled（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：requestSignal（AbortSignal）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<PromptResponse>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 prompt(params, imageEnabled, requestSignal)，
   * 并按返回类型处理结果。
   */
  async prompt(
    params: PromptRequest,
    imageEnabled: boolean,
    requestSignal?: AbortSignal,
  ): Promise<PromptResponse> {
    this.assertActive()
    if (this.inflight !== undefined) throw invalidParams('a prompt is already in flight for this session')
    /**
     * 常量说明：completion 用于处理 completion 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const completion = Promise.withResolvers<StopReason>()
    /**
     * 常量说明：admission 用于处理 admission 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const admission = Promise.withResolvers<void>()
    /**
     * 常量说明：admissionController 用于处理 admissionController 相关数据，作用于当前作用域；
     * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const admissionController = new AbortController()
    /**
     * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflight: InflightPrompt = {
      resolve: completion.resolve,
      reject: completion.reject,
      messageId: undefined,
      messageQueued: false,
      turn: undefined,
      endReason: undefined,
      admissionDone: admission.promise,
      finishAdmission: admission.resolve,
      admissionController,
      cancelRequested: false,
      settlementStarted: false,
      outputError: undefined,
      agentError: undefined,
    }
    this.inflight = inflight
    /**
     * 常量说明：onRequestAbort 用于响应 Request Abort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     * 功能说明：响应 Request Abort 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 onRequestAbort()，并按返回类型处理结果。
     */
    const onRequestAbort = (): void => { this.cancelPrompt('ACP prompt request cancelled') }
    requestSignal?.addEventListener('abort', onRequestAbort, { once: true })
    /* v8 ignore next -- the SDK dispatches a live signal, then notifies abort through its listener. */
    if (requestSignal?.aborted === true) onRequestAbort()
    try {
      /**
       * 变量说明：admissionFailure 用于处理 admissionFailure 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let admissionFailure: unknown
      /**
       * 常量说明：promptSelection 用于处理 promptSelection 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const promptSelection = this.modelControl.snapshot()
      try {
        if (this.ctx.agents.get(this.agent.id) !== this.agent) {
          throw internalError('prompt was not queued: the agent was disposed outside the bridge')
        }
        /**
         * 常量说明：content 用于处理 content 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const content = await admitAcpPrompt(
          this.ctx,
          promptSelection,
          params.prompt,
          imageEnabled,
          admissionController.signal,
        )
        admissionController.signal.throwIfAborted()
        if (this.ctx.agents.get(this.agent.id) !== this.agent) {
          throw internalError('prompt was not queued: the agent was disposed outside the bridge')
        }
        /**
         * 常量说明：message 用于处理 message 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const message = createUserMessage({
          content,
          source: { kind: 'user' },
        })
        inflight.messageId = message.id
        inflight.messageQueued = true
        if (promptSelection !== undefined) this.pendingSelections.set(message.id, promptSelection)
        try {
          this.agent.followup(message)
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          inflight.messageQueued = false
          this.pendingSelections.delete(message.id)
          throw error
        }
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
        admissionFailure = error
      } finally {
        inflight.finishAdmission()
      }

      if (inflight.cancelRequested) {
        this.settleAfterQuiescence(inflight)
        return { stopReason: await completion.promise }
      }
      if (admissionFailure !== undefined) {
        this.inflight = undefined
        if (admissionFailure instanceof AcpContentError) {
          throw admissionFailure.kind === 'invalid'
            ? invalidParams(admissionFailure.message)
            : internalError(admissionFailure.message)
        }
        if (admissionFailure instanceof RequestError) throw admissionFailure
        throw internalError(`prompt was not queued: ${(admissionFailure as Error).message}`)
      }

      this.settleAfterQuiescence(inflight)
      return { stopReason: await completion.promise }
    } finally {
      requestSignal?.removeEventListener('abort', onRequestAbort)
    }
  }

  /** Cancel the active prompt, or autonomous work when no ACP prompt exists.
   * @remarks 中文说明：功能说明：处理 cancel 相关流程；使用场景由所在模块及调用位置决定。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 cancel()，并按返回类型处理结果。 */
  cancel(): void {
    /**
     * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflight = this.inflight
    this.cancelPrompt('ACP prompt cancelled')
    if (inflight === undefined) this.agent.cancel({ kind: 'user' })
  }

  /**
   * Process one durable event and enqueue its standard ACP projections.
   * @param session - exact event-owning Session.
   * @param event - committed durable event.
   * @remarks 中文说明：功能说明：响应 Session Event 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：event（SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：void；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onSessionEvent(session,
   * event)，并按返回类型处理结果。
   */
  onSessionEvent(session: Session, event: SessionEvent): void {
    try {
      if (event.type === 'assistant/message') {
        /**
         * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const inflight = this.inflight?.turn === event.data.turn ? this.inflight : undefined
        /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const previous = this.outputTail
        /**
         * 常量说明：delivery 用于处理 delivery 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const delivery = previous.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
            for (const /*
           * 变量说明：update 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
           */ update of await assistantUpdates(this.ctx, session, event)) {
              await this.notify({ sessionId: this.agent.session.id, update })
            }
          })
        this.outputTail = delivery.catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
          /**
           * 常量说明：failure 用于处理 failure 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
            const failure = error as Error
            if (inflight !== undefined) inflight.outputError ??= failure
            this.ctx.logger.warn(`acp: assistant output conversion failed: ${errorChain(error)}`)
          })
      } else if (event.type === 'tool/call') {
        /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const previous = this.outputTail
        this.outputTail = previous
          .then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => this.notify({ sessionId: this.agent.session.id, update: toolCallUpdate(event) }))
          /* v8 ignore start -- the bridge notifier contains transport rejection. */
          .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
              this.ctx.logger.warn(`acp: tool-call update delivery failed: ${errorChain(error)}`)
            })
        /* v8 ignore stop */
      } else if (event.type === 'tool/result') {
        /**
         * 常量说明：previous 用于处理 previous 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const previous = this.outputTail
        this.outputTail = previous
          .then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => this.notify({
              sessionId: this.agent.session.id,
              update: await toolResultUpdate(this.ctx, event),
            }))
          /* v8 ignore start -- supplemental-content conversion failure is contained and cannot fail Agent work. */
          .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
              this.ctx.logger.warn(`acp: tool-result update delivery failed: ${errorChain(error)}`)
            })
        /* v8 ignore stop */
      }
    } finally {
      /**
       * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const inflight = this.inflight
      if (inflight !== undefined && event.type === 'turn/end' && inflight.turn === event.data.turn) {
        inflight.endReason = event.data.reason
      }
      if (event.type === 'turn/end') this.modelControl.releaseTurn(event.data.turn)
    }
  }

  /**
   * Correlate an accepted user message with its Agent turn and pinned route.
   * @param message - claimed durable inbox message.
   * @param turn - allocated Agent turn.
   * @remarks 中文说明：功能说明：响应 Inbox Claimed 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：message（UserMessage）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onInboxClaimed(message, turn)，
   * 并按返回类型处理结果。
   */
  onInboxClaimed(message: UserMessage, turn: number): void {
    if (this.inflight !== undefined && this.inflight.messageId === message.id) this.inflight.turn = turn
    /**
     * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selection = this.pendingSelections.get(message.id)
    this.pendingSelections.delete(message.id)
    if (selection !== undefined) this.modelControl.pinTurn(turn, selection)
  }

  /**
   * Correlate an Agent interval failure with the active ACP prompt.
   * @param turn - failed turn number.
   * @param error - original same-process failure.
   * @remarks 中文说明：功能说明：响应 Agent Error 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：turn（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 onAgentError(turn, error)，并按返回类型处理结果。
   */
  onAgentError(turn: number, error: unknown): void {
    /**
     * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflight = this.inflight
    if (inflight === undefined || !inflight.messageQueued) return
    // AgentLoop balances an in-turn failure with durable turn/end; settlement
    // reads that exact error reason. This slot records interval failures outside it.
    if (inflight.turn === turn) return
    inflight.agentError = new Error(errorChain(error))
    this.settleAfterQuiescence(inflight)
  }

  /** Await every update queued before this call.
   * @remarks 中文说明：功能说明：处理 drainUpdates 相关流程；使用场景由所在模块及调用位置决定。；
   * 返回值：Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * drainUpdates()，并按返回类型处理结果。 */
  drainUpdates(): Promise<void> {
    return this.outputTail
  }

  /**
   * Cancel, drain, flush, and dispose this session once.
   * @param detail - cancellation detail for any prompt still in admission.
   * @returns the shared quiescent teardown promise.
   * @remarks 中文说明：功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：detail（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 close(detail)，并按返回类型处理结果。
   */
  close(detail: string): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closing = (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
      /**
       * 常量说明：failures 用于处理 failures 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const failures: unknown[] = []
        /**
       * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const inflight = this.inflight
        this.cancelPrompt(detail)
        if (inflight === undefined || !inflight.messageQueued) this.agent.cancel({ kind: 'user' })
        try {
          await inflight?.admissionDone
          await this.agent.whenIdle()
          await this.outputTail
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          failures.push(new Error('ACP session activity drain failed', { cause: error }))
        }
        /**
       * 常量说明：subagents 用于处理 subagents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const subagents = this.ctx.get('subagents') as ContinuableDrain | undefined
        try {
          await subagents?.drainContinuableDescendants([this.agent])
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          this.ctx.logger.warn(`acp: continuable subagent teardown failed: ${errorChain(error)}`)
          failures.push(new Error('continuable subagent teardown failed', { cause: error }))
        }
        try {
          await this.ctx.sessions.flush(this.agent.session)
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          failures.push(new Error('ACP session persistence flush failed', { cause: error }))
        }
        try {
          await this.disposeAgent()
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          failures.push(error)
        }
        this.pendingSelections.clear()
        if (failures.length === 1) throw failures[0]
        /* v8 ignore start -- independent teardown failures can aggregate only under multiple simultaneous provider faults. */
        if (failures.length > 1) {
          throw new AggregateError(failures, `ACP session teardown failed: ${failures.map(errorChain).join('; ')}`)
        }
      /* v8 ignore stop */
      })()
    return this.closing
  }

  /**
   * 功能说明：断言 Active 相关流程；使用场景由所在模块及调用位置决定。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertActive()，并按返回类型处理结果。
   */
  private assertActive(): void {
    if (this.closing !== undefined) throw invalidParams(`session is closing: ${this.agent.session.id}`)
  }

  /**
   * 功能说明：处理 cancelPrompt 相关流程；使用场景由所在模块及调用位置决定。
   * @param detail （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 cancelPrompt(detail)，并按返回类型处理结果。
   */
  private cancelPrompt(detail: string): void {
    /**
     * 常量说明：inflight 用于处理 inflight 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inflight = this.inflight
    if (inflight === undefined) return
    inflight.cancelRequested = true
    inflight.admissionController.abort(new Error(detail))
    this.settleAfterQuiescence(inflight)
    if (inflight.messageQueued) this.agent.cancel({ kind: 'user' })
  }

  /**
   * 功能说明：处理 settleAfterQuiescence 相关流程；使用场景由所在模块及调用位置决定。
   * @param inflight （InflightPrompt）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 settleAfterQuiescence(inflight)，并按返回类型处理结果。
   */
  private settleAfterQuiescence(inflight: InflightPrompt): void {
    if (inflight.settlementStarted) return
    inflight.settlementStarted = true
    void (/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ async () => {
        await inflight.admissionDone
        if (inflight.messageQueued) {
          await this.agent.whenIdle()
          await this.outputTail
        }
        /* v8 ignore next -- this prompt owns the slot until this exact settlement clears it. */
        if (this.inflight !== inflight) return
        this.inflight = undefined
        if (inflight.cancelRequested) {
          inflight.resolve('cancelled')
          return
        }
        if (inflight.outputError !== undefined) {
          inflight.reject(internalError(`assistant output delivery failed: ${inflight.outputError.message}`))
          return
        }
        if (inflight.agentError !== undefined) {
          inflight.reject(internalError(`turn failed: ${inflight.agentError.message}`))
          return
        }
        /**
       * 常量说明：end 用于处理 end 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const end = inflight.endReason
        if (end === undefined) {
          inflight.resolve('cancelled')
        } else if (end.kind === 'error') {
          inflight.reject(internalError(`turn failed: ${end.error.message}`))
        } else {
          inflight.resolve(turnEndToStopReason(end))
        }
      })()
      /* v8 ignore start -- admissionDone only resolves; idle/output gates contain their own failures. */
      .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
          if (this.inflight !== inflight) return
          this.inflight = undefined
          inflight.reject(internalError(`prompt settlement failed: ${errorChain(error)}`))
        })
    /* v8 ignore stop */
  }
}
