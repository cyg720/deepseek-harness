/**
 * ================================ 文件注释 ================================
 * 【文件职责】session-telemetry-otel 包的 invariant 伴生插件：注册空安装器，
 *   说明本包无运行时不变量（模式选择只改变捕获交接与 SDK 装配，导出留在 SDK 内部）。
 * 【技术维度】标准 invariants 插件形态（name/inject/apply）；文件被 jscpd:ignore 包裹。
 * 【逻辑维度】name/inject → 空 install（附论证）→ apply。
 * 【新手阅读建议】读 install 上方英文注释理解论证。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-telemetry-otel`.
 * @module @deepseek-ai/dsh-session-telemetry-otel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-telemetry-otel'

/** Cordis companion plugin name. */
export const name = 'session-telemetry-otel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: mode selection changes capture handoff, SDK setup, and
 * local diagnostics without mutating session or service state an independent
 * companion can compare. Export remains inside the SDK past the backend boundary.
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
