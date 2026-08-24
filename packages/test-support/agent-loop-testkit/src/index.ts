/**
 * Shared mounting for the services required before tests load the concrete
 * agent loop. The caller retains ownership of the context, loop, adapters,
 * optional plugins, and teardown.
 * @module @deepseek-ai/dsh-agent-loop-testkit
 */
/**
 * 中文说明：
 * - 文件职责：为 AgentLoop 测试按固定顺序装载其标准前置服务，但保留循环和适配器控制权给用例。
 * - 技术维度：使用 Cordis 异步插件装载、TypeScript 配置类型和上下文所有权生命周期。
 * - 产品维度：减少代理循环测试的重复搭建，同时确保测试仍可验证不同装载拓扑。
 * - 逻辑维度：依次装载 LLM、会话、系统提示、工具和代理注册服务，并转发两项可选配置。
 * - 关键边界：不会装载 AgentLoop 或注册模型适配器；部分装载失败时资源仍由调用方上下文释放。
 * - 新手阅读建议：先看 Options 可配置的两个服务，再对照函数内五个 plugin 调用理解依赖顺序。
 */

import type { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Config as SystemPromptConfig } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { Config as ToolRuntimeConfig } from '@deepseek-ai/dsh-tools'

/** Configuration forwarded to the prerequisite service plugins. */
/** 中文：传递给 AgentLoop 前置服务的可选测试配置。 */
export interface AgentLoopTestDependenciesOptions {
  /** Configuration for the system-prompt registry. */
  /** 中文：系统提示注册表配置；省略时传入空对象。 */
  readonly systemPrompt?: SystemPromptConfig
  /** Configuration for the tool registry. */
  /** 中文：工具注册表配置；省略时传入空对象。 */
  readonly tools?: ToolRuntimeConfig
}

/**
 * Mount the standard prerequisite services for an AgentLoop test.
 *
 * The function deliberately does not mount AgentLoop or register an adapter,
 * so tests retain control of load order and the topology under test. The
 * context owns every mounted service and remains responsible for disposal. A
 * plugin-load failure rejects the promise; services activated earlier in the
 * sequence remain context-owned and unwind with that context.
 * @param ctx - test context that owns the mounted services.
 * @param options - optional service configuration forwarded without mutation.
 * @returns after every prerequisite service has activated.
 */
/** 中文：向 ctx 装载标准前置服务；options 原样转交相应插件，全部激活后 Promise 完成且无返回数据。 */
export async function mountAgentLoopTestDependencies(
  ctx: Context,
  options: AgentLoopTestDependenciesOptions = {},
): Promise<void> {
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, options.systemPrompt ?? {})
  await ctx.plugin(ToolRuntime, options.tools ?? {})
  await ctx.plugin(AgentRegistry)
}
