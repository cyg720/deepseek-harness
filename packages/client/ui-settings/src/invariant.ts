/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-settings 包的不变量伴生插件：向 invariant 服务登记本包所有权。
 * 【技术维度】Cordis 伴生插件 + dsh-invariants 注册 API。
 * 【产品维度】无 UI；属于"包级不变量"基础设施。
 * 【逻辑维度】apply() 调用 ctx.invariants.register(PACKAGE_NAME, install) 登记所有权。
 * 【关键边界】整个文件在 jscpd:ignore 区域；本包是投影设置分区的呈现壳，不发事件、
 *             无跨插件可变关系（槽位冲突在槽位核心加载时已报错），故无运行时不变式。
 * 【新手阅读建议】模板化伴生文件，可跳过。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings`.
 * @module @deepseek-ai/dsh-client-ui-settings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a presentation shell projecting the settings.section
 * ledger into navigation — it emits no cordis events and owns no cross-plugin
 * mutable relation; slot declaration/registration conflicts already fail loud
 * in the slot core at load time.
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
