/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-subagent-report`.
 * @module @deepseek-ai/dsh-tool-subagent-report/invariant
 */
/*
 * 文件职责：为子代理报告工具适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 包所有权注册协议。
 * 产品维度：让子代理交付工具进入诊断清单。
 * 逻辑维度：元数据和空 install 经 apply 注册。
 * 关键边界：发送者授权与交付关系由 subagent 服务拥有。
 * 新手阅读建议：先看报告工具如何调用服务，再看权威关系位置。
 */
// PACKAGE_NAME：子代理报告工具所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-subagent-report'

/** Cordis companion plugin name. */
/* name：稳定伴生名称。 */
export const name = 'tool-subagent-report-invariant'
/** Service required before the companion can reserve package ownership. */
/* inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter has no independent lifecycle stream;
 * sender authorization and delivery relations belong to the subagent service.
 */
/* install：空安装器；授权和交付关系由子代理服务检查。 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - context carrying the invariant service.
 * @returns the registration disposer after setup succeeds.
 */
/* 注册伴生插件。@param ctx 上下文。@returns 注销函数。@example await apply(ctx)。 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
