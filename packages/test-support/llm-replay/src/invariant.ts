/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-replay`.
 * @module @deepseek-ai/dsh-llm-replay/invariant
 */
/**
 * 文件职责：为固定脚本模型回放适配器注册空不变量伴生插件。
 * 技术维度：使用 Cordis 注册协议加入测试组合。
 * 产品维度：支持无密钥确定性模型回放测试的完整诊断清单。
 * 逻辑维度：声明元数据和空 install，经 apply 注册。
 * 关键边界：流语法由 LLM 伴生检查与夹具派生测试拥有。
 * 新手阅读建议：先阅读回放夹具格式，再看此入口为何不重复解析。
 */
// PACKAGE_NAME：模型回放测试包所有权键。

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-replay'

/** Cordis companion plugin name. */
/** name：稳定伴生名称。 */
export const name = 'llm-replay-invariant'
/** Service required before the companion can reserve package ownership. */
/** inject：注册所需服务。 */
export const inject = ['invariants']

/**
 * No runtime invariant: this test-only adapter consumes a fixed replay script; its stream grammar
 * is checked by the LLM companion and fixture derivation tests.
 */
/** install：空安装器；流语法由 LLM 伴生与夹具测试验证。 */
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
