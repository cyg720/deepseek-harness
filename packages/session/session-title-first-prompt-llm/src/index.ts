/*
 * ================================ 文件注释 ================================
 * 【文件职责】"首个人类消息"的模型标题提供者插件：把会话标题服务注册为自动生成
 *   节奏 first-prompt，只用第一条人类消息生成标题。
 * 【技术维度】复用 dsh-session-title-llm 的共享注册/配置/调用策略；Config 与共享
 *   字段 schema 同源，Loader 要求每个插件导出自己的静态可遍历 schema。
 * 【产品维度】会话刚开始即获得模型生成的标题（只依据第一句人类输入）。
 * 【逻辑维度】name/inject → Config schema → apply（注册 first-prompt 提供者）。
 * 【关键边界】无人类消息时抛错（first-prompt 必须有一条）；jscpd pragma 保持原样。
 * 【新手阅读建议】把 apply 的选择器与 all-prompts 版本对比理解。
 * ==========================================================================
 */

/** First-human-message model provider for `ctx.sessionTitle`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  registerSessionTitleLlmProvider,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

// 中文：插件名与依赖：需要会话标题服务、LLM 服务与会话存储。
export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
/** Loader schema shared with the all-messages provider. */
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
 * Register the first-prompt model provider.
 * @param ctx - context exposing session-title, LLM, and session services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  registerSessionTitleLlmProvider(ctx, config, name, 'first-prompt', (messages) => {
    const first = messages[0]
    if (first === undefined) throw new Error('first-prompt title provider requires one human message')
    return [first]
  })
}
