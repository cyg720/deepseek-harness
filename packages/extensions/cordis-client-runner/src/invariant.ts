/**
 * ================================ 文件注释 ================================
 * 【文件职责】cordis-client-runner（@deepseek-ai/dsh-cordis-client-runner）的"运行时
 *             不变量"配套插件：向 invariants 服务注册本包检查项，当前为空实现。
 * 【技术维度】InvariantInstaller 是 dsh-invariants 约定的安装器签名；apply 返回
 *             register 的 disposer；纯 Host 侧占位，浏览器侧状态不可观察。
 * 【产品维度】不变量体系要求显式声明"本包无宿主侧可观察资源关系"：唯一拥有的关系
 *             （插件 loader 条目 ↔ 运行 ID 存活）在浏览器进程，已由包自身测试覆盖。
 * 【逻辑维度】常量 → 空安装器 → apply 注册并返回 disposer。
 * 【关键边界】本文件整体在 jscpd:ignore 豁免区内；勿添加运行逻辑。
 * 【新手阅读建议】结合 packages/AGENTS.md 的"运行时不变量"规则理解空实现的论证。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-client-runner`.
 * @module @deepseek-ai/dsh-cordis-client-runner/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-client-runner'

/** Cordis companion plugin name. */
/** 本不变量插件在 Cordis 中的注册名。 */
export const name = 'cordis-client-runner-invariant'
/** Service required before the companion can reserve package ownership. */
/** 前置依赖：需要 invariants 服务存在才能登记本包的不变量。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the owned relation (a live
 * Plugin's loader entry exists exactly while one Plugin Run ID is live) is
 * browser-only state reachable through the client half's service, which the
 * node-plane companion cannot observe. The relation is asserted by the
 * package's own load/teardown coverage instead.
 */
// 不安装运行时检查：本包拥有的关系（"某插件的 loader 条目存在，当且仅当某个运行
// ID 存活"）是浏览器侧状态，经 Client 半部服务可达，Node 平面的配套插件无法观察；
// 该关系由包自身的加载/卸载测试覆盖
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 插件入口：把本包的不变量安装器注册进 invariants 服务，返回卸载函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
