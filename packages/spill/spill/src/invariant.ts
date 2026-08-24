/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-spill`.
 * @module @deepseek-ai/dsh-spill/invariant
 */
/**
 * 文件职责：为溢出能力服务定义包注册空运行时不变量伴生插件。
 * 技术维度：通过 Cordis 不变量注册表声明所有权和可释放生命周期贡献。
 * 产品维度：让大输出溢出能力出现在诊断中，同时把真实约束保留在能力接缝实现处。
 * 逻辑维度：声明包名、插件名、依赖与空安装器，再由 apply 注册。
 * 关键边界：服务定义包没有独立事件序列或可变数据关系，不应检查方法是否存在。
 * 新手阅读建议：先区分服务定义与提供者，再看 install 注释解释为何无权威关系。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：溢出服务定义包的注册表所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-spill'

/** Cordis companion plugin name. */
/** name：伴生插件稳定名称。 */
export const name = 'spill-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所有权所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；拥有接缝已直接执行全部约束。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册溢出包伴生插件。@param ctx Cordis 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
