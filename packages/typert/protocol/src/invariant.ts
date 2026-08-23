/**
 * ================================ 文件注释 ================================
 * 【文件职责】typert-protocol 包的"不变量伴随插件"（invariant companion）：按仓库约定，
 *             每个包都要在 invariants 服务里注册一个以包名为 key 的安装器。
 * 【技术维度】标准 Cordis 插件三件套：name / inject / apply。InvariantInstaller 是
 *             @deepseek-ai/dsh-invariants 定义的回调类型。
 * 【产品维度】本包没有运行时不变量可校验：装饰器只保留私有不可变声明，绑定是冻结值，
 *             没有独立事件流可以交叉核对，因此安装器是空实现，仅保留"包所有权"占位。
 * 【逻辑维度】按代码顺序：常量 PACKAGE_NAME；插件名 name 与依赖注入列表 inject；
 *             空安装器 install；入口 apply 向 invariants 注册并返回撤销函数。
 * 【关键边界】整个文件被 jscpd:ignore pragma 包裹，因为各包的 invariant 文件高度相似、
 *             属预期重复。不要在这些 pragma 与被保护代码之间插入任何注释。
 * 【新手阅读建议】先看仓库对 invariant companion 的约定，再看 apply 如何注册 install；
 *             空实现是"有意为之"，不是漏写。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-typert-protocol`.
 * @module @deepseek-ai/dsh-typert-protocol/invariant
 */
// 中文导读：这是 Cordis 插件形态的"伴随插件"，负责在运行时注册中心（invariants 服务）
// 里声明本包的存在；本包没有真正的不变量需要检查，安装器是空实现。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 中文：以包名作为注册 key，保证各包在 invariants 服务里互不冲突。
const PACKAGE_NAME = '@deepseek-ai/dsh-typert-protocol'

/** Cordis companion plugin name. */
// 中文：Cordis 伴随插件的名字，加载插件系统时使用。
export const name = 'typert-protocol-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：声明本插件依赖的 Cordis 服务：要求 invariants 服务先于本插件存在。
export const inject = ['invariants']

/**
 * No runtime invariant: decorators retain private immutable declarations and
 * bindings are frozen values with no independent event stream to cross-check.
 */
// 中文：空安装器——本包没有可交叉核对的独立事件流，装饰器声明不可变、绑定是冻结值，
// 因此没有任何运行时不变量需要注册，此回调什么都不做。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 中文：插件入口：把本包的安装器以包名注册进 invariants 服务，返回注册的撤销函数。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
