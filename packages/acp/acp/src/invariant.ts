/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-acp`.
 * @module @deepseek-ai/dsh-acp/invariant
 */
/*
 * 文件职责：为 ACP 传输包注册所有权明确的空运行时不变量伴生插件。
 * 技术维度：使用 Cordis 插件元数据和不变量注册器提供可释放贡献。
 * 产品维度：让诊断清单识别 ACP 能力，同时避免凭空制造不存在的持久状态检查。
 * 逻辑维度：声明包名、name、inject 和空 install，再由 apply 完成注册。
 * 关键边界：ACP 不拥有包内持久事件流；映射和生命周期正确性由协议测试覆盖。
 * 新手阅读建议：先读 install 上方理由，再沿 apply 查看注册表使用的包名。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：ACP 包在不变量注册表中的唯一键。
const PACKAGE_NAME = '@deepseek-ai/dsh-acp'

/** Cordis companion plugin name. */
/* name：Cordis 伴生插件稳定名称。 */
export const name = 'acp-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册前必须存在的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this transport owns no durable package-local event stream;
 * protocol and lifecycle tests cover its mapping.
 */
/* install：空安装器；该传输没有独立持久状态，映射由协议与生命周期测试证明。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册 ACP 包伴生插件。@param ctx 含不变量服务的上下文。@returns 安装成功后的注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
