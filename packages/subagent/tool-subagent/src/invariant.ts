/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-subagent`.
 * @module @deepseek-ai/dsh-tool-subagent/invariant
 */
/**
 * 文件职责：为模型可见子代理工具适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 所有权注册协议。
 * 产品维度：让子代理委派工具可被诊断发现。
 * 逻辑维度：元数据和空安装器经 apply 注册。
 * 关键边界：适配器无独立生命周期流，关系由 subagent 接缝拥有。
 * 新手阅读建议：区分工具 Consumer 与子代理服务后阅读。
 */
// PACKAGE_NAME：子代理工具包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-subagent'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'tool-subagent-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent lifecycle stream; execution
 * relations are owned by the capability seam it calls.
 */
/** install：空安装器；执行关系由子代理能力接缝拥有。 */
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
