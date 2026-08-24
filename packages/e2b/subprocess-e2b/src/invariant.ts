/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-subprocess-e2b`.
 * @module @deepseek-ai/dsh-subprocess-e2b/invariant
 */
/**
 * 文件职责：为 E2B 子进程提供者注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册表声明可释放包所有权。
 * 产品维度：让远程命令提供者进入诊断清单。
 * 逻辑维度：声明元数据、空安装器并注册。
 * 关键边界：远程句柄仅属清理实现，事件流是唯一结果权威。
 * 新手阅读建议：区分私有句柄与公开命令事件后阅读 install。
 */
// PACKAGE_NAME：E2B 子进程包的所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-subprocess-e2b'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'subprocess-e2b-invariant'
/** Service required before reserving package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: live remote handles are private teardown ownership,
 * and the E2B command event stream is the sole outcome authority.
 */
/** install：空安装器；命令事件流已是唯一权威。 */
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
