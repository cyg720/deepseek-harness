/*
 * ================================ 文件注释 ================================
 * 【文件职责】agent-tool-presentation 包的伴生不变量占位：本包只做一次作用域内 ctx.tools 调用，不拥有事件或快照，安装器留空。
 * 【技术维度】Cordis 伴生插件模式；空的 InvariantInstaller；文件被 jscpd 忽略标记包裹（避免重复代码检测误报）。
 * 【产品维度】纯工程约定，无用户可见行为。
 * 【逻辑维度】PACKAGE_NAME/name/inject → 空 install → apply 注册。
 * 【关键边界】呈现关系由 dsh-tools 注册表持有并自行校验；本包不重复检查。
 * 【新手阅读建议】很短，直接读完；注意文件首尾的 jscpd pragma 注释不可改动。
 * ==========================================================================
 */
/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-tool-presentation`.
 * @module @deepseek-ai/dsh-agent-tool-presentation/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// 本包在 invariants 注册表中的包名，作为该贡献的唯一标识。
const PACKAGE_NAME = '@deepseek-ai/dsh-agent-tool-presentation'

/** Cordis companion plugin name. */
// 伴生插件名：与其它不变量插件一样，通过 invariants 服务统一装载与卸载。
export const name = 'tool-presentation-invariant'
/** Service required before the companion can reserve package ownership. */
// 依赖声明：必须先有 invariants 服务，本插件才能注册（空的）检查器。
export const inject = ['invariants']

/**
 * No runtime invariant: this package makes exactly one scoped call into
 * `ctx.tools` and owns no event or snapshot of its own; the relation it
 * establishes — which presentation one agent's assembly uses — is the tool
 * registry's to hold, and `dsh-tools` observes it there.
 */
// 空的安装器：本包只做一次作用域内的 presentAs 调用，呈现关系由 dsh-tools 注册表持有并校验，这里保持显式占位。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
// 注册入口：把（空的）install 安装到 invariants 服务中，返回的 disposer 用于卸载该占位贡献。
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
