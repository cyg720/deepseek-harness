/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-app-boot`.
 * @module @deepseek-ai/dsh-app-boot/invariant
 */
/*
 * 文件职责：为应用启动展示适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 不变量注册协议保留包所有权。
 * 产品维度：让启动适配层可被诊断发现而不重复协议测试。
 * 逻辑维度：固定元数据和空 install 由 apply 注册。
 * 关键边界：没有包内持久事件流；映射由边界与回放测试覆盖。
 * 新手阅读建议：先读 install 理由，再看 apply 的注册参数。
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

// PACKAGE_NAME：应用启动包的不变量所有权键。
const PACKAGE_NAME = '@deepseek-ai/dsh-app-boot'

/** Cordis companion plugin name. */
/* name：伴生插件稳定名称。 */
export const name = 'app-boot-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需的不变量服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this presentation adapter owns no durable package-local event stream;
 * boundary and replay tests cover its protocol mapping.
 */
/* install：空安装器；协议映射由边界和回放测试证明。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
/* 注册应用启动伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
