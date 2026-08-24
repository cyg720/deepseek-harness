/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fs-e2b`.
 * @module @deepseek-ai/dsh-fs-e2b/invariant
 */
/**
 * 文件职责：为 E2B 文件系统提供者注册包所有权空不变量伴生插件。
 * 技术维度：使用 Cordis 插件元数据与 InvariantInstaller 接入统一诊断注册表。
 * 产品维度：让远程文件系统实现出现在诊断清单中，不重复校验控制器已提交的结果。
 * 逻辑维度：声明所有权键和依赖，使用空 install，再由 apply 返回注销函数。
 * 关键边界：每次操作直接返回 E2B 控制器提交结果，没有独立事件或缓存可交叉检查。
 * 新手阅读建议：先读空安装器理由，再区分“提供者已装配”和“另有状态需要校验”。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：E2B 文件系统包的注册表所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-fs-e2b'

/** Cordis companion plugin name. */
/** name：伴生插件稳定名称。 */
export const name = 'fs-e2b-invariant'
/** Service required before reserving package ownership. */
/** inject：注册所有权所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: each operation returns the E2B controller's committed
 * result directly, with no independent event or cache to cross-check.
 */
/** install：空安装器；控制器结果之外没有第二份事件或缓存。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册 E2B 文件系统伴生插件。@param ctx 插件上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
