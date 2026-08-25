/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-goal 包在浏览器侧的插件入口：把 GoalBar（目标栏）挂到对话输入区
 *             停靠条（dock），并注册 /goal 命令输入的聊天节点投影。
 * 【技术维度】Cordis 浏览器插件 + 投影（projection）模式：实时目标通过
 *             useProjection('goal') 到达，本插件不持有 store、不监听事件；
 *             注入面只带四个变更动词（edit/pause/resume/clear），经生成的
 *             Goal Remote API 以 CAS ref 提交。
 * 【产品维度】用户可在输入区旁看到当前目标、编辑/暂停/恢复/清除；对话中展示 /goal 命令输入。
 * 【逻辑维度】1) 注册 goal-command-input 定义；2) 注册字典；
 *             3) 注册命令输入视图；4) 注入四个变更动词到输入停靠条槽位。
 * 【关键边界】目标创建走宿主 /goal 命令；无当前目标时变更动词返回固定错误结果。
 * 【新手阅读建议】先看 slots.ts 的注入面与 goal-command-input.ts 的投影定义。
 * ==========================================================================
 */
/**
 * Goal surface plugin, browser half: the GoalBar entry in the
 * conversation.input.dock strip. Projection-mode surface — the live goal
 * arrives through `useProjection('goal')` (seeded by the history tail page,
 * updated by session/projection frames), so this plugin owns no store, no
 * refresh chain, and no event listener. The inject face carries only the
 * four mutation verbs through the generated Goal Remote API;
 * their CAS ref reads the session's current projected value at call time.
 * Goal creation stays on the /goal host command.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `goal` SessionProjectionMap key merge (single source, the domain's pure outlet).
import type { GoalProjection, GoalRef } from '@deepseek-ai/dsh-goal/client'
import type { GoalActionResult, GoalBarActions } from './slots.ts'
import { GoalDock } from './GoalBar.tsx'
import { GoalCommandInputView } from './GoalCommandInputView.tsx'
import { goalCommandInputDefinition } from './goal-command-input.ts'
import { en, zh, type GoalKey } from './locales.ts'

export { GoalBar, GoalDock } from './GoalBar.tsx'
export type { GoalActionResult, GoalBarActions } from './slots.ts'
export type { GoalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The goal strip's copy. */
    goal: GoalKey
  }
}

/** Dictionary namespace owned by this plugin. */
// 本插件拥有的字典命名空间名。
const NS = 'goal'

/** Required services for the Goal dock, command-input projection, Remote mutations, and copy. */
export const inject = ['slots', 'sessions', 'remote', 'remote.goals', 'locale', 'conversationEvents']

/**
 * Client plugin body: the GoalBar dock entry with its mutation verbs.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(goalCommandInputDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-goal: dictionaries')

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'command-input',
    locale: NS,
  }, GoalCommandInputView))

  const sessions = ctx.sessions

  /** The session's current projected CAS ref, read at verb call time (no staleness fence: the RPC's CAS is the guard). */
  const refOf = (sessionId: SessionId): GoalRef | undefined => {
    const face = sessions.binding(sessionId)?.session.projections.faceOf('goal')
    const projection = face?.getSnapshot() as GoalProjection | null | undefined
    if (projection == null) return undefined
    return { id: projection.goal.id, revision: projection.goal.revision }
  }

  const noCurrentGoal: GoalActionResult = {
    ok: false,
    error: { code: 'no-current-goal', message: 'no current goal to mutate', details: {} },
  }

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'goal',
    order: 10,
    locale: NS,
    inject: (sessionId): GoalBarActions => ({
      onEdit: async (objective) => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentGoal
        return await ctx.remote.goals.edit(sessionId, ref, { objective })
      },
      onPause: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentGoal
        return await ctx.remote.goals.pause(sessionId, ref)
      },
      onResume: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentGoal
        return await ctx.remote.goals.resume(sessionId, ref)
      },
      onClear: async () => {
        const ref = refOf(sessionId)
        if (ref === undefined) return noCurrentGoal
        return await ctx.remote.goals.clear(sessionId, ref)
      },
    }),
  }, GoalDock))
}
