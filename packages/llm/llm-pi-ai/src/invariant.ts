/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-pi-ai`.
 * @module @deepseek-ai/dsh-llm-pi-ai/invariant
 */
/**
 * 文件职责：为 Pi AI 模型提供者注册空不变量伴生插件。
 * 技术维度：使用统一 Cordis 注册元数据。
 * 产品维度：让模型适配器可被诊断识别。
 * 逻辑维度：包键、名称、依赖和空 install 经 apply 注册。
 * 关键边界：没有独立事件或可变关系；约束由 LLM 接缝拥有。
 * 新手阅读建议：先阅读 LLM 服务定义，再理解此处只保留所有权。
 */
// PACKAGE_NAME：Pi AI 包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-pi-ai'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'llm-pi-ai-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this package exposes no independent event sequence or mutable data relation
 * beyond contracts enforced at its owning seam.
 */
/** install：空安装器；运行约束由拥有接缝执行。 */
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
