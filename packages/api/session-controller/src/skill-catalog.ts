/** Session-addressed, cold-readable skill catalog Remote.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 skill catalog 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SkillListRequest, SkillListValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the Session-addressed `skills` Remote namespace. */
    sessionSkillCatalog: SessionSkillCatalog
  }
}

/** Host service backing `ctx.remote.skills` without activating a cold Agent.
 * @remarks 中文说明：类说明：SessionSkillCatalog 用于集中封装 处理 SessionSkillCatalog
 * 相关状态与行为。；核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由
 * api/session-controller 在对应插件或业务生命周期内创建和调用。 */
export class SessionSkillCatalog extends TypertRemoteService {
  /**
   * 变量说明：inject 用于处理 inject 相关数据，作用于成员；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  static inject = ['agents', 'sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional skill/preset services.
   * @remarks 中文说明：功能说明：处理 SessionSkillCatalog 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：当前类实例；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new SessionSkillCatalog(ctx) 创建实例，
   * 并在所属生命周期内使用。 */
  constructor(ctx: Context) {
    super(ctx, 'sessionSkillCatalog', { namespace: 'skills' })
  }

  /**
   * List the user-invocable skills visible to one Session composition.
   * @param request - Session identity whose cwd and preset select the catalog view.
   * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
   * @returns user-invocable skill metadata without loading skill bodies.
   * @throws TypertRemoteFailure when the Session cannot be inspected or no registry can serve it.
   * @remarks 中文说明：功能说明：列出 list 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：request（SkillListRequest）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SkillListValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 list(request, signal)，并按返回类型处理结果。
   */
  @Remote
  async list(request: SkillListRequest, signal: AbortSignal): Promise<SkillListValue> {
    void signal
    /**
     * 常量说明：sessionId 用于处理 sessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const { sessionId } = request
    /**
     * 变量说明：cwd 用于处理 cwd 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let cwd: string | undefined
    /**
     * 变量说明：agentPreset 用于处理 agentPreset 相关数据，作用于当前作用域；其值可能随流程推进而变化，
     * 读写时需遵守声明类型和所在生命周期。
     */
    let agentPreset: string | undefined
    try {
      /**
       * 变量说明：observation 用于处理 observation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      using observation = await this.ctx.sessionQuery.observeSession(sessionId)
      if (observation.projections === undefined) {
        throw new Error('skill catalog requires a projected Session observation')
      }
      cwd = observation.header.cwd
      agentPreset = observation.projections.values.agentPreset ?? undefined
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw failure(
          'session-not-found',
          `session "${sessionId}" not found`,
          { sessionId },
        )
      }
      throw failure(
        'internal',
        `session "${sessionId}" could not be inspected: ${String(error)}`,
      )
    }
    if (cwd === undefined) {
      throw failure('internal', `session "${sessionId}" has no project cwd`)
    }

    /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const live = this.ctx.agents.get(sessionId)
    /**
     * 常量说明：presets 用于处理 presets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const presets = this.ctx.get('agentPresets')
    /**
     * 常量说明：scoped 用于处理 scoped 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills')
    /**
     * 常量说明：skillRegistry 用于处理 skillRegistry 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const skillRegistry = scoped ?? this.ctx.get('skills')
    if (skillRegistry === undefined) {
      throw failure(
        'internal',
        'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill',
      )
    }

    /**
     * 常量说明：scope 用于处理 scope 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const scope = await this.scopeFor(sessionId, agentPreset)
    try {
      /**
       * 常量说明：skills 用于处理 skills 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable)
      return {
        skills: skills.map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：skill（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(skill)，并按返回类型处理结果。
 */ skill => ({
            name: skill.name,
            description: skill.description,
            ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
            modelInvocable: skill.invocation.modelInvocable,
          })),
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      throw failure('internal', `skill listing failed: ${String(error)}`)
    }
  }

  /** Resolve a live or standing preset scope without creating an Agent.
   * @remarks 中文说明：功能说明：处理 scopeFor 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：sessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：agentPreset（string | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<ScopeKey | undefined>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 scopeFor(sessionId, agentPreset)，并按返回类型处理结果。 */
  private async scopeFor(
    sessionId: SessionId,
    agentPreset: string | undefined,
  ): Promise<ScopeKey | undefined> {
    /**
     * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    /**
     * 常量说明：presets 用于处理 presets 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      return await presets.standingKeyFor(agentPreset)
    } catch {
      // An unknown or unusable recorded preset falls back to the global registry.
      return undefined
    }
  }
}

/** Build one stable Remote failure with optional typed details.
 * @remarks 中文说明：功能说明：处理 failure 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：code（'session-not-found' | 'internal'）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数说明：details（{
 * readonly sessionId: SessionId } | Record<never, never>）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：TypertRemoteFailure；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 failure(code, message, details)，并按返回类型处理结果。 */
function failure(
  code: 'session-not-found' | 'internal',
  message: string,
  details: { readonly sessionId: SessionId } | Record<never, never> = {},
): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}

export default SessionSkillCatalog
