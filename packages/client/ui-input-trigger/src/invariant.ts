/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-input-trigger 包的不变量伴生插件：向 invariant 服务登记本包所有权。
 * 【技术维度】Cordis 伴生插件 + dsh-invariants 注册 API。
 * 【产品维度】无 UI；属于"包级不变量"基础设施。
 * 【逻辑维度】apply() 调用 ctx.invariants.register(PACKAGE_NAME, install) 登记所有权。
 * 【关键边界】整个文件在 jscpd:ignore 区域；管线是浏览器侧纯核心 + 注册表，
 *             不发事件、无可变共享状态，故无运行时不变式。
 * 【新手阅读建议】模板化伴生文件，可跳过。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-input-trigger`.
 * @module @deepseek-ai/dsh-client-ui-input-trigger/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-input-trigger'

/** Cordis companion plugin name. */
export const name = 'client-ui-input-trigger-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the trigger pipeline is a browser-side pure core
 * (detect/reduce/match) plus a registry whose disposal is proven by the
 * HMR-safety spec; it emits no cordis events and owns no cross-plugin
 * mutable state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
