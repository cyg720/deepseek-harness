/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-subagent-acp`.
 * @module @deepseek-ai/dsh-subagent-acp/invariant
 */
/**
 * 文件职责：为 ACP 子代理提供者注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册表声明包所有权。
 * 产品维度：让外部 ACP 子代理集成可被诊断发现。
 * 逻辑维度：固定元数据和空安装器经 apply 注册。
 * 关键边界：独立生命周期与数据关系由共享 subagent 接缝拥有。
 * 新手阅读建议：先看提供者调用共享服务的位置，再理解此处为空。
 */
// PACKAGE_NAME：ACP 子代理包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-acp'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'subagent-acp-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；关系由共享能力接缝检查。 */
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
