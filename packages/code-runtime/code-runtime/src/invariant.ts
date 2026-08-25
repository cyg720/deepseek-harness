/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-code-runtime`.
 * @module @deepseek-ai/dsh-code-runtime/invariant
 */
/*
 * 文件职责：为代码运行时服务定义包注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议声明所有权。
 * 产品维度：让代码执行能力接缝进入诊断清单。
 * 逻辑维度：包键、元数据与空 install 经 apply 注册。
 * 关键边界：服务定义没有独立事件或状态，约束由提供者接缝执行。
 * 新手阅读建议：先区分服务定义与 Worker/Python 提供者，再看此入口。
 */
// PACKAGE_NAME：代码运行时包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-code-runtime'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'code-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/* install：空安装器；运行约束由能力接缝拥有。 */
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
