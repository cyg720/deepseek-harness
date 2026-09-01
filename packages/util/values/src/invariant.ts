/** Package-owned invariant companion for `@deepseek-ai/dsh-util-values`. */

/* jscpd:ignore-start */
/*
 * 中文导读：本模块校验值工具包的关键运行时关系，并作为该包拥有的不变量入口。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-util-values'

/** Cordis companion plugin name. */
export const name = 'util-values-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: these value operations have no shared runtime state. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
