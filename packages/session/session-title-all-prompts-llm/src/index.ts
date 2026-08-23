/**
 * ================================ 文件注释 ================================
 * 【文件职责】"全部人类消息"的模型标题提供者插件：以 all-prompts 节奏注册，
 *   用全部人类消息生成标题（首条消息版见 first-prompt 插件）。
 * 【技术维度】复用 dsh-session-title-llm 的共享注册/配置/调用策略；Config 与共享
 *   字段 schema 同源，Loader 要求每个插件导出自己的静态可遍历 schema。
 * 【产品维度】会话过程中标题随新的人类输入持续更新。
 * 【逻辑维度】name/inject → Config schema → apply（注册 all-prompts 提供者，选择器恒等）。
 * 【关键边界】无人类消息时由共享层拒绝；jscpd pragma 保持原样。
 * 【新手阅读建议】把 apply 的恒等选择器与 first-prompt 版对比理解。
 * ==========================================================================
 */

/** All-human-messages model provider for `ctx.sessionTitle`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

// 中文：插件名与依赖：需要会话标题服务、LLM 服务与会话存储。
export const name = 'session-title-all-prompts-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
/** Loader schema shared with the first-prompt provider. */
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
})
/* jscpd:ignore-end */

/**
 * Register the all-prompts model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  registerSessionTitleLlmProvider(ctx, config, name, 'all-prompts', messages => messages)
}
