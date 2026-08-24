/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-acp-snapshot`.
 * @module @deepseek-ai/dsh-acp-snapshot/invariant
 */
/**
 * 文件职责：为 ACP 快照测试支持包注册空不变量伴生插件。
 * 技术维度：使用 Cordis 诊断注册表。
 * 产品维度：让测试组合完整装配包清单。
 * 逻辑维度：固定元数据与空 install 经 apply 注册。
 * 关键边界：测试支持包无生产事件或状态，行为由消费测试验证。
 * 新手阅读建议：先看消费快照套件，再理解这里只保留所有权。
 */
// PACKAGE_NAME：ACP 快照支持包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-acp-snapshot'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'acp-snapshot-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this test-support package owns no production event stream or mutable data;
 * consuming test suites exercise its behavior.
 */
/** install：空安装器；行为由使用该包的测试套件覆盖。 */
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
