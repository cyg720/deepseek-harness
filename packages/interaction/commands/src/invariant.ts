/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-commands`:
 * command lifecycle events pair by commandId within one session log.
 * @module @deepseek-ai/dsh-commands/invariant
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-commands 包的"不变量伴随插件"：校验命令生命周期事件在同一会话日志内按
 *   commandId 正确配对——run 不重复、done 必有先前 run 且 sourceEventSeq 指向合法的前置域事件。
 * 【技术维度】先扫描 ctx.sessions 的存量日志，再订阅 internal/dispatch 捕获新追加事件；
 *   安装级作用域（install-scoped）保证重装时从干净状态重新扫描。
 * 【产品维度】invariants 是仓库的运行时自检机制：一旦命令事件配对关系被破坏，演示/测试立即失败。
 * 【逻辑维度】apply 注册 → 扫描存量会话 → 订阅新事件 → validateEvent 逐条校验 run/done 配对
 *   与 sourceEventSeq 合法性。
 * 【关键边界】sourceEventSeq 必须指向非命令类的更早事件；校验器强依赖会话日志语义，
 *   改动事件结构需同步更新本文件。
 * 【新手阅读建议】对照 index.ts 的 execute 里 appendLifecycle 的调用点阅读。
 * ==========================================================================
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
    const sourceEvent = source === undefined ? undefined : session.events[source]
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
    for (const event of session.events) validateEvent(session, event)
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
