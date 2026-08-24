/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-jobs`.
 * @module @deepseek-ai/dsh-tool-jobs/invariant
 */
/**
 * 文件职责：为模型可见后台任务工具适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 不变量注册协议。
 * 产品维度：让任务控制工具可被诊断发现。
 * 逻辑维度：声明所有权元数据并注册空 install。
 * 关键边界：适配器无独立生命周期流，执行关系属于 jobs 能力接缝。
 * 新手阅读建议：先区分工具 Consumer 与任务服务，再看空检查依据。
 */
// PACKAGE_NAME：任务工具包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-jobs'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'tool-jobs-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent lifecycle stream; execution
 * relations are owned by the capability seam it calls.
 */
/** install：空安装器；执行关系由任务能力接缝拥有。 */
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
