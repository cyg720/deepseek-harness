/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-brand`.
 * @module @deepseek-ai/dsh-brand/invariant
 */

/* jscpd:ignore-start */
/*
 * 文件职责：为品牌类型纯工具包注册说明充分的空不变量伴生插件。
 * 技术维度：使用 Cordis 与不变量注册协议声明包所有权，不引入额外运行时状态。
 * 产品维度：让诊断系统看见基础类型工具，同时保持其零状态、零副作用特性。
 * 逻辑维度：固定元数据和空安装器由 apply 注册并返回可释放贡献。
 * 关键边界：品牌代数只存在于类型和值转换层；没有事件流或可变数据可检查。
 * 新手阅读建议：先理解品牌工具为何是纯函数，再看注册贡献与运行时检查的区别。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-brand'

/** Cordis companion plugin name. */
export const name = 'brand-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this utility owns no event stream, shared identity, or mutable module state.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
