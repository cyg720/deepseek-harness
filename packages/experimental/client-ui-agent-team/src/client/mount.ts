/** Source-safe Agent Teams browser registration and Remote mount lifecycle.
 * @remarks 文件说明：文件职责：实现 experimental/client-ui-agent-team 中 mount 模块的职责，
 * 并向相邻模块提供可复用能力。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * experimental/client-ui-agent-team 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 →
 * 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import type {
  TeamMemberView as TeamRosterMember,
  TeamView,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from '@deepseek-ai/dsh-experimental-agent-team/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  TeamAction, type TeamActionInjected, type TeamActionResult, type TeamTaskActionResult,
} from './TeamAction.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser services for RPC, navigation, slots, and localized copy.
 * @remarks 中文说明：常量说明：inject 用于处理 inject 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const inject = ['sessions', 'remote', 'slots', 'locale']

/**
 * 功能说明：注册 Ui 相关流程；使用场景由所在模块及调用位置决定。
 * @param ctx （ClientContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 registerUi(ctx)，并按返回类型处理结果。
 */
function registerUi(ctx: ClientContext): void {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team: dictionaries')
  /**
   * 常量说明：sessions 用于处理 sessions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const sessions = ctx.sessions
  /**
   * 常量说明：leadSessionId 用于处理 leadSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 leadSessionId 相关流程；使用场景由所在模块及调用位置决定。
   * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns SessionId；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 leadSessionId(sessionId)，并按返回类型处理结果。
   */
  const leadSessionId = (sessionId: SessionId): SessionId => {
    /**
     * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  /**
   * 常量说明：actions 用于处理 actions 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const actions: TeamActionInjected = {
    /**
     * 功能说明：加载 load 相关流程；使用场景由所在模块及调用位置决定。
     * @param sessionId （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<TeamActionResult<TeamView>>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 load(sessionId)，并按返回类型处理结果。
     */
    async load(sessionId): Promise<TeamActionResult<TeamView>> {
      return await ctx.remote.agentTeams.view(leadSessionId(sessionId))
    },
    /**
     * 功能说明：创建 Task 相关流程；使用场景由所在模块及调用位置决定。
     * @param sessionId （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<TeamTaskActionResult>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 createTask(sessionId, input)，并按返回类型处理结果。
     */
    async createTask(sessionId, input): Promise<TeamTaskActionResult> {
      return await ctx.remote.agentTeams.createTask(leadSessionId(sessionId), input)
    },
    /**
     * 功能说明：更新 Task 相关流程；使用场景由所在模块及调用位置决定。
     * @param sessionId （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param input （由 TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns 由 TypeScript 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 updateTask(sessionId, input)，并按返回类型处理结果。
     */
    async updateTask(sessionId, input) {
      /**
       * 常量说明：owner、rest 用于处理 owner、rest 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const { owner, ...rest } = input
      return await ctx.remote.agentTeams.updateTask(leadSessionId(sessionId), {
        ...rest,
        ...owner === undefined ? {} : { owner },
      })
    },
    /**
     * 功能说明：打开 Teammate 相关流程；使用场景由所在模块及调用位置决定。
     * @param sessionId （SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @param member （TeamRosterMember）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 openTeammate(sessionId, member)，并按返回类型处理结果。
     */
    async openTeammate(sessionId: SessionId, member: TeamRosterMember): Promise<void> {
      if (member.role !== 'teammate') return
      /**
       * 常量说明：parentSessionId 用于处理 parentSessionId 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const parentSessionId = leadSessionId(sessionId)
      await sessions.refreshSubagents(parentSessionId)
      if (sessions.list.getSnapshot().current !== sessionId) return
      sessions.openSubagent({
        parentSessionId,
        childSessionId: member.id,
        mode: 'continuable',
      })
    },
  }

  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: 20,
      locale: NS,
      inject: () => actions,
    }, TeamAction),
  )
}

/**
 * Mount one generated Team Remote contribution, then register its browser UI.
 * @param ctx - Client Context carrying navigation, locale, slot, and Remote services.
 * @param contribution - generated Team descriptors selected by the browser entry.
 * @returns disposer for both the UI registrations and Remote namespace.
 * @remarks 中文说明：功能说明：处理 mountAgentTeamUi 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（ClientContext）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：contribution（TypertRemoteContribution）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * ；返回值：Promise<() => Promise<void>>；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 mountAgentTeamUi(ctx, contribution)，并按返回类型处理结果。
 */
export async function mountAgentTeamUi(
  ctx: ClientContext,
  contribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  /**
   * 常量说明：disposeRemote 用于处理 disposeRemote 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const disposeRemote = await ctx.remote.$mount(contribution)
  /**
   * 常量说明：ui 用于处理 ui 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const ui = ctx.inject(['sessions', 'remote.agentTeams', 'slots', 'locale'], registerUi)
  /**
   * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
   */
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
