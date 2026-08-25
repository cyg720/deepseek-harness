/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent-default-model 包的伴生不变量占位：本服务没有任何独立的事件关系，安装器刻意留空。
 * 【技术维度】Cordis 伴生插件模式；空的 InvariantInstaller 让“无检查”在组合的不变量集合中显式可见。
 * 【产品维度】纯工程约定，无用户可见行为；保证每个包在 invariants 组合里都有明确声明。
 * 【逻辑维度】PACKAGE_NAME/name/inject → 空 install → apply 注册。
 * 【关键边界】无运行时检查；可变的设置值已由 settings 注册时校验。
 * 【新手阅读建议】很短，直接读完；理解“刻意为空也是一种明确表达”。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for the default Agent model selection.
 *
 * The service owns no independent event relationship: settings registration
 * already validates every mutable value before `currentSelection()` can observe it.
 * The empty installer keeps that absence explicit in composed invariant sets.
 *
 * @module @deepseek-ai/dsh-agent-default-model/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 注册表中的包名，作为该贡献的唯一标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-agent-default-model'

/** Cordis companion plugin name. */
// 伴生插件名：与其它不变量插件一样，通过 invariants 服务统一装载与卸载。
export const name = 'agent-default-model-invariant'
/** Services required before the companion can register. */
// 依赖声明：必须先有 invariants 服务，本插件才能注册（空的）检查器。
export const inject = ['invariants']

/** No runtime invariant: settings validation owns the only mutable-value relationship. */
// 空的安装器：本服务没有任何独立事件关系，设置注册时的校验已覆盖所有可变值，这里保持显式占位。
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 注册入口：把（空的）install 安装到 invariants 服务中，返回的 disposer 用于卸载该占位贡献。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
