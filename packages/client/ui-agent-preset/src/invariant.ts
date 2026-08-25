/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-agent-preset 包的不变量（invariant）伴生插件：为包在 invariant 服务里
 *             登记所有权。当前安装函数为空——本包没有运行时不变式要检查。
 * 【技术维度】Cordis 伴生插件机制 + dsh-invariants 的注册 API；PACKAGE_NAME 是所有权登记名。
 * 【产品维度】无直接 UI；它是仓库"包级不变量"基础设施的一部分（运行时不变式断言体系）。
 * 【逻辑维度】apply() 调用 ctx.invariants.register(PACKAGE_NAME, install) 登记本包，
 *             install 为空函数，返回值是登记的清理函数。
 * 【关键边界】整个文件被 jscpd:ignore 包围（重复检测忽略）；浏览器侧表面插件的宿主半部
 *             不拥有事件流或可变数据，故无可检查的不变式。
 * 【新手阅读建议】这是模板化伴生文件，想理解"不变量"概念可查看 dsh-invariants 包。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-agent-preset`.
 * @module @deepseek-ai/dsh-client-ui-agent-preset/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-agent-preset'

/** Cordis companion plugin name. */
export const name = 'client-ui-agent-preset-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side surface plugin whose node half owns no event stream
 * or mutable runtime data; the roster and the settings write are host contracts covered there.
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
