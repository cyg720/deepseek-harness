/** Package-owned invariant companion for `@deepseek-ai/dsh-attachment`. @module @deepseek-ai/dsh-attachment/invariant */
/**
 * 文件职责：为附件服务定义包注册一个说明充分的空运行时不变量伴生插件。
 * 技术维度：使用 Cordis Context、不变量注册器、固定元数据和 Promise 包装注册清理函数。
 * 产品维度：让诊断系统确认附件包已参与应用组合，同时把存储校验留给具体实现。
 * 逻辑维度：声明包名、插件名和依赖，定义空安装器，再由 apply 注册并返回注销函数。
 * 关键边界：该服务定义层无可验证运行时关系；不可在此伪造对具体不可变存储的检查。
 * 新手阅读建议：先看 PACKAGE_NAME、name、inject 三项元数据，再跟踪 apply 到 register 的参数。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：不变量注册表中的附件包唯一所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-attachment'
/** Cordis companion plugin name. */
/** name：Cordis 中该伴生插件的稳定名称。 */
export const name = 'attachment-invariant'
/** Service required before package ownership can be reserved. */
/** inject：apply 前必须可用的不变量服务依赖列表。 */
export const inject = ['invariants']
/** No runtime invariant: this stateless seam owns types while implementations enforce immutable-store checks. */
/** install：无参数、无返回值的空安装器；具体实现负责不可变存储检查。 */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
/**
 * 向不变量服务注册附件包伴生模块。
 * @param ctx - 已提供 invariants 服务的 Cordis 上下文。
 * @returns 解析为注册注销函数的 Promise。
 * @example const dispose = await apply(ctx)
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
