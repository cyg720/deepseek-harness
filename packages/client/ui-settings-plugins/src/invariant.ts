/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-settings-plugins 包的不变量伴生插件：向 invariant 服务登记本包所有权。
 * 【技术维度】Cordis 伴生插件 + dsh-invariants 注册 API。
 * 【产品维度】无 UI；属于"包级不变量"基础设施。
 * 【逻辑维度】apply() 调用 ctx.invariants.register(PACKAGE_NAME, install) 登记所有权。
 * 【关键边界】整个文件在 jscpd:ignore 区域；本包是浏览器侧设置表面，宿主半部
 *             不拥有事件流或可变数据（分层与写拒绝是宿主契约），故无运行时不变式。
 * 【新手阅读建议】模板化伴生文件，可跳过。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-plugins`.
 * @module @deepseek-ai/dsh-client-ui-settings-plugins/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-plugins'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-plugins-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side settings surface whose node half owns no event
 * stream or mutable runtime data; the layering and write refusals are Host contracts covered by
 * the owning plugins and the api-proxy.
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
