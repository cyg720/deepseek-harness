/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-e2b`.
 * @module @deepseek-ai/dsh-e2b/invariant
 */
/**
 * 文件职责：为 E2B 沙箱控制器包注册说明充分的空不变量伴生插件。
 * 技术维度：通过 Cordis 不变量注册协议保留包所有权并支持生命周期注销。
 * 产品维度：让远程沙箱能力可被诊断发现，而不复制 SDK 自身的创建与销毁状态。
 * 逻辑维度：固定包名、插件名、依赖和空安装器，再由 apply 注册。
 * 关键边界：沙箱创建与销毁只有一个 SDK Promise，没有独立可变关系可核对。
 * 新手阅读建议：先理解“单一权威 Promise”，再看为什么正确伴生实现可以为空。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：E2B 控制器包的不变量所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-e2b'

/** Cordis companion plugin name. */
/** name：伴生插件的 Cordis 名称。 */
export const name = 'e2b-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册前需要的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: sandbox creation and teardown have one SDK promise and
 * no independent event or mutable-data relationship to cross-check.
 */
/** install：空安装器；SDK Promise 是创建和销毁结果的唯一权威来源。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册 E2B 包伴生插件。@param ctx 含注册表的上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
