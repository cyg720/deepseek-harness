/*
 * ================================ 文件注释 ================================
 * 【文件职责】Agent Teams 的 invariant 伴生插件：在 internal/dispatch 阶段把候选
 *   team 事件对"已提交前缀"做严格折叠验证，非法即 fail（追加前拦截）。
 * 【技术维度】两段式暂存模式（internal/dispatch → 校验）；复用 fold.ts 的
 *   foldTeam/applyTeamEvent 作为权威折叠。
 * 【产品维度】守护团队持久流的状态机约束（成员转移、任务 revision、消息顺序）。
 * 【逻辑维度】name/inject → install（internal/dispatch 校验）→ apply。
 * 【关键边界】global 监听；校验失败在事件公开发布之前发生。
 * 【新手阅读建议】与 fold.ts 的 applyTeamEvent 对照阅读。
 * ==========================================================================
 */

/** Package-owned relational checks for Agent Teams durable records. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyTeamEvent, foldTeam, isTeamEvent } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-agent-team'

/** Cordis companion plugin name. */
export const name = 'team-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/** Validate candidate Team events against the committed prefix before append. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (!isTeamEvent(event)) return
    try {
      const state = foldTeam(session.id, session.events)
      applyTeamEvent(state, event)
    } catch (error: unknown) {
      /* v8 ignore next -- the strict Team fold throws Error instances. */
      const message = error instanceof Error ? error.message : String(error)
      fail(`session event ${event.seq} violates the Agent Teams stream: ${message}`)
    }
  }, { global: true })
}, { inject: ['sessions'] })

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
