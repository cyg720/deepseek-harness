/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-subagent-claude-code`.
 * @module @deepseek-ai/dsh-subagent-claude-code/invariant
 */
/**
 * 文件职责：为 Claude Code 子代理提供者注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议保留提供者所有权。
 * 产品维度：让 Claude Code 子代理集成进入诊断清单。
 * 逻辑维度：固定元数据和空 install 经 apply 注册。
 * 关键边界：生命周期由 subagent 服务、进程树由 subprocess 服务检查。
 * 新手阅读建议：先找到两个共享服务的权威关系，再看此处为空。
 */
// PACKAGE_NAME：Claude Code 子代理包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subagent-claude-code'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'subagent-claude-code-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: lifecycle pairing belongs to the shared subagent
 * service and process-tree ownership belongs to the subprocess service.
 */
/** install：空安装器；生命周期和进程树由共享服务拥有。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - plugin context carrying the invariant registry.
 * @returns the installed registration's disposer.
 */
/** 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
