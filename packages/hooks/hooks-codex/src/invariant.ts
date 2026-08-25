/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-hooks-codex`.
 * @module @deepseek-ai/dsh-hooks-codex/invariant
 */
/*
 * 文件职责：为 Codex Hook 桥接器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议声明包所有权。
 * 产品维度：让 Codex Hook 集成出现在诊断清单。
 * 逻辑维度：固定元数据与空安装器由 apply 注册。
 * 关键边界：调用与结果引用关系由 hook-protocol 事件伴生检查拥有。
 * 新手阅读建议：先沿事件协议查找权威检查，再看此桥接层职责。
 */
// PACKAGE_NAME：Codex Hook 包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hooks-codex'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'hooks-codex-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this bridge publishes hook-protocol session events, whose companion owns
 * which invocation event each result cites.
 */
/* install：空安装器；结果引用由 Hook 协议伴生模块检查。 */
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
