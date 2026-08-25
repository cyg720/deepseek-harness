/*
 * ================================ 文件注释 ================================
 * 【文件职责】以 Cordis 伴生插件形式注册 dsh-token-meter 包的"不变量伴生"：
 * 本包没有独立可校验的运行时关系，因此安装一个空实现以满足统一的伴生机制。
 * 【技术维度】基于 @deepseek-ai/dsh-invariants 的 InvariantInstaller 接口；
 * 整个实现体被 jscpd:ignore 区域包裹（与同构的伴生文件相似）。
 * 【产品维度】不变量机制是 harness 的工程质量护栏；每个包统一注册伴生插件，
 * 框架才知道"该包无需运行时校验"。
 * 【逻辑维度】包名常量 → 插件元信息（name/inject）→ 空安装器 → apply 注册。
 * 【关键边界】install 为空是刻意的：token 估计是逐调用输出、私有会话缓存在
 * 事件变更边界失效；三个投影的 schema 已固定 JSON 载荷，折叠语义由构造保证，
 * 无需运行时观测。
 * 【新手阅读建议】全文很短；英文注释解释了"为什么没有运行时不变量"。
 * ==========================================================================
 */

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-token-meter`.
 * @module @deepseek-ai/dsh-token-meter/invariant
 */

// 中文：下方区域与同构伴生文件相似，被 jscpd 忽略；PACKAGE_NAME 是注册标识，
// name/inject 是插件元信息，install 为空安装器（token 计量不变量由 schema 与
// 构造保证），apply 负责登记并返回 disposer。
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-token-meter'

/** Cordis companion plugin name. */
export const name = 'token-meter-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: token estimates are per-call outputs and the private
 * session cache is invalidated at its event mutation boundary. The package's
 * three projections do expose observation streams, but their schemas fix the
 * JSON payloads; the usage folds replace same-step samples, so totals need not
 * be monotone when a final sample corrects an earlier chunk, and the
 * composition fold prices through the same `estimate.ts` heuristic as the
 * measurement service and subtracts producer-logged shadow prices derived
 * from that service's own nodes, which makes its message figure equal
 * `measure().surfaceTokens` by construction rather than by a relation worth
 * observing at runtime.
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
