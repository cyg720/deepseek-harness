/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-ask-user`.
 * @module @deepseek-ai/dsh-tool-ask-user/invariant
 */
/**
 * 文件职责：为模型可见询问用户工具注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册表声明适配器所有权。
 * 产品维度：让模型交互询问工具进入诊断清单。
 * 逻辑维度：固定元数据和空 install 经 apply 注册。
 * 关键边界：适配器无独立生命周期流，关系属于用户交互能力接缝。
 * 新手阅读建议：先看工具调用的服务 Consumer，再理解空检查。
 */
// PACKAGE_NAME：询问用户工具包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-ask-user'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'tool-ask-user-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent lifecycle stream; execution
 * relations are owned by the capability seam it calls.
 */
/** install：空安装器；执行关系由交互能力接缝拥有。 */
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
