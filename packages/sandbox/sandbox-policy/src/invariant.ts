/** Package-owned session-event invariants for sandbox policy. @module @deepseek-ai/dsh-sandbox-policy/invariant */

/*
 * 【文件职责】检查沙箱策略相关的会话事件，约束策略事实与持久记录的关系。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { SANDBOX_MODES } from './session-mode.ts'

/** 当前不变量归属的 npm 包名，注册失败信息会用它定位责任包。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-sandbox-policy'

/** Cordis companion plugin name. */
/* 中文：Cordis 伴生插件名称，用于插件装载和诊断。 */
export const name = 'sandbox-policy-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文：装载本伴生插件前必须存在的不变量注册服务。 */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/* 中文：各包伴生插件共享同一套回放和事件分派样板，因此复制检测忽略本段。 */
/** Validate the package-owned event fields and ignore unrelated events. */
/* 中文：校验一个会话事件；event 是待检查事件，fail 用于报告违规，无返回值；其他事件不处理。 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'sandbox/mode' && !SANDBOX_MODES.includes(event.data.mode)) {
    fail(`sandbox/mode carries unknown mode ${JSON.stringify(event.data.mode)}`)
  }
}

/** Install validation for loaded and newly appended sandbox modes. */
/* 中文：先回放全部已有事件，再订阅后续 session/event 的不变量安装器。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** session 是当前已载入的单个会话。 */
  for (const session of ctx.sessions.list()) {
    for (const event of session.snapshotEvents()) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 从事件参数元组中取出的新会话事件。 */
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */
/* 中文：共享样板忽略区结束。 */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文：向 ctx.invariants 登记安装器；参数为 Cordis 上下文，返回释放函数 Promise。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
