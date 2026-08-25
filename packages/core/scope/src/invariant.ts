/*
 * ================================ 文件注释 ================================
 * 【文件职责】安装 dsh-scope 包的运行时不变量：监听 internal/dispatch，校验“作用域过滤事件”必须带作用域载体，且载体键与负载主体一致。
 * 【技术维度】Cordis 伴生插件挂到 invariants 服务；借助生成的 scopedSubjectResolverFor 判断事件类别并解析主体。
 * 【产品维度】开发期/测试期自检：防止插件手写 ctx.emit 漏传载体，导致作用域过滤失效或事件投递错位。
 * 【逻辑维度】PACKAGE_NAME/name/inject → install（internal/dispatch 监听：查解析器 → 查载体存在 → 查键一致）→ apply 注册。
 * 【关键边界】只对表内声明的作用域事件生效；null 解析器的事件只检查载体存在性；只 fail 不改变行为。
 * 【新手阅读建议】很短，直接读完；对照 dispatch.ts 的 agentEvents 看正确的分发姿势。
 * ==========================================================================
 */
/** Package-owned scoped-dispatch invariants. @module @deepseek-ai/dsh-scope/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { carrierKeyOf, isScopeCarrier } from '@deepseek-ai/dsh-scope'
import { scopedSubjectResolverFor } from './scoped-events.generated.ts'

// 本包在 invariants 注册表中的包名，作为该贡献的唯一标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-scope'

/** Cordis companion plugin name. */
// 伴生插件名：与其它不变量插件一样，通过 invariants 服务统一装载与卸载。
export const name = 'scope-invariant'
/** Services required before the companion can register. */
// 依赖声明：必须先有 invariants 服务，本插件才能注册检查器。
export const inject = ['invariants']

/** Install the scoped-dispatch contribution into its child registration fiber. */
// 安装器本体：全局监听 internal/dispatch（Cordis 每次事件分发的内部钩子），校验作用域载体是否规范。
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/dispatch', (_mode, eventName, args, thisArg) => {
    const subjectOf = scopedSubjectResolverFor(eventName)
    if (subjectOf === undefined) return
    if (!isScopeCarrier(thisArg)) {
      fail(
        `"${eventName}" is a scope-filtered event but was dispatched without a scope carrier — `
        + 'pass scopeTarget(base, subject) as the dispatch thisArg (agent events: use agentEvents(ctx, agent))',
      )
    }
    if (subjectOf !== null && carrierKeyOf(thisArg) !== subjectOf(args)) {
      fail(
        `"${eventName}" was dispatched with a scope carrier keyed to a DIFFERENT subject than its arguments name — `
        + 'the carrier key and the event\'s subject must be the same object (use agentEvents(ctx, agent))',
      )
    }
  }, { global: true })
}

/**
 * Register the scope invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 注册入口：把 install 安装到 invariants 服务中，返回的 disposer 用于卸载该检查贡献。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
