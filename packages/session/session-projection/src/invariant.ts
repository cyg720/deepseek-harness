/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-projection`.
 * @module @deepseek-ai/dsh-session-projection/invariant
 */

/* jscpd:ignore-start */
/*
 * ================================ 文件注释 ================================
 * 【文件职责】session-projection 包的 invariant 伴生插件：本包刻意"无运行时不变量"，
 *   注册一个空安装器说明原因（契约由服务内部同步强制 + spec 证明 + 载体线路上断言）。
 * 【技术维度】标准 invariants 插件形态（name/inject/apply），install 为空函数；
 *   文件整体被 jscpd:ignore 包裹（防重复代码检测）。
 * 【产品维度】占位说明：哪些关系为什么不在伴生插件里重复检查。
 * 【逻辑维度】按代码顺序：name/inject → 空 install（附详细论证注释）→ apply。
 * 【关键边界】jscpd pragma 与 install 定义保持原样。
 * 【新手阅读建议】读 install 上方的大段英文注释，理解"为何没有运行时不变量"。
 * ==========================================================================
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-projection'

/** Cordis companion plugin name. */
export const name = 'session-projection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the registry's own contracts (duplicate-key and
 * stateVersion rejection, effect-tied removal, and the state/view `Object.is`
 * gates) are enforced synchronously inside the service and proven by its spec, the
 * drive relation (every committed `session/event` passes every unit) would
 * require re-running the drive to check — duplicating the implementation
 * rather than detecting drift — and the served-value relation (every served
 * key has a live registration) lives on each carrier's wire path, which
 * emits no cordis event this companion could observe; carrier specs assert
 * it. Synchronous-unit discipline is enforced as far as practical by the
 * boundary `schema.parse` (a Promise-returning view fails loudly).
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
