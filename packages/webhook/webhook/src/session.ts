/** Workspace-backed Session creation for one settled webhook rule result.
 * @remarks 文件说明：文件职责：实现 webhook/webhook 中 session 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 webhook/webhook 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { boundContextSummary, createUserMessage, errorChain, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WebhookRuleId } from './brand.ts'
import type { VerifiedWebhookDelivery, WebhookSessionRequest } from './types.ts'

/** Detached values the creation transaction keeps across asynchronous preflight. */
interface ResolvedWebhookSessionRequest {
  readonly workspacePath: string
  readonly title: string
  readonly prompt: string
  readonly agentPreset: string
  readonly permissionPreset: string
  readonly modelSelection: ModelSelection
  readonly agentOptions: {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
  }
}

/** Require one non-empty string field from an untyped rule result.
 * @remarks 中文说明：功能说明：处理 requiredString 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：record（Record<string, unknown>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：field（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 requiredString(record, field)，
 * 并按返回类型处理结果。 */
function requiredString(record: Record<string, unknown>, field: string): string {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`webhook Session request ${field} must be a non-empty string`)
  }
  return value
}

/** Snapshot and validate a same-process rule result before crossing awaits.
 * @remarks 中文说明：功能说明：解析 Request 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：input（WebhookSessionRequest）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：ResolvedWebhookSessionRequest；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 resolveRequest(ctx, input)，并按返回类型处理结果。 */
function resolveRequest(ctx: Context, input: WebhookSessionRequest): ResolvedWebhookSessionRequest {
  /**
   * 常量说明：candidate 用于处理 candidate 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const candidate: unknown = input
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('webhook rule result must be null or a Session request object')
  }
  /**
   * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const record = candidate as Record<string, unknown>
  /**
   * 常量说明：workspacePath 用于处理 workspacePath 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const workspacePath = requiredString(record, 'workspacePath')
  if (!isAbsolute(workspacePath)) {
    throw new TypeError(`webhook Session request workspacePath must be absolute, got ${JSON.stringify(workspacePath)}`)
  }
  /**
   * 常量说明：title 用于处理 title 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const title = requiredString(record, 'title')
  /**
   * 常量说明：prompt 用于处理 prompt 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const prompt = requiredString(record, 'prompt')
  /**
   * 常量说明：agentPreset 用于处理 agentPreset 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const agentPreset = requiredString(record, 'agentPreset')
  /**
   * 常量说明：permissionPreset 用于处理 permissionPreset 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const permissionPreset = requiredString(record, 'permissionPreset')
  /**
   * 常量说明：model 用于处理 model 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const model = record['model']
  if (model !== undefined && (model === null || typeof model !== 'object' || Array.isArray(model))) {
    throw new TypeError('webhook Session request model must be an object')
  }
  /**
   * 变量说明：agentOptions 用于处理 agentOptions 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let agentOptions: ResolvedWebhookSessionRequest['agentOptions']
  /**
   * 变量说明：modelSelection 用于处理 modelSelection 相关数据，作用于当前作用域；其值可能随流程推进而变化，
   * 读写时需遵守声明类型和所在生命周期。
   */
  let modelSelection: ModelSelection
  if (model === undefined) {
    /**
     * 常量说明：selected 用于处理 selected 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selected = ctx.agentDefaultModel.currentSelection()
    agentOptions = { provider: selected.provider, model: selected.model }
    modelSelection = { ...selected }
  } else {
    /**
     * 常量说明：modelRecord 用于处理 modelRecord 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const modelRecord = model as Record<string, unknown>
    /**
     * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const provider = requiredString(modelRecord, 'provider')
    /**
     * 常量说明：modelId 用于处理 modelId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const modelId = requiredString(modelRecord, 'model')
    /**
     * 常量说明：maxTokens 用于处理 maxTokens 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const maxTokens = modelRecord['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
      throw new TypeError('webhook Session request model.maxTokens must be a positive safe integer')
    }
    agentOptions = {
      provider,
      model: modelId,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    modelSelection = { provider, model: modelId }
  }
  return { workspacePath, title, prompt, agentPreset, permissionPreset, modelSelection, agentOptions }
}

/** Log a rollback failure without replacing the operation's original failure.
 * @remarks 中文说明：功能说明：处理 reportRollbackFailure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：subject（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；调用方应按声明类型处理，
 * 不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 reportRollbackFailure(ctx, subject,
 * error)，并按返回类型处理结果。 */
function reportRollbackFailure(ctx: Context, subject: string, error: unknown): void {
  ctx.logger.warn(`webhook: ${subject} rollback failed: ${errorChain(error)}`)
}

/** Apply the creation-time selection until its first durable request header exists.
 * @remarks 中文说明：功能说明：处理 installInitialModelSelection 相关流程；使用场景由所在模块及调用位置决定。
 * ；参数说明：agentCtx（Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：selection（ModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：void；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * installInitialModelSelection(agentCtx, selection)，并按返回类型处理结果。 */
function installInitialModelSelection(agentCtx: Context, selection: ModelSelection): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_payload（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：next（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<LlmCallConfig>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_payload, next)，
   * 并按返回类型处理结果。
   */
  agentCtx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => {
    /**
     * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const resolved = await next()
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = agentCtx.agent
    /* v8 ignore next -- AgentRegistry setup always provides the unpublished scoped Agent. */
    if (agent === undefined) throw new Error('webhook Session setup has no scoped Agent')
    if (agent.session.requestHeader() !== undefined
      || resolved.provider !== selection.provider
      || resolved.model !== selection.model) return resolved
    /**
     * 常量说明：_inheritedEffort、withoutInheritedEffort 用于处理
     * _inheritedEffort、withoutInheritedEffort 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
    return {
      ...withoutInheritedEffort,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    }
  })
}

/**
 * Create, attach, title, configure, and prompt one ordinary root Session.
 * Successful prompt admission ends webhook ownership of the operation; the
 * Agent remains lifecycle-owned by `ctx` and follows normal Session behavior.
 *
 * @param ctx - untraced runtime context that owns the resulting Agent.
 * @param delivery - exact verified provider delivery used for provenance.
 * @param ruleId - rule that returned the request.
 * @param request - same-process rule result.
 * @param signal - registration lifetime cancellation through publication.
 * @remarks 中文说明：功能说明：创建 Webhook Session 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：delivery（VerifiedWebhookDelivery）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：ruleId（WebhookRuleId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：request（WebhookSessionRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<void>；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 createWebhookSession(ctx,
 * delivery, ruleId, request, signal)，并按返回类型处理结果。
 */
export async function createWebhookSession(
  ctx: Context,
  delivery: VerifiedWebhookDelivery,
  ruleId: WebhookRuleId,
  request: WebhookSessionRequest,
  signal: AbortSignal,
): Promise<void> {
  /**
   * 常量说明：resolved 用于处理 resolved 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const resolved = resolveRequest(ctx, request)
  ctx.permissionPresets.resolve(resolved.permissionPreset)
  /**
   * 常量说明：preset 用于处理 preset 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const preset = await ctx.agentPresets.resolve(resolved.agentPreset)
  await ctx.agentPresets.standingKeyFor(preset.id)
  signal.throwIfAborted()

  /**
   * 常量说明：workspace 用于处理 workspace 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const workspace = await ctx.workspaceRegistry.create(resolved.workspacePath)
  signal.throwIfAborted()
  /**
   * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessionId = SessionId(`webhook-${randomUUID()}`)
  /**
   * 常量说明：handle 用于处理 handle 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
   */
  const handle = await ctx.agents.create({
    sessionId,
    signal,
    meta: { cwd: workspace.path, agentPreset: preset.id },
    agentOptions: resolved.agentOptions,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, preset.id)
      installInitialModelSelection(agentCtx, resolved.modelSelection)
    },
  })

  /**
   * 变量说明：attached 用于处理 attached 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let attached = false
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    signal.throwIfAborted()
    await workspace.attachSession(sessionId)
    attached = true
    signal.throwIfAborted()
    ctx.permissionPresets.set(handle.agent.session, resolved.permissionPreset)
    ctx.sessionTitle.rename(handle.agent.session, resolved.title)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: resolved.prompt }],
      source: {
        kind: 'webhook',
        provider: delivery.kind,
        source: delivery.source,
        deliveryId: delivery.deliveryId,
        ruleId,
        form: 'notice',
        summary: boundContextSummary(`${delivery.kind} webhook handled by ${ruleId}`),
      },
    }))
  } catch (error: unknown) {
    if (attached) {
      /**
       * 变量说明：rollbackError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
       */
      try {
        await workspace.detachSession(sessionId)
      } catch (rollbackError: unknown) {
        reportRollbackFailure(ctx, `Workspace detach for Session "${sessionId}"`, rollbackError)
      }
    }
    /**
     * 变量说明：rollbackError 保存当前捕获的异常；使用前应按项目约定缩小其类型。
     */
    try {
      await handle.dispose()
    } catch (rollbackError: unknown) {
      reportRollbackFailure(ctx, `Agent disposal for Session "${sessionId}"`, rollbackError)
    }
    throw error
  }
}
