/*
 * ================================ 文件注释 ================================
 * 【文件职责】注册 dsh-shell 包在 invariants 服务中的"包属主"（package ownership）声明：
 * 本包只定义请求/结果类型契约，没有需要运行时观测的不变式，因此安装函数为空实现，仅作占位。
 * 【技术维度】Cordis 伴生插件模式：导出 name / inject / apply 三件套，apply 内通过
 * ctx.invariants.register 把包名与安装函数挂钩；invariants 服务借此保证每个观察点只有一个
 * 包声明归属，防止不同包重复接管同一检查项。
 * 【产品维度】工程治理设施而非用户功能：为将来在本包增加运行时不变式检查预留唯一登记入口，
 * 也让诊断工具知道"这个包的不变式归谁管"。
 * 【逻辑维度】定义包名常量 → 声明插件名与依赖服务 → 定义（空）安装函数 → apply 注册并返回释放器。
 * 【关键边界】inject 依赖必须在插件启动前就绪；register 返回的释放器由 Cordis 在插件卸载时
 * 自动调用，本文件只是原样透传。
 * 【新手阅读建议】先看 apply 的注册调用理解"伴生插件"如何把包绑定到 invariants 服务；
 * 空 install 说明当前确实没有需要运行时观测的不变式，不必寻找遗漏。
 * ==========================================================================
 */

/** Package-owned invariant companion for the bash seam. @module @deepseek-ai/dsh-shell/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-shell'
/* 本包的 npm 完整名称，作为 invariants 服务中包属主登记的键。 */

/** Cordis companion plugin name. */
/* 伴生插件的注册名，出现在 Cordis 日志与依赖图中。 */
export const name = 'shell-invariant'
/** Service required before the companion can reserve package ownership. */
/* 插件启动前必须已加载的服务列表：invariants 服务就绪后本伴生插件才能完成注册。 */
export const inject = ['invariants']

/** No runtime invariant: this stateless Service Definition owns request/result types, while executors and policy own observations. */
/* 安装函数体：本包为纯类型契约包，无运行时不变式，故为空实现（显式声明而非遗漏）。 */
const install: InvariantInstaller = () => {}

/**
 * Register the bash invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/*
 * 注册本包的 invariants 伴生插件。
 * @param ctx 携带 invariants 服务的 Cordis 上下文
 * @returns 注册完成后得到的释放器，插件卸载时由 Cordis 自动调用
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
