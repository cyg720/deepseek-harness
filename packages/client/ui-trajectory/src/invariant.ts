/**
 * ================================ 文件注释 ================================
 * 【文件职责】ui-trajectory 包对应的 Cordis 不变式（invariant）伴生插件：向 'invariants'
 *             服务登记本包"无运行时不变式"的声明。
 * 【技术维度】Cordis 插件模式：导出 name / inject / apply；安装函数 install 为空实现。
 * 【产品维度】invariant 体系在插件加载时校验各包声明的运行时约束；本包显式声明"无约束"
 *             是组合系统中可审计的一部分。
 * 【逻辑维度】1) 包名与插件名常量；2) 空的 install；3) apply 里 ctx.invariants.register
 *             完成登记并返回释放函数。
 * 【关键边界】本包是纯消费者：不发 Cordis 事件、不拥有可变跨插件状态；视图槽注册是
 *             普通 effect，由槽账本与行为 spec 直接观察其释放。
 * 【新手阅读建议】可与其它包的 invariant.ts 对比，理解伴生插件的固定骨架。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-trajectory`.
 * @module @deepseek-ai/dsh-client-ui-trajectory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-trajectory'

/** Cordis companion plugin name. */
// 伴生插件的注册名。
export const name = 'client-ui-trajectory-invariant'
/** Service required before the companion can reserve package ownership. */
// 声明依赖 'invariants' 服务：插件激活前该服务必须已存在。
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin — it emits no cordis events
 * and owns no mutable cross-plugin state; its view-slot registration is a
 * plain effect whose disposal the slot ledger's own specs and this
 * package's behavior specs observe directly.
 */
/*
 * 安装函数为空实现：本包是纯消费者，不发 Cordis 事件、不拥有可变跨插件状态；
 * 视图槽注册是普通 effect，其释放由槽账本与本包行为 spec 直接观察。
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 登记本包的 invariant 伴生插件。
 * @param ctx - 携带 invariant 服务的 Cordis 上下文。
 * @returns 登记成功后的释放函数（插件卸载时调用）。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
