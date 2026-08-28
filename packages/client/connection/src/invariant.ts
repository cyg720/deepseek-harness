/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-connection`.
 * @module @deepseek-ai/dsh-client-connection/invariant
 */
/*
 * 文件职责：为客户端连接线协议层声明包级不变量伴生插件。
 * 技术维度：使用 Cordis 依赖注入与 dsh-invariants 注册机制表达包所有权。
 * 产品维度：帮助维护者确认该包是否拥有需要持续审计的运行时关系。
 * 逻辑维度：声明注册元数据，准备安装器，再由 apply 登记并返回注销函数。
 * 关键边界：连接与重连由行为测试验证，RPC 标识由协议层拥有，路由注册对称性由 Web 服务器包审计。
 * 新手阅读建议：先看 inject，再理解 install 为空的理由，最后阅读 apply。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-connection'
// 不变量注册表使用的正式包名，必须与 npm 包标识一致。

/** Cordis companion plugin name. */
/* Cordis 配置引用的伴生插件名称。 */
export const name = 'client-connection-invariant'
/** Service required before the companion can reserve package ownership. */
/* 插件启动前必须注入的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: browser-session verification reads the credential
 * record asynchronously at the request that authorizes work, while the
 * credentials companion owns record commit-event lifetime. Stream/reconnect
 * sequencing and rpcId round-trip discipline are exercised directly by
 * behavior specs, and route register/dispose symmetry is
 * audited by the webserver companion.
 */
// 本包没有可独立观察的运行时关系，因此安装器不增加检查。
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册不变量声明。@param ctx Cordis 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
