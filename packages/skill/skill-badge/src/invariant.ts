/*
 * ================================ 文件注释 ================================
 * 【文件职责】本文件是 dsh-skill-badge 包的不变量伴生插件：向全局 invariants 服务注册本包名，
 *             声明该包没有独立的运行时状态需要交叉校验。
 * 【技术维度】Cordis 插件三要素 + invariants.register()；整段模板被 jscpd 忽略标记包裹以防查重误报。
 * 【产品维度】让仓库统一的不变量框架覆盖每一个包，保持治理一致性。
 * 【逻辑维度】包名常量 → 空安装器 install → apply() 注册并返回释放函数。
 * 【关键边界】jscpd pragma 与代码的相对位置不可变动；空注册是刻意设计，不是遗漏。
 * 【新手阅读建议】与同组其他 invariant.ts 完全同构，读懂一个即懂全部。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-skill-badge`.
 * @module @deepseek-ai/dsh-skill-badge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 服务中登记的包名。
const PACKAGE_NAME = '@deepseek-ai/dsh-skill-badge'

/** Cordis companion plugin name. */
// 伴生插件名，供加载器日志与诊断使用。
export const name = 'skill-badge-invariant'
/** Service required before the companion can reserve package ownership. */
// 声明依赖：invariants 服务就绪后本插件才执行。
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns one immutable provider registration,
 * while the skill registry owns registration uniqueness and lifecycle checks.
 */
// 本包没有运行时校验逻辑——它只持有一份不可变的提供者注册，注册唯一性与生命周期
// 检查由技能注册表（ctx.skills）负责，因此安装器为空函数。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 插件入口 apply：注册本包到 invariants 服务，成功后可解除注册。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
