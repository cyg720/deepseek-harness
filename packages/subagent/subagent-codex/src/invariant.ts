/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-subagent-codex`.
 * @module @deepseek-ai/dsh-subagent-codex/invariant
 */
/**
 * 文件职责：为 Codex 子代理提供者注册包所有权明确的空不变量伴生插件。
 * 技术维度：使用 Cordis 不变量注册协议提供可释放的诊断贡献。
 * 产品维度：让 Codex 子代理集成可被诊断发现，同时复用共享生命周期和进程所有权检查。
 * 逻辑维度：声明包键、插件名、依赖和空 install，再由 apply 注册。
 * 关键边界：生命周期配对属于 subagent 服务，进程树属于 subprocess 服务，本包不能重复检查。
 * 新手阅读建议：先沿两个共享服务查找权威检查，再回来看该提供者只保留包所有权。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：Codex 子代理提供者的不变量键。
const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-codex'

/** Cordis companion plugin name. */
/** name：伴生插件稳定名称。 */
export const name = 'subagent-codex-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: lifecycle pairing belongs to the shared subagent
 * service and process-tree ownership belongs to the subprocess service.
 */
/** install：空安装器；生命周期与进程树检查分别由共享服务拥有。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
/** 注册 Codex 子代理伴生插件。@param ctx 含注册表的上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
