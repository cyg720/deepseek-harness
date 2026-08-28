/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-store`.
 * @module @deepseek-ai/dsh-client-store/invariant
 */
/*
 * 文件职责：为 SDK JSON-RPC 演示组合注册空不变量伴生插件。
 * 技术维度：使用 Cordis 所有权注册协议。
 * 产品维度：让示例组合出现在诊断清单。
 * 逻辑维度：元数据和空 install 经 apply 注册。
 * 关键边界：组合包无独立事件或状态，接线由入口测试验证。
 * 新手阅读建议：先看示例导出与 CLI，再阅读此占位贡献。
 */
// PACKAGE_NAME：JSON-RPC 演示包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-store'

/** Cordis companion plugin name. */
export const name = 'client-store-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: the package exports a library engine and creates no
 * process-global state; each store instance is covered by its owning tests.
 */
/* install：空安装器；接线由 Loader 与构建入口测试覆盖。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
