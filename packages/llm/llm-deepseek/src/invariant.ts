/*
 * ================================ 文件注释 ================================
 * 【文件职责】以 Cordis 伴生插件形式注册 dsh-llm-deepseek 包的"不变量
 * 伴生"（invariant companion）：本包没有独立的事件序列或可变数据关系可校验，
 * 因此安装一个空实现以满足统一的伴生注册机制。
 * 【技术维度】基于 @deepseek-ai/dsh-invariants 的 InvariantInstaller 接口；
 * 整个实现体被 jscpd:ignore 区域包裹，因为它与 llm 包的同名伴生文件高度
 * 相似（本包没有可校验内容，只有占位安装器）。
 * 【产品维度】不变量机制是 harness 的工程质量护栏；每个包统一注册伴生插件
 * 后，运行时检查框架才知道"该包没有需要校验的流协议"，避免误报。
 * 【逻辑维度】包名常量 → 插件元信息（name/inject）→ 空安装器 → apply 注册。
 * 【关键边界】install 为空是刻意的：本包不变量在所属缝合层（llm 包）已由
 * 对方校验，这里不重复也不发明新的校验。
 * 【新手阅读建议】全文很短；先读英文模块注释，再看 install 为何是空函数。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-deepseek`.
 * @module @deepseek-ai/dsh-llm-deepseek/invariant
 */

// 中文：下方整个区域与 llm 包的 invariant 伴生文件结构相似（仅内容为占位），
// 因此被 jscpd 复制检测忽略；PACKAGE_NAME 是本包注册不变量时的包名标识，
// name 是伴生插件名，inject 声明依赖 invariants 服务，install 是空安装器
// （本包没有独立可校验的状态，apply 负责登记并返回 disposer）。
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-deepseek'

/** Cordis companion plugin name. */
export const name = 'llm-deepseek-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
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
