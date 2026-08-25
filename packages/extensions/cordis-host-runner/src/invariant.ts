/**
 * ================================ 文件注释 ================================
 * 【文件职责】cordis-host-runner 的"运行时不变量"配套插件：向 invariants 服务注册
 *             本包的检查项。当前不变量为空实现——见下方英文注释的论证。
 * 【技术维度】InvariantInstaller 是 dsh-invariants 约定的安装器签名；register 返回
 *             可卸载的 disposer；apply 是 Cordis 插件约定的入口（返回卸载函数）。
 * 【产品维度】仓库的"运行时不变量"体系要求在运行期断言跨组件的资源归属关系；
 *             本包因为不变量已被测试直接覆盖，故声明"无运行时不变量"以显式占位。
 * 【逻辑维度】常量声明（包名/插件名/inject）→ 空安装器 → apply 注册并返回 disposer。
 * 【关键边界】注意本文件整体被 jscpd:ignore 豁免（与同类包的 invariant 文件近似）；
 *             不要在其中添加运行逻辑。
 * 【新手阅读建议】结合 packages/AGENTS.md 的"运行时不变量"规则理解：为什么一个
 *             空实现是"正确"的。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-cordis-host-runner`.
 * @module @deepseek-ai/dsh-cordis-host-runner/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-cordis-host-runner'

/** Cordis companion plugin name. */
/* 本不变量插件在 Cordis 中的注册名。 */
export const name = 'cordis-host-runner-invariant'
/** Service required before the companion can reserve package ownership. */
/* 前置依赖：需要 invariants 服务存在才能登记本包的不变量。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the definition registry is process memory with no event
 * stream to observe, and its one owned relation (a running definition owns a
 * settled host-half fiber and its handler table) is established and unwound
 * inside single awaited verbs, so package tests assert it directly.
 */
// 不安装任何运行时检查：定义注册表只是进程内存、无事件流可观察，且唯一的所有权
// 关系在单个 await 动词内建立与解除，已由包测试直接断言
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 插件入口：把本包的不变量安装器注册进 invariants 服务，返回卸载函数。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
