/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-home-paths`.
 * @module @deepseek-ai/dsh-home-paths/invariant
 */
/**
 * 文件职责：为主目录路径纯工具包注册说明充分的空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议表达包所有权，不创建事件或缓存。
 * 产品维度：让路径工具可被运行时诊断识别，同时保持纯函数行为。
 * 逻辑维度：固定元数据和空 install 通过 apply 注册并返回注销函数。
 * 关键边界：没有运行时数据关系可检查；路径值代数由单元测试验证。
 * 新手阅读建议：先阅读工具本身的输入输出，再理解伴生入口只保留所有权。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：主目录路径工具的不变量键。
const PACKAGE_NAME = '@deepseek-ai/dsh-home-paths'

/** Cordis companion plugin name. */
/** name：伴生插件稳定名称。 */
export const name = 'home-paths-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure utility owns no event stream or mutable runtime data; its value
 * algebra is enforced by unit tests.
 */
/** install：空安装器；纯路径值规则由单元测试覆盖。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册主目录路径伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
