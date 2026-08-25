/*
 * ================================ 文件注释 ================================
 * 【文件职责】ui-cordis（@deepseek-ai/dsh-client-ui-cordis）的"运行时不变量"配套
 *             插件：向 invariants 服务注册本包检查项，当前为空实现——见英文论证。
 * 【技术维度】InvariantInstaller 是 dsh-invariants 约定的安装器签名；apply 返回
 *             register 的 disposer；纯 Host 侧占位，浏览器侧状态不在其观察范围。
 * 【产品维度】不变量体系要求显式声明"本包无宿主侧可观察资源关系"：唯一可变关系
 *             （按定义划分的运行状态 observable）在浏览器进程，Host 侧既不发事件
 *             也不持有跨插件状态。
 * 【逻辑维度】常量 → 空安装器 → apply 注册并返回 disposer。
 * 【关键边界】本文件整体在 jscpd:ignore 豁免区内；勿添加运行逻辑。
 * 【新手阅读建议】结合 packages/AGENTS.md 的"运行时不变量"规则理解空实现的论证。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-cordis`.
 * @module @deepseek-ai/dsh-client-ui-cordis/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-cordis'

/** Cordis companion plugin name. */
/* 本不变量插件在 Cordis 中的注册名。 */
export const name = 'client-ui-cordis-invariant'
/** Service required before the companion can reserve package ownership. */
/* 前置依赖：需要 invariants 服务存在才能登记本包的不变量。 */
export const inject = ['invariants']

/**
 * No runtime invariant: a single keyed toolview registration whose disposal is
 * proven by the HMR-safety spec. The one mutable relation this package owns —
 * the per-definition run-state observable — lives in the browser process, out
 * of reach of the host invariant service, and the node half emits no cordis
 * events and holds no cross-plugin state.
 */
// 不安装运行时检查：唯一的 keyed toolview 注册的卸载已由 HMR 安全规范证明；
// 本包唯一可变关系（按定义划分的运行状态 observable）在浏览器进程，Host 半部
// 不发 cordis 事件也不持有跨插件状态
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
