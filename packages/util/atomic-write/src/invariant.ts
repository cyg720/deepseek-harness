/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-atomic-write`.
 * @module @deepseek-ai/dsh-atomic-write/invariant
 */
/*
 * 文件职责：为原子写入纯文件系统工具注册空不变量伴生插件。
 * 技术维度：使用 Cordis 所有权注册模式。
 * 产品维度：让安全替换工具可被诊断识别。
 * 逻辑维度：固定元数据与空 install 由 apply 注册。
 * 关键边界：无事件流或运行时状态，替换保证由单元测试验证。
 * 新手阅读建议：先看原子替换测试，再理解此处不保存第二份状态。
 */
// PACKAGE_NAME：原子写入包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-atomic-write'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'atomic-write-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this pure filesystem primitive owns no event stream or mutable runtime
 * data; its replacement contract is enforced by unit tests.
 */
/* install：空安装器；替换保证由单元测试覆盖。 */
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
