/** Package-owned invariant companion for `@deepseek-ai/dsh-attachment-local`. @module @deepseek-ai/dsh-attachment-local/invariant */
/**
 * 文件职责：为本地附件后端注册包所有权明确的空不变量伴生插件。
 * 技术维度：使用 Cordis Context、固定插件元数据和 InvariantInstaller 注册协议。
 * 产品维度：让诊断系统确认本地附件实现已装配，同时避免重复执行后端已有校验。
 * 逻辑维度：声明包名、插件名、依赖与空安装器，apply 注册后返回注销函数。
 * 关键边界：不可变写入和验证读取已在后端入口强制执行，没有第二份状态可交叉检查。
 * 新手阅读建议：先看 inject 为什么同时需要 invariants 和 attachments，再理解 install 为空的依据。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：注册表中的本地附件包唯一所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-attachment-local'
/** Cordis companion plugin name. */
/** name：Cordis 伴生插件的稳定名称。 */
export const name = 'attachment-local-invariant'
/** Services required before package ownership can be reserved. */
/** inject：保留所有权前必须存在的不变量和附件服务。 */
export const inject = ['invariants', 'attachments']
/** No runtime invariant: immutable writes and verified reads are enforced directly at the backend boundary. */
/** install：空安装器；不可变写入与验证读取已由本地后端入口直接保证。 */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
/** 注册本地附件包伴生插件。@param ctx 含 invariants 服务的上下文。@returns 注销函数 Promise。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
