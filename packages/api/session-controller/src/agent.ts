/** Agent activation, composition, and model-selection policy owned by API Session.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 agent 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  Agent, AgentOptions, AgentSetup, ModelSelection as AgentModelSelection, ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { TypertLookupFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { ModelSelection, SessionError } from './types.ts'

/** Cold Session identity absent from persistence.
 * @remarks 中文说明：类说明：ApiSessionNotFound 用于集中封装 处理 ApiSessionNotFound
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionNotFound extends Error {}

/** Session identity whose lifecycle belongs to subagent routing.
 * @remarks 中文说明：类说明：ApiSessionSubagentOwnership 用于集中封装 处理
 * ApiSessionSubagentOwnership 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionSubagentOwnership extends Error {
  /** @param sessionId - identity reserved to subagent routing.
   * @remarks 中文说明：功能说明：处理 ApiSessionSubagentOwnership 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * ApiSessionSubagentOwnership(sessionId) 创建实例，并在所属生命周期内使用。 */
  constructor(readonly sessionId: SessionId) {
    super(`session "${sessionId}" is a subagent session; use subagent delivery`)
  }
}

/** Explicit-id creation attempted to adopt a Session under another cwd.
 * @remarks 中文说明：类说明：ApiSessionCwdConflict 用于集中封装 处理 ApiSessionCwdConflict
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionCwdConflict extends Error {
  /**
   * 功能说明：处理 ApiSessionCwdConflict 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestedCwd （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param existingCwd （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ApiSessionCwdConflict(sessionId, requestedCwd,
   * existingCwd) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly sessionId: SessionId,
    readonly requestedCwd: string,
    readonly existingCwd: string | undefined,
  ) {
    super(
      existingCwd === undefined
        ? `session "${sessionId}" records no cwd and cannot be adopted for "${requestedCwd}"`
        : `session "${sessionId}" belongs to "${existingCwd}", not "${requestedCwd}"`,
    )
  }
}

/** Explicit-id creation attempted to adopt a Session under another preset.
 * @remarks 中文说明：类说明：ApiSessionPresetConflict 用于集中封装 处理
 * ApiSessionPresetConflict 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionPresetConflict extends Error {
  /**
   * 功能说明：处理 ApiSessionPresetConflict 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requestedPreset （string）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param existingPreset （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns 当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 通过 new ApiSessionPresetConflict(sessionId, requestedPreset,
   * existingPreset) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    readonly sessionId: SessionId,
    readonly requestedPreset: string,
    readonly existingPreset: string | undefined,
  ) {
    super(
      existingPreset === undefined
        ? `session "${sessionId}" records no agent preset and cannot be adopted under "${requestedPreset}"`
        : `session "${sessionId}" runs agent preset "${existingPreset}", not "${requestedPreset}"`,
    )
  }
}

/** Failures produced while resolving one ordinary Session identity to its live Agent. */
export type ApiSessionAgentError = Extract<
  SessionError,
  { readonly code: 'session-not-found' | 'agent-busy' | 'internal' }
>

/** Result of resolving one ordinary Session identity to its live Agent. */
export type ApiSessionAgentResult =
  | { readonly agent: Agent }
  | { readonly error: ApiSessionAgentError }

type InstalledSelection = ModelSelectionRef & {
  current: AgentModelSelection
  /**
   * 功能说明：处理 consume 相关流程；使用场景由所在模块及调用位置决定。
   * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param reasoningEffort （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 consume(provider, model, reasoningEffort)，并按返回类型处理结果。
   */
  consume(provider: string, model: string, reasoningEffort: string | undefined): boolean
}

/**
 * Test whether generic Session routing must leave an identity to subagent routing.
 * @param ctx - Host context carrying the Agent ownership registry.
 * @param session - attached or live Session whose ownership is tested.
 * @param agent - live Agent when one exists for the Session.
 * @returns whether subagent routing owns the Session identity.
 * @remarks 中文说明：功能说明：判断是否包含 Api Session Subagent Owner 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；
 * 必须满足声明的类型及调用时序要求。；参数说明：session（Pick<Session, 'header'>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：agent（Agent | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 hasApiSessionSubagentOwner(ctx, session, agent)，
 * 并按返回类型处理结果。
 */
export function hasApiSessionSubagentOwner(
  ctx: Context,
  session: Pick<Session, 'header'>,
  agent: Agent | undefined,
): boolean {
  if (session.header.origin === 'subagent') return true
  /**
   * 常量说明：parentId 用于处理 parentId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parentId = session.header.parentSession
  if (parentId === undefined || agent === undefined) return false
  /**
   * 常量说明：parent 用于处理 parent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parent = ctx.agents.get(parentId)
  return parent !== undefined && ctx.agents.isOwnedBy(agent.id, parent)
}

/**
 * Build the stable caller-facing subagent ownership rejection.
 * @param sessionId - Session identity owned by subagent routing.
 * @returns a stable Session-domain failure.
 * @remarks 中文说明：功能说明：处理 apiSessionSubagentOwnershipError 相关流程；
 * 使用场景由所在模块及调用位置决定。；参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：ApiSessionAgentError；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * apiSessionSubagentOwnershipError(sessionId)，并按返回类型处理结果。
 */
export function apiSessionSubagentOwnershipError(sessionId: SessionId): ApiSessionAgentError {
  return {
    code: 'agent-busy',
    message: `session "${sessionId}" is owned by subagent routing`,
    details: { reason: 'use subagent delivery for this child session' },
  }
}

/**
 * Inspect one cold Session without repairing, resuming, or publishing it.
 * @param ctx - Host context carrying Session persistence.
 * @param sessionId - durable Session identity.
 * @param signal - optional cancellation for persistence reads.
 * @returns the persisted header and complete event prefix.
 * @remarks 中文说明：功能说明：处理 inspectApiSession 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：Promise<{ meta:
 * SessionHeader; events: SessionEvent[] }>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 inspectApiSession(ctx, sessionId, signal)，
 * 并按返回类型处理结果。
 */
export async function inspectApiSession(
  ctx: Context,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<{ meta: SessionHeader; events: SessionEvent[] }> {
  try {
    /**
     * 变量说明：observation 用于处理 observation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    using observation = await ctx.sessionQuery.observeSession(sessionId, {
      ...(signal === undefined ? {} : { signal }),
      projectionMode: 'none',
    })
    if (observation.header.cwd === undefined) {
      throw new ApiSessionNotFound(`session "${sessionId}" not found`)
    }
    return { meta: observation.header, events: [...observation.events] }
  } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
    if (error instanceof SessionQueryError
      && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
      throw new ApiSessionNotFound(`session "${sessionId}" not found`)
    }
    throw error
  }
}

/** Owns every operation that may create, resume, or configure a Web Agent.
 * @remarks 中文说明：类说明：ApiSessionAgentController 用于集中封装 处理
 * ApiSessionAgentController 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；
 * 使用场景：由 api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionAgentController {
  /**
   * 常量说明：resumes 用于处理 resumes 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly resumes = new Map<SessionId, Promise<Agent>>()
  /**
   * 常量说明：creations 用于处理 creations 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly creations = new Map<SessionId, Promise<Agent>>()
  /**
   * 常量说明：selections 用于处理 selections 相关数据，作用于成员；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly selections = new WeakMap<Agent, InstalledSelection>()
  /**
   * 常量说明：imageAdmissionChains 用于处理 imageAdmissionChains 相关数据，作用于成员；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  private readonly imageAdmissionChains = new WeakMap<Agent, Promise<void>>()

  /** @param ctx - Host context carrying Agent, model, persistence, and Typert services.
   * @remarks 中文说明：功能说明：处理 ApiSessionAgentController 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new
   * ApiSessionAgentController(ctx) 创建实例，并在所属生命周期内使用。 */
  constructor(private readonly ctx: Context) {
    ctx.typert.lookups.configure('agent', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（SessionId）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(sessionId)，并按返回类型处理结果。
 */ async (sessionId: SessionId) => {
      /**
       * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const found = await this.resolveAgent(sessionId)
        if ('error' in found) throw new TypertLookupFailure(found.error)
        return found.agent
      })
    ctx.typert.lookups.configure('session', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（SessionId）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(sessionId)，并按返回类型处理结果。
 */ async (sessionId: SessionId) => {
      /**
       * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const found = await this.resolveAgent(sessionId)
        if ('error' in found) throw new TypertLookupFailure(found.error)
        return found.agent.session
      })
    ctx.typert.contexts.configureHost('agent', /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sessionId（SessionId）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(sessionId)，并按返回类型处理结果。
 */ async (sessionId: SessionId) => {
      /**
       * 常量说明：found 用于处理 found 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
        const found = await this.resolveAgent(sessionId)
        if ('error' in found) throw new TypertLookupFailure(found.error)
        return found.agent.ctx
      })
  }

  /**
   * Resolve or resume one ordinary Session, deduplicating concurrent resumes.
   * @param sessionId - ordinary Session identity.
   * @returns the live Agent or a stable Session-domain failure.
   * @remarks 中文说明：功能说明：解析 Agent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ApiSessionAgentResult>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveAgent(sessionId)，并按返回类型处理结果。
   */
  async resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.resolve(sessionId)
  }

  /**
   * Resolve one ordinary Session from an already-retained exact observation.
   * @param observation - Host-owned observation whose preparation stays pinned through setup.
   * @returns the live Agent or a stable Session-domain failure.
   * @remarks 中文说明：功能说明：解析 Observed Agent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：observation（SessionObservation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ApiSessionAgentResult>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 resolveObservedAgent(observation)，并按返回类型处理结果。
   */
  async resolveObservedAgent(observation: SessionObservation): Promise<ApiSessionAgentResult> {
    return this.resolve(observation.header.id, observation)
  }

  /**
   * 功能说明：解析 resolve 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param observation （SessionObservation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<ApiSessionAgentResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resolve(sessionId, observation)，并按返回类型处理结果。
   */
  private async resolve(
    sessionId: SessionId,
    observation?: SessionObservation,
  ): Promise<ApiSessionAgentResult> {
    /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const live = this.liveAgent(sessionId)
    if (live !== undefined) return live
    /**
     * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined && hasApiSessionSubagentOwner(this.ctx, attached, undefined)) {
      return { error: apiSessionSubagentOwnershipError(sessionId) }
    }

    /**
     * 变量说明：resume 用于处理 resume 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let resume = this.resumes.get(sessionId)
    if (resume === undefined) {
      resume = this.resume(sessionId, observation).finally(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.resumes.delete(sessionId) })
      this.resumes.set(sessionId, resume)
    }
    try {
      return { agent: await resume }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (error instanceof ApiSessionNotFound) {
        return {
          error: {
            code: 'session-not-found',
            message: error.message,
            details: { sessionId },
          },
        }
      }
      if (error instanceof ApiSessionSubagentOwnership) {
        return { error: apiSessionSubagentOwnershipError(error.sessionId) }
      }
      /**
       * 常量说明：raced 用于处理 raced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const raced = this.liveAgent(sessionId)
      if (raced !== undefined) return raced
      /**
       * 常量说明：racedSession 用于处理 racedSession 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const racedSession = this.ctx.sessions.get(sessionId)
      if (racedSession !== undefined && hasApiSessionSubagentOwner(this.ctx, racedSession, undefined)) {
        return { error: apiSessionSubagentOwnershipError(sessionId) }
      }
      return {
        error: {
          code: 'internal',
          message: `resume failed for session "${sessionId}": ${String(error)}`,
          details: {},
        },
      }
    }
  }

  /**
   * Resolve one requested identity, creating or resuming it once.
   * @param sessionId - requested Session identity.
   * @param cwd - directory the Session must own.
   * @param checkPersistedIdentity - whether to inspect a cold identity before creation.
   * @param presetId - optional Agent preset the Session must own.
   * @returns the matching live ordinary Agent.
   * @remarks 中文说明：功能说明：确保 Session 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：cwd（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：checkPersistedIdentity（boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：presetId（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<Agent>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 ensureSession(sessionId,
   * cwd, checkPersistedIdent…, presetId)，并按返回类型处理结果。
   */
  async ensureSession(
    sessionId: SessionId,
    cwd: string,
    checkPersistedIdentity: boolean,
    presetId?: string,
  ): Promise<Agent> {
    /**
     * 变量说明：creation 用于处理 creation 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let creation = this.creations.get(sessionId)
    if (creation === undefined) {
      creation = this.createOrAdopt(sessionId, cwd, checkPersistedIdentity, presetId)
        .catch(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（unknown）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
 */ (error: unknown) => {
          /**
           * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
            const live = this.ctx.agents.get(sessionId)
            if (live !== undefined) {
              if (hasApiSessionSubagentOwner(this.ctx, live.session, live)) {
                throw new ApiSessionSubagentOwnership(sessionId)
              }
              return live
            }
            /**
           * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
           */
            const attached = this.ctx.sessions.get(sessionId)
            if (attached !== undefined && hasApiSessionSubagentOwner(this.ctx, attached, undefined)) {
              throw new ApiSessionSubagentOwnership(sessionId)
            }
            throw error
          })
        .finally(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => { this.creations.delete(sessionId) })
      this.creations.set(sessionId, creation)
    }
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = await creation
    if (hasApiSessionSubagentOwner(this.ctx, agent.session, agent)) {
      throw new ApiSessionSubagentOwnership(sessionId)
    }
    if (presetId !== undefined) {
      this.assertPresetUnchanged(sessionId, presetId, this.presetForSession(agent.session))
    }
    if (agent.session.header.cwd !== cwd) {
      throw new ApiSessionCwdConflict(sessionId, cwd, agent.session.header.cwd)
    }
    return agent
  }

  /**
   * Install or return the Session-local model selection used by prompt assembly.
   * @param agent - live Agent that owns the selection.
   * @returns the installed mutable selection reference.
   * @remarks 中文说明：功能说明：处理 selectionFor 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：InstalledSelection；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 selectionFor(agent)，
   * 并按返回类型处理结果。
   */
  selectionFor(agent: Agent): InstalledSelection {
    /**
     * 常量说明：installed 用于处理 installed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const installed = this.selections.get(agent)
    if (installed !== undefined) return installed
    /**
     * 常量说明：projectionState 用于处理 projectionState 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const projectionState = this.ctx.sessionProjections.stateOf(agent.session, 'modelSelection')
    if (projectionState === undefined) {
      throw new Error('api-session: required modelSelection projection is not registered')
    }
    /**
     * 变量说明：picked 用于处理 picked 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let picked = projectionState.pending === null
      ? undefined
      : agentModelSelection(projectionState.pending)
    /**
     * 常量说明：defaultModel 用于处理 defaultModel 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const defaultModel = this.ctx.agentDefaultModel
    /**
     * 常量说明：selection 用于处理 selection 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const selection: InstalledSelection = {
      /**
       * 功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。
       * @returns AgentModelSelection；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 current()，并按返回类型处理结果。
       */
      get current(): AgentModelSelection {
        if (picked !== undefined) return picked
        /**
         * 常量说明：loggedHeader 用于处理 loggedHeader 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const loggedHeader = agent.session.requestHeader()
        if (loggedHeader === undefined) return defaultModel.currentSelection()
        /**
         * 常量说明：logged 用于处理 logged 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const logged = loggedHeader.config
        return {
          provider: logged.provider,
          model: logged.model,
          // An effort the adapter defaulted is not a conversation choice: restoring
          // it as one would make an unchanged default read as a request change.
          ...(logged.reasoningEffort === undefined
            || loggedHeader.adapterDefaults?.reasoningEffort === true
            ? {}
            : { reasoningEffort: logged.reasoningEffort }),
        }
      },
      /**
       * 功能说明：处理 current 相关流程；使用场景由所在模块及调用位置决定。
       * @param next （AgentModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 current(next)，并按返回类型处理结果。
       */
      set current(next: AgentModelSelection) {
        picked = next
      },
      /**
       * 功能说明：处理 consume 相关流程；使用场景由所在模块及调用位置决定。
       * @param provider （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param model （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @param reasoningEffort （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
       * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
       * @example 在完成前置校验后调用 consume(provider, model, reasoningEffort)，并按返回类型处理结果。
       */
      consume(provider: string, model: string, reasoningEffort: string | undefined): boolean {
        if (picked?.provider !== provider
          || picked.model !== model
          || picked.reasoningEffort !== reasoningEffort) return false
        picked = undefined
        return true
      },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)
    this.selections.set(agent, selection)
    return selection
  }

  /**
   * Commit and cache one validated selection for the next prompt assembly.
   * @param agent - live Agent that owns the selection.
   * @param selection - validated selection to record and apply.
   * @remarks 中文说明：功能说明：处理 selectForNextRequest 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：selection（AgentModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * selectForNextRequest(agent, selection)，并按返回类型处理结果。
   */
  selectForNextRequest(agent: Agent, selection: AgentModelSelection): void {
    agent.session.append('model/selection', selection)
    this.selectionFor(agent).current = selection
  }

  /**
   * Let a matching durable request header retire the execution cache.
   * @param agent - live Agent whose request was recorded.
   * @param provider - provider route used by the request.
   * @param model - provider-owned model used by the request.
   * @param reasoningEffort - adapter-owned effort used by the request.
   * @returns whether the pending selection was consumed.
   * @remarks 中文说明：功能说明：处理 consumeSelection 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：provider（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：model（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：reasoningEffort（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：boolean；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * consumeSelection(agent, provider, model, reasoningEffort)，并按返回类型处理结果。
   */
  consumeSelection(
    agent: Agent,
    provider: string,
    model: string,
    reasoningEffort: string | undefined,
  ): boolean {
    return this.selections.get(agent)?.consume(provider, model, reasoningEffort) ?? false
  }

  /**
   * Read the current Agent preset from the Session projection.
   * @param session - live Session whose projection state is available.
   * @returns the current preset, or undefined when the capability is absent.
   * @remarks 中文说明：功能说明：处理 presetForSession 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string |
   * undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * presetForSession(session)，并按返回类型处理结果。
   */
  presetForSession(session: Session): string | undefined {
    return this.ctx.sessionProjections.stateOf(session, 'agentPreset') ?? undefined
  }

  /**
   * Serialize image admission and model selection for one Agent.
   * @param agent - live Agent that owns the serialization chain.
   * @param operation - asynchronous operation admitted after prior work settles.
   * @returns the operation result or rejection.
   * @remarks 中文说明：功能说明：序列化 Image Admission 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：agent（Agent）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：operation（() =>
   * Promise<Value>）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：Promise<Value>；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * serializeImageAdmission(agent, operation)，并按返回类型处理结果。
   */
  serializeImageAdmission<Value>(agent: Agent, operation: () => Promise<Value>): Promise<Value> {
    /**
     * 常量说明：result 用于处理 result 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const result = (this.imageAdmissionChains.get(agent) ?? Promise.resolve()).then(operation)
    this.imageAdmissionChains.set(agent, result.then(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined, /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => undefined))
    return result
  }

  /**
   * Resolve the preset id and pre-publication Agent setup for a create or resume.
   * @param presetId - requested preset or the configured default when omitted.
   * @returns the resolved preset identity and Agent setup callback.
   * @remarks 中文说明：功能说明：处理 composeAgent 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：presetId（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<{ readonly agentPreset?: string readonly setup: AgentSetup
   * }>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 composeAgent(presetId)，
   * 并按返回类型处理结果。
   */
  async composeAgent(presetId: string | undefined): Promise<{
    readonly agentPreset?: string
    readonly setup: AgentSetup
  }> {
    /**
     * 常量说明：presets 用于处理 presets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { setup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
 */ (agentCtx) => { this.installSelection(agentCtx) } }
    /**
     * 常量说明：resolvedId 用于处理 resolvedId 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const resolvedId = (await presets.resolve(presetId)).id
    return {
      agentPreset: resolvedId,
      setup: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：agentCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(agentCtx)，并按返回类型处理结果。
 */ async (agentCtx) => {
        this.installSelection(agentCtx)
        await presets.mount(agentCtx, resolvedId)
      },
    }
  }

  /**
   * 功能说明：处理 liveAgent 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns ApiSessionAgentResult | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 liveAgent(sessionId)，并按返回类型处理结果。
   */
  private liveAgent(sessionId: SessionId): ApiSessionAgentResult | undefined {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = this.ctx.agents.get(sessionId)
    if (agent === undefined) return undefined
    return hasApiSessionSubagentOwner(this.ctx, agent.session, agent)
      ? { error: apiSessionSubagentOwnershipError(sessionId) }
      : { agent }
  }

  /**
   * 功能说明：处理 resume 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param supplied （SessionObservation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Agent>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resume(sessionId, supplied)，并按返回类型处理结果。
   */
  private async resume(sessionId: SessionId, supplied?: SessionObservation): Promise<Agent> {
    if (supplied !== undefined) return this.resumeObserved(sessionId, supplied)
    try {
      /**
       * 变量说明：observation 用于处理 observation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      return await this.resumeObserved(sessionId, observation)
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new ApiSessionNotFound(`session "${sessionId}" not found`)
      }
      throw error
    }
  }

  /**
   * 功能说明：处理 resumeObserved 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param observation （SessionObservation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Agent>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 resumeObserved(sessionId, observation)，并按返回类型处理结果。
   */
  private async resumeObserved(
    sessionId: SessionId,
    observation: SessionObservation,
  ): Promise<Agent> {
    if (observation.header.id !== sessionId || observation.header.cwd === undefined) {
      throw new ApiSessionNotFound(`session "${sessionId}" not found`)
    }
    if (hasApiSessionSubagentOwner(this.ctx, { header: observation.header }, undefined)) {
      throw new ApiSessionSubagentOwnership(sessionId)
    }
    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = await this.composeAgent(this.presetForObservation(observation))
    /**
     * 常量说明：published 用于处理 published 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const published = this.ctx.sessions.get(sessionId)
    /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const live = this.ctx.agents.get(sessionId)
    if (published !== undefined && hasApiSessionSubagentOwner(this.ctx, published, live)) {
      throw new ApiSessionSubagentOwnership(sessionId)
    }
    return (await this.ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: this.agentOptions(),
      setup: composition.setup,
    })).agent
  }

  /**
   * 功能说明：创建 Or Adopt 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param cwd （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param checkPersistedIdentity （boolean）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param presetId （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns Promise<Agent>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 createOrAdopt(sessionId, cwd, checkPersistedIdent…,
   * presetId)，并按返回类型处理结果。
   */
  private async createOrAdopt(
    sessionId: SessionId,
    cwd: string,
    checkPersistedIdentity: boolean,
    presetId: string | undefined,
  ): Promise<Agent> {
    /**
     * 常量说明：attached 用于处理 attached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const attached = this.ctx.sessions.get(sessionId)
    /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const live = this.ctx.agents.get(sessionId)
    if (attached !== undefined && hasApiSessionSubagentOwner(this.ctx, attached, live)) {
      throw new ApiSessionSubagentOwnership(sessionId)
    }
    if (live !== undefined) return live

    if (checkPersistedIdentity) {
      try {
        /**
         * 变量说明：observation 用于处理 observation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
         * 读写时需遵守声明类型和所在生命周期。
         */
        using observation = await this.ctx.sessionQuery.observeSession(sessionId)
        if (hasApiSessionSubagentOwner(this.ctx, { header: observation.header }, undefined)) {
          throw new ApiSessionSubagentOwnership(sessionId)
        }
        if (observation.header.cwd !== cwd) {
          throw new ApiSessionCwdConflict(sessionId, cwd, observation.header.cwd)
        }
        /**
         * 常量说明：storedPreset 用于处理 storedPreset 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const storedPreset = this.presetForObservation(observation)
        this.assertPresetUnchanged(sessionId, presetId, storedPreset)
        /**
         * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const composition = await this.composeAgent(storedPreset)
        return (await this.ctx.agents.resume({
          resumeSessionId: sessionId,
          agentOptions: this.agentOptions(),
          setup: composition.setup,
        })).agent
      } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
        if (!(error instanceof SessionQueryError)
          || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
      }
    }

    try {
      await mkdir(cwd, { recursive: true })
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw new Error(`failed to ensure project directory "${cwd}": ${String(error)}`, { cause: error })
    }
    /**
     * 常量说明：composition 用于处理 composition 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const composition = await this.composeAgent(presetId)
    return (await this.ctx.agents.create({
      sessionId,
      agentOptions: this.agentOptions(),
      meta: {
        cwd,
        ...(composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset }),
      },
      setup: composition.setup,
    })).agent
  }

  /**
   * 功能说明：处理 agentOptions 相关流程；使用场景由所在模块及调用位置决定。
   * @returns AgentOptions；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 agentOptions()，并按返回类型处理结果。
   */
  private agentOptions(): AgentOptions {
    /**
     * 常量说明：provider、model 用于处理 provider、model 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
    return { provider, model }
  }

  /**
   * 功能说明：处理 installSelection 相关流程；使用场景由所在模块及调用位置决定。
   * @param agentCtx （Context）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 installSelection(agentCtx)，并按返回类型处理结果。
   */
  private installSelection(agentCtx: Context): void {
    /**
     * 常量说明：agent 用于处理 agent 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('api-session: Agent setup has no scoped Agent')
    this.selectionFor(agent)
  }

  /**
   * Read the current Agent preset from an all-projections observation.
   * @param observation - exact Session observation carrying its projection snapshot.
   * @returns the current preset, or undefined when the capability is absent.
   * @remarks 中文说明：功能说明：处理 presetForObservation 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：observation（SessionObservation）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：string | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
   * presetForObservation(observation)，并按返回类型处理结果。
   */
  presetForObservation(observation: SessionObservation): string | undefined {
    if (observation.projections === undefined) {
      throw new Error('api-session: Agent activation requires a projected Session observation')
    }
    return observation.projections.values.agentPreset ?? undefined
  }

  /**
   * 功能说明：断言 Preset Unchanged 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param requested （string | undefined）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。
   * @param existing （string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 assertPresetUnchanged(sessionId, requested,
   * existing)，并按返回类型处理结果。
   */
  private assertPresetUnchanged(
    sessionId: SessionId,
    requested: string | undefined,
    existing: string | undefined,
  ): void {
    if (requested === undefined || requested === existing) return
    throw new ApiSessionPresetConflict(sessionId, requested, existing)
  }
}

/**
 * 功能说明：处理 agentModelSelection 相关流程；使用场景由所在模块及调用位置决定。
 * @param selection （ModelSelection）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns AgentModelSelection；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 agentModelSelection(selection)，并按返回类型处理结果。
 */
function agentModelSelection(selection: ModelSelection): AgentModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
  }
}
