/**
 * ================================ 文件注释 ================================
 * 【文件职责】fs-sandbox 包的"不变式伴生插件"：登记一个空的自检安装器。
 * 【技术维度】Cordis 伴生插件形态：导出 name/inject/apply；install 为空函数。
 * 【产品维度】本包是无状态适配器：策略关系与文件系统关系都委托给各自的所属接缝，
 * 没有可连续观察的进程内关系，所以无运行时自检，仅做体系占位。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→
 * install（空自检安装器）→ apply（注册入口）。
 * 【关键边界】文件主体被 jscpd 重复检测豁免块（jscpd:ignore-start 与
 * jscpd:ignore-end 两个 pragma）包裹，元素级中文注释统一省略。
 * 【新手阅读建议】先读英文模块注释理解"为什么没有自检"，再看 apply 理解占位注册。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fs-sandbox`.
 * @module @deepseek-ai/dsh-fs-sandbox/invariant
 */
/*
 * 模块总览：沙箱后端只加"按调用策略围栏"，策略与文件系统关系都在各自接缝，
 * 故 install 为空，仅做体系占位。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fs-sandbox'

/** Cordis companion plugin name. */
export const name = 'fs-sandbox-invariant'
/** Services required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: this stateless adapter delegates policy and filesystem relations to their owning seams. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
