/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-goal`.
 * @module @deepseek-ai/dsh-tool-goal/invariant
 */
/*
 * 文件职责：为面向模型的目标工具适配层声明包级不变量伴生插件。
 * 技术维度：使用 Cordis 依赖注入和 dsh-invariants 注册机制，以安装器描述可执行检查。
 * 产品维度：让维护者能在统一审计入口确认该包是否拥有需要持续核对的运行时关系。
 * 逻辑维度：声明包名、插件名和依赖，准备安装器，再由 apply 完成注册。
 * 关键边界：目标状态变更由目标领域和权限逻辑验证，本包不重复拥有状态。
 * 新手阅读建议：先看 PACKAGE_NAME 与 inject，再理解 install 是否安装检查，最后阅读 apply 的注册过程。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-goal'
// 不变量注册表使用的正式包名；必须与当前 npm 包标识保持一致。

/** Cordis companion plugin name. */
/* Cordis 配置中引用的伴生插件名称；它不是面向最终用户的显示文本。 */
export const name = 'tool-goal-invariant'
/** Service required before the companion can reserve package ownership. */
/* 启动前必须注入的不变量服务；数组中的名称由 Cordis 依赖注入解析。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter owns no independent state or event protocol;
 * accepted mutations are checked by the goal domain and authority behavior is package-tested.
 */
// 本安装器不增加检查；原因见上方说明，空函数仍用于保留明确的包级登记。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册本包的不变量声明。@param ctx 提供不变量服务的 Cordis 上下文。@returns 解除本次注册的函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
