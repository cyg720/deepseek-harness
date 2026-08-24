/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-command-feedback`.
 * @module @deepseek-ai/dsh-command-feedback/invariant
 */
/**
 * 文件职责：为反馈命令适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议保留包所有权。
 * 产品维度：让用户反馈命令进入运行时诊断清单。
 * 逻辑维度：元数据和空 install 经 apply 注册。
 * 关键边界：每条 feedback/record 都是独立追加事实，无跨事件关系。
 * 新手阅读建议：先理解追加事实模型，再看为何没有伴生关系可检查。
 */
// PACKAGE_NAME：反馈命令包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-command-feedback'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'command-feedback-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: each `feedback/record` is an independent append-only
 * fact with no cross-event or mutable-data relationship.
 */
/** install：空安装器；独立事实之间无关系可核对。 */
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
