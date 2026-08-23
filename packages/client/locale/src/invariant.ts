/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-client-locale 包的运行时不变量（invariant）伴侣插件。
 * 【技术维度】Cordis 伴侣插件；install 为空操作。
 * 【产品维度】本包无运行时 owned 关系需要审计：ns-by-locale 字典注册表
 *   带稳定 bind(ns) API——不发射 cordis 事件、不拥有跨插件可变关系；
 *   回退链解析与语言存储行为由本包行为规格直接断言。
 * 【逻辑维度】name/inject/apply 三元组；apply 注册空安装器。
 * 【关键边界】invariant 服务必需（inject）；无实际检查逻辑。
 * 【新手阅读建议】对照 packages/invariants 的注册契约理解。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-locale`.
 * @module @deepseek-ai/dsh-client-locale/invariant
 */
/**
 * 本包自有的不变量伴侣插件。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-locale' // 注册到 invariants 服务时使用的包名标识

/** Cordis companion plugin name. */
/** Cordis 伴侣插件的插件名。 */
export const name = 'client-locale-invariant'
/** Service required before the companion can reserve package ownership. */
/** 注册伴侣插件前必须先存在的服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: ns-by-locale dictionary registry with a stable
 * bind(ns) API — it emits no cordis events and owns no cross-plugin
 * mutable relation; fallback-chain resolution and locale-store behavior are
 * asserted directly by this package's behavior specs.
 */
/**
 * 无运行时不变量：ns-by-locale 字典注册表带稳定 bind(ns) API——不发射
 * cordis 事件、不拥有跨插件可变关系；回退链解析与语言存储行为由本包
 * 行为规格直接断言。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 注册本包的不变量伴侣。
 * @param ctx 携带 invariants 服务的 Cordis 上下文。
 * @returns 设置成功后已安装注册项的销毁函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
