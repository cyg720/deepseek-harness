/**
 * ================================ 文件注释 ================================
 * 【文件职责】为 dsh-api-gateway 包提供"包级不变量伴随插件"（invariant
 * companion）：向 dsh-invariants 服务注册本包的名字，声明本包对运行期
 * 不变量关系的所有权，是包级"自检契约"体系的组成部分。
 * 【技术维度】采用 Cordis 插件标准三要素：name（插件名）/ inject（依赖
 * 服务）/ apply（启动入口）；安装器 install 为空函数，表示本包声明"没有
 * 需要额外守护的运行时不变量"。
 * 【产品维度】不变量体系让架构约束在运行期可被检查、可被定位到负责人；
 * 网关声明无额外不变量，是因为其调用路径每次都会重新读取权威状态。
 * 【逻辑维度】按出现顺序：包名常量 PACKAGE_NAME → 插件名 name → 依赖
 * 声明 inject → 空安装器 install → 注册入口 apply（调用
 * ctx.invariants.register 把 (包名, 安装器) 登记上去）。
 * 【关键边界】整段逻辑被 jscpd:ignore 包裹，避免被重复代码检测器误报；
 * 本文件只做注册，不得包含任何真实业务逻辑。
 * 【新手阅读建议】先理解 Cordis 插件三要素（name / inject / apply）是
 * 固定约定，再看 dsh-invariants 提供的 register 接口，最后对照
 * dsh-api-remotes 的同名文件，体会"每包一个伴随插件"的模板化写法。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-api-gateway`.
 * @module @deepseek-ai/dsh-api-gateway/invariant
 */
// 英文模块注释的中文解释：本文件是 dsh-api-gateway 包自带的
// "包级不变量伴随插件"，负责把本包名字注册进不变量体系。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 中文：本包在 Cordis 中的完整名字，作为不变量注册的键（key），
// 保证"每个包负责哪些不变量"的归属记录唯一且可读。
const PACKAGE_NAME = '@deepseek-ai/dsh-api-gateway'

/** Cordis companion plugin name. */
// 中文：Cordis 伴随插件名，须与其他插件区分，避免重名冲突。
export const name = 'api-gateway-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：声明本插件依赖的 Cordis 服务——只有 invariants 服务就绪后插件才会
// 被启动，否则无法完成注册（Cordis 的 inject 机制保证启动顺序）。
export const inject = ['invariants']

/**
 * No runtime invariant: Host calls re-read authoritative Cordis and Typert
 * state, while Client methods, descriptors, and `$on` subscriptions mutate in
 * one owned effect.
 */
// 中文：本包声明"没有运行时的不变量"：网关的 Host 调用每次都重新读取
// Cordis 与 Typert 的权威状态（无需缓存守护），而客户端侧的方法、描述符
// 与 $on 订阅都在同一次受管 effect 内变更，因此不需要额外的检查逻辑。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 中文：把 (包名, 安装器) 注册进 invariants 服务，返回注销函数（disposer）；
// 用 Promise.resolve 包一层，使 apply 满足 Cordis 对异步插件入口的约定。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
