/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-spill-local`.
 * @module @deepseek-ai/dsh-spill-local/invariant
 */
/**
 * 文件职责：为本地溢出提供者注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议保留包所有权。
 * 产品维度：让本地大输出存储实现进入诊断清单。
 * 逻辑维度：元数据和空安装器由 apply 注册。
 * 关键边界：没有独立事件或可变关系；约束由 spill 接缝执行。
 * 新手阅读建议：先看提供者与服务定义分工，再读 install。
 */
// PACKAGE_NAME：本地溢出包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-spill-local'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'spill-local-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；约束已在拥有接缝执行。 */
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
