/** Package-owned durable plan-mode invariants. @module @deepseek-ai/dsh-plan-mode/invariant */
/*
 * 中文说明：
 * - 文件职责：为 plan/mode 持久事件校验 active 字段并注册历史与实时不变量。
 * - 技术维度：使用 Cordis 伴生插件、会话回放、全局事件监听和运行时类型检查。
 * - 产品维度：防止损坏的计划模式状态进入日志，保证恢复后界面与代理模式一致。
 * - 逻辑维度：validateEvent 检查载荷；install 回放已有/新会话并监听追加；apply 完成登记。
 * - 关键边界：计划模式可在轮次之间或步骤边界提交，因此只校验布尔载荷，不建立轮次包含关系。
 * - 新手阅读建议：先看 validateEvent 的单字段规则，再看 seed 如何覆盖历史和新创建会话。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** 不变量归属的 npm 包名，用于错误归因。 */
const PACKAGE_NAME = '@deepseek-ai/dsh-plan-mode'

/** Cordis companion plugin name. */
/* 中文：Cordis 伴生插件的稳定名称。 */
export const name = 'plan-mode-invariant'
/** Service required before the companion can reserve package ownership. */
/* 中文：注册本规则前必须存在的不变量服务。 */
export const inject = ['invariants']

/**
 * Validate one `plan/mode` event before it reaches the durable log.
 * `plan/mode` is a standalone whole-value event: an idle selection commits
 * between turns and a mid-turn selection commits at the step boundary, so
 * no turn-enclosure relation exists — only the payload shape is checkable.
 */
/* 中文：校验一条事件；非 plan/mode 忽略，active 不是布尔值时调用 fail，无返回值。 */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'plan/mode') return
  /** 从事件载荷读取的 active 候选值，外部持久边界上可能为任意类型。 */
  const active = (event.data as { active?: unknown }).active
  if (typeof active !== 'boolean') {
    fail(`plan/mode carries invalid active state ${JSON.stringify(active)}; expected a boolean`)
  }
}

/** Install validation for loaded and newly appended plan-mode state. */
/* 中文：安装历史回放、新会话播种与实时追加监听的规则。 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  /** 中文：回放一个 session 的已有事件；无返回值。 */
  const seed = (session: Session): void => {
    /** 当前会话的一条历史事件。 */
    for (const event of session.events) validateEvent(event, fail)
  }
  /** 当前已装载、需要立即回放的会话。 */
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    /** 从 session/event 参数中取得的新事件。 */
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the plan-mode invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 中文：向 ctx.invariants 注册计划模式规则；返回安装完成后的释放函数 Promise。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
