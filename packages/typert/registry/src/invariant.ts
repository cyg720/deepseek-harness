/*
 * ================================ 文件注释 ================================
 * 【文件职责】typert-registry 包的"不变量伴随插件"（invariant companion）：按仓库约定，
 *             每个包都要在 invariants 服务里注册一个以包名为 key 的安装器。
 * 【技术维度】标准 Cordis 插件三件套：name / inject / apply。InvariantInstaller 是
 *             @deepseek-ai/dsh-invariants 定义的回调类型。
 * 【产品维度】本包没有运行时不变量可校验：schema 与包反射记录在 register / dispose
 *             内部一起变更，没有独立事件流或第二数据源可交叉核对；重复身份在所属
 *             操作边界处失败，因此安装器为空实现。
 * 【逻辑维度】按代码顺序：常量 PACKAGE_NAME；插件名 name 与依赖注入列表 inject；
 *             空安装器 install；入口 apply 向 invariants 注册并返回撤销函数。
 * 【关键边界】整个文件被 jscpd:ignore pragma 包裹，因为各包的 invariant 文件高度相似、
 *             属预期重复。不要在这些 pragma 与被保护代码之间插入任何注释。
 * 【新手阅读建议】先看仓库对 invariant companion 的约定，再看 apply 如何注册 install；
 *             空实现是"有意为之"，不是漏写。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-typert-registry`.
 * @module @deepseek-ai/dsh-typert-registry/invariant
 */
// 中文导读：这是 Cordis 插件形态的"伴随插件"，负责在运行时注册中心（invariants 服务）
// 里声明本包的存在；本包没有真正的不变量需要检查，安装器是空实现。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 中文：以包名作为注册 key，保证各包在 invariants 服务里互不冲突。
const PACKAGE_NAME = '@deepseek-ai/dsh-typert-registry'

/** Cordis companion plugin name. */
// 中文：Cordis 伴随插件的名字，加载插件系统时使用。
export const name = 'typert-registry-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：声明本插件依赖的 Cordis 服务：要求 invariants 服务先于本插件存在。
export const inject = ['invariants']

/**
 * No runtime invariant: schema and package-reflection records mutate together
 * inside register/dispose, with no independent event or second data source to
 * cross-check; duplicate identities fail at the owning operation boundary.
 */
// 中文：空安装器——schema 与包反射记录在 register / dispose 内部一起变更，没有独立
// 事件或第二数据源可交叉核对；重复身份在所属操作边界处直接失败，因此无需注册不变量。
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
