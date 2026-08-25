/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-hooks-claude-code`.
 * @module @deepseek-ai/dsh-hooks-claude-code/invariant
 */
/*
 * 文件职责：为 Claude Code Hook 桥接器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 包所有权注册协议。
 * 产品维度：让 Hook 集成进入诊断清单。
 * 逻辑维度：元数据和空 install 经 apply 注册。
 * 关键边界：结果引用关系由 hook-protocol 事件伴生检查拥有。
 * 新手阅读建议：先看 Hook 协议事件，再理解桥接层不重复检查。
 */
// PACKAGE_NAME：Claude Code Hook 包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hooks-claude-code'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'hooks-claude-code-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this bridge publishes hook-protocol session events, whose companion owns
 * which invocation event each result cites.
 */
/* install：空安装器；调用结果引用由协议伴生模块拥有。 */
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
