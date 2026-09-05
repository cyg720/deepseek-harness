/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-commands`:
 * command lifecycle events pair by commandId within one session log.
 * @module @deepseek-ai/dsh-commands/invariant
 */

/*
 * 【文件职责】按同一会话中的 commandId 配对命令生命周期记录，检查持久命令日志的关联完整性。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务里的注册名，与 npm 包名一致，便于错误报告中定位归属。
const PACKAGE_NAME = '@deepseek-ai/dsh-commands'

// 该伴随插件的注册名，供 Cordis 按名加载与日志定位。
/** Cordis companion plugin name. */
export const name = 'commands-invariant'
// 声明依赖全局 invariants 服务；Cordis 会先装载该服务再调用本插件。
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install pairing validation over loaded logs and newly appended lifecycle events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // Install-scoped so a dispose/re-register cycle re-sweeps from a clean slate.
  const runIds = new WeakMap<Session, Set<string>>()
  const validateEvent = (session: Session, event: SessionEvent): void => {
    if (event.type === 'command/run') {
      const ids = runIds.get(session) ?? new Set<string>()
      if (ids.has(event.data.commandId)) {
        fail(`command/run repeats commandId ${JSON.stringify(event.data.commandId)}`)
      }
      ids.add(event.data.commandId)
      runIds.set(session, ids)
      return
    }
    if (event.type !== 'command/done') return
    if (runIds.get(session)?.has(event.data.commandId) !== true) {
      fail(`command/done ${JSON.stringify(event.data.commandId)} pairs no prior command/run in this log`)
    }
    const source = event.data.sourceEventSeq
    const sourceEvent = source === undefined ? undefined : session.eventAt(source)
    if (source !== undefined
      && (event.data.kind !== 'success'
        || !Number.isSafeInteger(source) || source < 0 || source >= event.seq
        || sourceEvent?.seq !== source
        || sourceEvent.type === 'command/run'
        || sourceEvent.type === 'command/done')) {
      fail(`command/done ${JSON.stringify(event.data.commandId)} has invalid sourceEventSeq ${String(source)}`)
    }
  }
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(session, event)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
