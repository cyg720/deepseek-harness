/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-timeout`.
 * @module @deepseek-ai/dsh-timeout/invariant
 */
/*
 * 文件职责：为超时纯工具包注册包所有权明确的空不变量伴生插件。
 * 技术维度：使用统一 Cordis 注册元数据，不为纯函数工具引入可变状态。
 * 产品维度：让诊断清单包含超时工具，同时保持其实现轻量且行为由测试证明。
 * 逻辑维度：声明包键、名称、依赖与空安装器，apply 返回注册注销函数。
 * 关键边界：该包没有事件流或运行时数据关系；值代数只应由单元测试验证。
 * 新手阅读建议：先确认工具包的纯函数性质，再理解空 invariant 不是跳过检查。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：超时工具包的不变量所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-timeout'

/** Cordis companion plugin name. */
/* name：伴生插件稳定名称。 */
export const name = 'timeout-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：唯一所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure utility owns no event stream or mutable runtime data; its value
 * algebra is enforced by unit tests.
 */
/* install：空安装器；纯值代数由单元测试负责。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册超时工具伴生插件。@param ctx Cordis 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
