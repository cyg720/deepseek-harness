/**
 * Package-owned strict Schedule stream invariant.
 * @module @deepseek-ai/dsh-schedule/invariant
 */

/*
 * 【文件职责】检查提醒事件流的严格领域规则，拒绝无法一致回放的持久提醒记录。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { foldScheduleEvents, ScheduleLogError } from './domain.ts'

/** 当前不变量检查器声明归属的包名，只用于注册所有权。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-schedule'

/** Cordis invariant-companion plugin name. */
/* Cordis 中日程不变量伴随插件的名称。 */
export const name = 'tool-schedule-invariant'
/** Service required before reserving this package's invariant ownership. */
/* 注册包级不变量所有权前必须存在的不变量服务。 */
export const inject = ['invariants']

/** Validate a complete exact-session stream under its fork suffix policy. */
function validate(events: readonly SessionEvent[], fail: InvariantFailure): void {
  try {
    foldScheduleEvents(events)
  } catch (error: unknown) {
    /* v8 ignore next -- foldScheduleEvents normalizes every rejected stream to ScheduleLogError. */
    /* foldScheduleEvents 会将所有被拒绝的事件流统一转换为 ScheduleLogError。 */
    if (!(error instanceof ScheduleLogError)) throw error
    fail(error.message)
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/* 各包的伴随检查器共享相同的重放和分发接线，因此复制检测忽略这一段。 */
/** Install replay and pre-append validation for the owned event stream. */
/* 安装已有会话重放、新建会话检查和写入前检查。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 遍历当前已加载的会话，确保启动时的历史记录有效。 */
  for (const session of ctx.sessions.list()) {
    validate(session.ownEvents(), fail)
  }
  ctx.on('session/created', (session) => {
    validate(session.ownEvents(), fail)
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 当前即将接收事件的会话及事件本体。 */
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'schedule/change') return
    validate([...session.ownEvents(), event], fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */
/* 结束复制检测忽略区间。 */

/**
 * Register the package-owned invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns Exact registration disposer after child setup succeeds.
 */
/*
 * 向不变量注册表登记日程包拥有的检查器。
 * @param ctx 提供不变量注册表的 Cordis 上下文。
 * @returns 子插件安装成功后可精确撤销本次注册的函数。
 * @example `await apply(ctx)`
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
