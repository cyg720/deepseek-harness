/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-loader-smoke`.
 * @module @deepseek-ai/dsh-loader-smoke/invariant
 */
/**
 * 文件职责：为 Loader 冒烟测试支持包注册空不变量伴生插件。
 * 技术维度：使用 Cordis 包所有权注册模式。
 * 产品维度：支持完整测试组合的插件清单诊断。
 * 逻辑维度：元数据和空安装器经 apply 注册。
 * 关键边界：不拥有生产事件或可变数据，行为由消费测试证明。
 * 新手阅读建议：先阅读 Loader 冒烟用例，再看空安装器理由。
 */
// PACKAGE_NAME：Loader 冒烟支持包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-loader-smoke'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'loader-smoke-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this test-support package owns no production event stream or mutable data;
 * consuming test suites exercise its behavior.
 */
/** install：空安装器；消费测试拥有行为验证。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
