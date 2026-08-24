/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-invariants`.
 * @module @deepseek-ai/dsh-invariants/invariant
 */
/**
 * 文件职责：为不变量注册服务自身保留包所有权的空伴生插件。
 * 技术维度：使用服务自己的注册 API 创建可释放贡献。
 * 产品维度：让诊断基础设施本身出现在完整包清单。
 * 逻辑维度：固定元数据和空 install 经 apply 自注册。
 * 关键边界：从同一注册表观察所有权只会复制实现，不能形成独立权威关系。
 * 新手阅读建议：先看注册服务的 mutation API，再理解自检为何应为空。
 */
// PACKAGE_NAME：不变量服务包自身的所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'invariants-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：自注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: registration ownership and child lifecycle are the service's mutation
 * boundary itself; observing them from the same registry would only duplicate its implementation.
 */
/** install：空安装器；同一注册表不是独立权威来源。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/** 注册服务自身伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
