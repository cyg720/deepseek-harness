/*
 * ================================ 文件注释 ================================
 * 【文件职责】为 dsh-api-remotes 包提供"包级不变量伴随插件"：向
 * dsh-invariants 服务注册本包名字，声明本包对运行时不变量关系的所有权。
 * 【技术维度】Cordis 插件标准三要素（name / inject / apply）+ 空安装器：
 * 与 dsh-api-gateway 的同名文件是同一模板的镜像实现。
 * 【产品维度】不变量体系让架构约束在运行期可被检查与归属；本包声明无额外
 * 运行时检查，因为 Typert 与 Agent/Session 注册表本身就拥有这些关系。
 * 【逻辑维度】包名常量 → 插件名 name → 依赖声明 inject → 空安装器 install
 * → 注册入口 apply。
 * 【关键边界】整段被 jscpd:ignore 包裹避免重复代码误报；只做注册，不含业务逻辑。
 * 【新手阅读建议】与 gateway/invariant.ts 对照阅读，体会伴随插件模板；再
 * 看 dsh-invariants 的 register 用法。
 * ==========================================================================
 */
/** Package-owned invariant companion for `@deepseek-ai/dsh-api-remotes`. */
// 英文模块注释的中文解释：本文件是 dsh-api-remotes 包自带的
// "包级不变量伴随插件"，负责把本包名字注册进不变量体系。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 中文：本包在 Cordis 中的完整名字，作为不变量注册的键，保证归属记录唯一可读。
const PACKAGE_NAME = '@deepseek-ai/dsh-api-remotes'

/** Cordis companion plugin name. */
// 中文：Cordis 伴随插件名，与其他插件区分，避免重名冲突。
export const name = 'api-remotes-invariant'
/** Service required before the companion can reserve package ownership. */
// 中文：声明依赖的 Cordis 服务——invariants 就绪后插件才会被启动。
export const inject = ['invariants']

/** No runtime invariant: Typert and the Agent/Session registries own the observed relationships. */
// 中文：本包声明"没有运行时的不变量"：Typert 注册表与 Agent / Session
// 注册表本身就拥有这些被观察的关系，无需额外守护。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 中文：把 (包名, 安装器) 注册进 invariants 服务并返回注销函数；
// Promise.resolve 包一层以满足 Cordis 异步插件入口的约定。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
