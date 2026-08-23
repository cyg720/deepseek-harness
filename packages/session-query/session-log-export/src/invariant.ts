/**
 * ================================ 文件注释 ================================
 * 【文件职责】session-log-export 包的 invariant 伴生插件：注册空安装器，
 *   说明本包无运行时不变量（命令注册表拥有生命周期配对、ApiProxy 拥有 ZIP 完整性）。
 * 【技术维度】标准 invariants 插件形态；文件被 jscpd:ignore 包裹。
 * 【逻辑维度】name/inject → 空 install（附论证）→ apply。
 * 【新手阅读建议】读 install 上方英文注释理解论证。
 * ==========================================================================
 */

/** Package invariant companion for `@deepseek-ai/dsh-session-log-export`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-log-export'

export const name = 'session-export-invariant'
export const inject = ['invariants']

/** No runtime invariant: the command registry owns lifecycle pairing and ApiProxy owns ZIP integrity. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
