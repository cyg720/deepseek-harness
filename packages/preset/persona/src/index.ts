/**
 * A per-agent persona as a composable row.
 *
 * `dsh-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `dsh-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @deepseek-ai/dsh-persona
 */

/*
 * 文件职责：实现 index.ts 承担的Agent Persona配置、注册与生命周期职责。
 * 技术维度：使用 TypeScript、Cordis 插件、配置校验和系统资源管理。
 * 产品维度：为 Agent 提供可靠的Agent Persona能力。
 * 逻辑维度：解析配置，注册能力，执行核心操作，并在卸载时等待资源停止。
 * 关键边界：安全配置应尽早失败；不得泄露环境凭据；清理必须达到静止状态。
 * 新手阅读建议：先看导出类型与配置，再读主流程，最后关注平台限制和清理。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'

export { PERSONA_SECTION }

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}

/** Runtime schema for the persona row. */
export const Config: z<Config> = z.object({
  text: z.string().required(),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
})

/**
 * Register the persona section for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the persona text and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA'),
    text: config.text,
    ...(config.complete ? { complete: true } : {}),
  }), 'persona.section()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
}
