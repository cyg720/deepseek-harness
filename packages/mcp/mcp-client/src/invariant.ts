/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-client`.
 * @module @deepseek-ai/dsh-mcp-client/invariant
 */
/**
 * 文件职责：为 MCP 客户端桥接器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议保留所有权。
 * 产品维度：让外部 MCP 工具集成可被诊断发现。
 * 逻辑维度：固定元数据和空 install 经 apply 注册。
 * 关键边界：异步重同步后没有独立服务器到工具快照可核对。
 * 新手阅读建议：先看工具注册生成过程，再理解缺少第二份权威快照。
 */
// PACKAGE_NAME：MCP 客户端包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-client'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'mcp-client-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: MCP generations contribute through the tool registry, but the bridge
 * exposes no independent server-to-tool snapshot after an asynchronous resync.
 */
/** install：空安装器；重同步后没有独立快照可交叉检查。 */
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
