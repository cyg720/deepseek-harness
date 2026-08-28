/** Chat transcript preferences stored in the Host user-settings document.
 * @remarks 文件说明：文件职责：实现 client/ui-chat 中 chat settings 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 client/ui-chat 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target.
 * @remarks 中文说明：常量说明：CHAT_SETTINGS_NAMESPACE 用于处理 CHAT_SETTINGS_NAMESPACE
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode.
 * @remarks 中文说明：常量说明：TRANSCRIPT_VIEW_FIELD 用于处理 TRANSCRIPT_VIEW_FIELD 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes accepted at settings boundaries.
 * @remarks 中文说明：常量说明：TRANSCRIPT_VIEW_MODES 用于处理 TRANSCRIPT_VIEW_MODES 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Default preserves the compact process disclosure introduced by Chat.
 * @remarks 中文说明：常量说明：DEFAULT_TRANSCRIPT_VIEW_MODE 用于处理
 * DEFAULT_TRANSCRIPT_VIEW_MODE 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content. */
  transcriptView: TranscriptViewMode
}

/** Durable Chat schema; also the wire envelope the browser scope validates against.
 * @remarks 中文说明：常量说明：ChatSettingsSchema 用于处理 ChatSettingsSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
})
