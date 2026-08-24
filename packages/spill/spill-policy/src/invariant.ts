/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-spill-policy`.
 * @module @deepseek-ai/dsh-spill-policy/invariant
 */
/**
 * 文件职责：为溢出策略 Consumer 注册空不变量伴生插件。
 * 技术维度：使用 Cordis 包所有权注册模式。
 * 产品维度：让工具输出溢出策略可被诊断识别。
 * 逻辑维度：元数据与空 install 由 apply 注册。
 * 关键边界：没有独立事件或可变关系，约束由 spill 接缝执行。
 * 新手阅读建议：先看策略如何调用 spill 服务，再理解空检查。
 */
// PACKAGE_NAME：溢出策略包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-spill-policy'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'spill-policy-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；关系由拥有接缝执行。 */
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
