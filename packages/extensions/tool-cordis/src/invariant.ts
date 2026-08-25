/*
 * ================================ 文件注释 ================================
 * 【文件职责】tool-cordis 的"运行时不变量"配套插件：向 invariants 服务注册本包
 *             的检查项。当前为空实现——见英文注释论证。
 * 【技术维度】InvariantInstaller 是 dsh-invariants 约定的安装器签名；register 返回
 *             可卸载的 disposer；apply 是 Cordis 插件约定的入口。
 * 【产品维度】运行时不变量体系要求显式声明"本包没有需要运行期观察的资源关系"，
 *             由包测试直接覆盖，避免重复实现。
 * 【逻辑维度】常量声明 → 空安装器 → apply 注册并返回 disposer。
 * 【关键边界】本文件整体在 jscpd:ignore 豁免区内（与各包 invariant 文件近似），
 *             勿添加运行逻辑。
 * 【新手阅读建议】结合 packages/AGENTS.md 的"运行时不变量"规则理解空实现的合理性。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-cordis`.
 * @module @deepseek-ai/dsh-tool-cordis/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-cordis'

/** Cordis companion plugin name. */
/* 本不变量插件在 Cordis 中的注册名。 */
export const name = 'tool-cordis-invariant'
/** Service required before the companion can reserve package ownership. */
/* 前置依赖：需要 invariants 服务存在才能登记本包的不变量。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this model-facing adapter has no independent lifecycle stream; execution
 * relations are owned by the capability seam it calls.
 */
// 不安装运行时检查：本包是模型侧适配层，没有独立生命周期流；执行关系归其所调的
// 能力接缝（host-runner 等）所有
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
