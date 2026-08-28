/*
 * ================================ 文件注释 ================================
 * 【文件职责】session-projection-cache 包的 invariant 伴生插件：注册空安装器，
 *   说明本包无运行时不变量（行的正确性只能重跑折叠来核对——那是复制实现而非发现漂移；
 *   过期是设计使然（fail-soft 写），耐久边界已由 storage-domain 层 schema 校验）。
 * 【技术维度】标准 invariants 插件形态；文件被 jscpd:ignore 包裹。
 * 【逻辑维度】name/inject → 空 install（附论证）→ apply。
 * 【新手阅读建议】读 install 上方英文注释理解论证。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-session-projection-cache`.
 * @module @deepseek-ai/dsh-session-projection-cache/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-projection-cache'

/** Cordis companion plugin name. */
export const name = 'session-projection-cache-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the cache's correctness relation (a stored row equals
 * the registry fold at its `seq` watermark) is only checkable by re-running the
 * fold over the persisted log — duplicating the implementation rather than
 * detecting drift — and its staleness is by design (fail-soft writes). The
 * durable boundary is schema-validated by the cache's own zod parse on every
 * read, and the read ladder's version/watermark guards are proven
 * by the package spec.
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
