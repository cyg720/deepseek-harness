/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-output-retention`.
 * @module @deepseek-ai/dsh-output-retention/invariant
 */
/**
 * 文件职责：为输出保留纯工具包注册空不变量伴生插件。
 * 技术维度：使用 Cordis 所有权注册而不创建状态。
 * 产品维度：让输出裁剪工具出现在诊断清单。
 * 逻辑维度：固定元数据与空安装器经 apply 注册。
 * 关键边界：纯值代数无事件或可变数据，由单元测试验证。
 * 新手阅读建议：先阅读工具函数测试，再理解这里只声明所有权。
 */
// PACKAGE_NAME：输出保留工具包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-output-retention'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'output-retention-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure utility owns no event stream or mutable runtime data; its value
 * algebra is enforced by unit tests.
 */
/** install：空安装器；纯值规则由单元测试覆盖。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
