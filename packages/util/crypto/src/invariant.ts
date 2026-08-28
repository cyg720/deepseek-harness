/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-util-crypto`.
 * @module @deepseek-ai/dsh-util-crypto/invariant
 */
/*
 * 文件职责：为 ACP 演示组合包注册说明充分的空不变量伴生插件。
 * 技术维度：使用 Cordis 注册表为组合入口保留包所有权和释放函数。
 * 产品维度：让示例组合可被诊断清单识别，帮助开发者验证完整 ACP 装配。
 * 逻辑维度：固定包名与元数据，空 install 由 apply 注册。
 * 关键边界：组合包不拥有独立事件流或可变数据；接线由 Loader 与构建入口测试覆盖。
 * 新手阅读建议：先把该包视为装配层，再看为什么真实检查位于各能力包中。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-util-crypto'

/** Cordis companion plugin name. */
export const name = 'util-crypto-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure utility owns no event stream or mutable runtime data; its value
 * algebra is enforced by unit tests.
 */
/* install：空安装器；组合接线由 Loader 和构建入口测试验证。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册 ACP 演示伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
