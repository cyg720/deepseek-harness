/*
 * ================================ 文件注释 ================================
 * 【文件职责】tool-session-query 包的 invariant 伴生插件：注册空安装器，
 *   说明本包无运行时不变量（只读模型适配器不拥有事件或可变数据关系）。
 * 【技术维度】标准 invariants 插件形态；文件被 jscpd:ignore 包裹。
 * 【逻辑维度】name/inject → 空 install（附论证）→ apply。
 * 【新手阅读建议】读 install 上方英文注释理解论证。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-session-query`.
 * @module @deepseek-ai/dsh-tool-session-query/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-session-query'

/** Cordis companion plugin name. */
export const name = 'tool-session-query-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this read-only model adapter owns no event or mutable
 * data relationship beyond the registries that already validate registration.
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
