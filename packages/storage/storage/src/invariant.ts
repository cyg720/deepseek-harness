/**
 * ================================ 文件注释 ================================
 * 【文件职责】storage 包的"不变式伴生插件"（invariant companion）：登记一个空的
 * 运行时自检安装器。本包没有需要自检的不变式，但伴生插件的存在让 invariants 体系
 * 知道"本包已检查过、没有遗漏"。
 * 【技术维度】Cordis 伴生插件形态：导出 name/inject/apply；install 是一个空函数
 * （InvariantInstaller），注册到 invariants 服务。
 * 【产品维度】仓库的"不变式自检"体系要求每个包显式登记自己的伴生插件：哪怕没有
 * 运行时自检，也要占位声明"本包无自检项"，避免误以为遗漏。
 * 【逻辑维度】按出现顺序：PACKAGE_NAME（注册名）→ name/inject（插件元信息）→
 * install（空自检安装器）→ apply（注册入口）。
 * 【关键边界】注意：文件主体被 jscpd 重复检测豁免块（jscpd:ignore-start 与
 * jscpd:ignore-end 两个 pragma 注释）包裹，其中不应插入新注释，以免破坏 pragma
 * 与目标代码的相邻关系；因此本文件的元素级中文注释统一省略，作用见上文【逻辑维度】。
 * 【新手阅读建议】把本文件与 dsh-storage-domain 的 invariant.ts 对比着读：后者有
 * 真实自检逻辑，这里只是"无自检"占位，从而理解伴生插件的两种形态。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-storage`.
 * @module @deepseek-ai/dsh-storage/invariant
 */
/*
 * 模块总览：枢纽（hub）是纯注册表（名字→后端、形态→facility），其一致性已在调用点
 * 完全保证（重复/缺失条目同步报错），没有需要跨检查的事件流或可变介质——
 * 所以这里没有运行时自检，install 为空。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-storage'

/** Cordis companion plugin name. */
export const name = 'storage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the hub is a pure registration table (names →
 * backends, forms → facilities) whose consistency is fully enforced at the
 * call sites (duplicate/missing entries fail loud synchronously); it owns no
 * event stream or mutable medium to cross-check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
