/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-primitives 包对应的 Cordis 不变式（invariant）伴生插件：向 'invariants'
 *             服务登记本包"无运行时不变式"的声明。
 * 【技术维度】Cordis 插件模式：导出 name / inject / apply；安装函数 install 为空实现，
 *             因为纯 props 型 React 组件没有事件、服务、跨插件可变状态可断言。
 * 【产品维度】invariant 体系在插件加载时校验各包声明的运行时约束；本包显式声明"无约束"
 *             是组合系统中可审计的一部分。
 * 【逻辑维度】1) 包名与插件名常量；2) 空的 install；3) apply 里 ctx.invariants.register
 *             完成登记并返回释放函数。
 * 【关键边界】整个文件体被 jscpd 忽略块包裹（模板化伴生插件的重复检测豁免）；没有任何
 *             真实断言，属于"有解释的空伴生"。
 * 【新手阅读建议】可与其它包的 invariant.ts 对比阅读，理解伴生插件的固定骨架。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-primitives`.
 * @module @deepseek-ai/dsh-client-ui-primitives/invariant
 */
/**
 * 本文件是 ui-primitives 包的 invariant 伴生插件：向 'invariants' 服务登记
 * "本包无运行时不变式"这一事实。纯 props 型 React 组件没有事件、服务与跨插件状态，
 * 因此安装函数为空实现。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包 npm 名，作为 invariant 登记的键。
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-primitives'

/** Cordis companion plugin name. */
// 伴生插件的注册名。
export const name = 'client-ui-primitives-invariant'
/** Service required before the companion can reserve package ownership. */
// 声明依赖 'invariants' 服务：插件激活前该服务必须已存在。
export const inject = ['invariants']

/**
 * No runtime invariant: pure props-in React atoms with no Cordis API —
 * no events, no services, no mutable cross-plugin state; rendering contracts
 * are asserted directly by this package's component specs.
 */
/**
 * 安装函数为空实现：本包不声明任何运行时不变式（理由见英文注释与文件头说明）。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/**
 * 登记本包的 invariant 伴生插件。
 * @param ctx - 携带 invariant 服务的 Cordis 上下文。
 * @returns 登记成功后的释放函数（插件卸载时调用）。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
