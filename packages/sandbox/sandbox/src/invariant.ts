/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sandbox`.
 * @module @deepseek-ai/dsh-sandbox/invariant
 */
/**
 * 文件职责：为沙箱服务定义包注册包所有权明确的空不变量伴生插件。
 * 技术维度：使用 Cordis 不变量注册协议提供统一插件元数据和注销生命周期。
 * 产品维度：让沙箱能力接缝可被诊断发现，而不在服务定义层臆造提供者状态。
 * 逻辑维度：声明所有权键、名称、依赖和空安装器，再由 apply 注册。
 * 关键边界：该包没有独立事件或可变关系；安全约束由具体提供者边界执行。
 * 新手阅读建议：先区分 sandbox 服务定义与各平台提供者，再理解空检查的正确性。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：沙箱服务定义包的不变量键。
const PACKAGE_NAME = '@deepseek-ai/dsh-sandbox'

/** Cordis companion plugin name. */
/** name：伴生插件稳定名称。 */
export const name = 'sandbox-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；安全与生命周期约束由拥有接缝和提供者执行。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册沙箱包伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
