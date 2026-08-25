/*
 * ================================ 文件注释 ================================
 * 【文件职责】计划控制包的浏览器侧入口：占据输入条 plan 席位，以活动状态芯片
 *             呈现 plan mode，并提供退出操作。
 * 【技术维度】Cordis 浏览器插件 + 投影（useProjection）：plan mode 通过命令源进入；
 *             投影有效目标为 plan mode 时芯片渲染，否则席位留空；退出执行 /plan off。
 * 【产品维度】用户在 plan mode 下的状态指示与一键退出。
 * 【逻辑维度】1) 注册字典；2) 把 PlanChip 注册进输入条 plan 席位（注入退出动作）。
 * 【关键边界】零客户端 plan 状态；失败字符串保持英文（错误面不本地化策略）。
 * 【新手阅读建议】组件实现见 PlanModeControl.tsx。
 * ==========================================================================
 */
/**
 * Plan control plugin, browser half: occupies the composer's named
 * `conversation.input.plan` seat with an active-state status chip. Plan mode
 * is entered through the command source; while the projection's effective
 * target is plan mode the chip renders and executes /plan off through
 * `command.execute`, otherwise the seat stays empty. Reads ride the generic
 * projection pair through the standard-kit `useProjection`; zero client-side
 * plan state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `plan` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import { PlanChip } from './PlanModeControl.tsx'
import { en, zh, type PlanKey } from './locales.ts'

export type { PlanKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer plan chip's copy. */
    plan: PlanKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'plan'

/** Injected business face of the composer plan seat. */
// 输入条 plan 席位的注入面：只含一个"退出 plan mode"动作。
export interface PlanChipInjected {
  /**
   * Leave plan mode by executing /plan off.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  exitPlanMode: () => Promise<string | null>
}

/** Required services: the seat's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the plan chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan: dictionaries')

  ctx.slots.inject('conversation.input.plan', () => ctx.slots.register({
    name: 'conversation.input.plan',
    locale: NS,
    inject: (sessionId: SessionId): PlanChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      exitPlanMode: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/plan off', [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /plan off'
        return null
      },
    }),
  }, PlanChip))
}
