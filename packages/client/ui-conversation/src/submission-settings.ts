/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义会话插件的持久化用户设置：繁忙时按 Enter 的投递行为（queue / steer），
 *             含命名空间、字段名、行为枚举、默认值与 Schemastery schema。
 * 【技术维度】Schemastery（z）schema 定义 + 命名空间字符串；被宿主设置插件与浏览器端
 *             settingsScope 共同引用。
 * 【产品维度】用户在设置页选择"繁忙时 Enter 是排队还是插话"，选择持久化到用户设置文档。
 * 【逻辑维度】1) 命名空间与字段常量；2) 行为枚举与默认值；3) 设置接口；4) schema。
 * 【关键边界】schema 也是浏览器端校验的线格式信封；默认保持"排队"（不打断运行中会话）。
 * 【新手阅读建议】理解"命名空间 + 字段 + 枚举 + 默认值 + schema"五件套的结构。
 * ==========================================================================
 */
/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
// 会话插件拥有的设置命名空间。
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
// 承载"繁忙时 Enter 行为"的设置字段名。
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
// 设置边界与输入边界都接受的两种行为：queue（排队）/ steer（插话）。
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
// 繁忙时按 Enter 的可配置含义。
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
// 默认值：queue——运行中的会话保持"Enter 即排队"，不打断当前生成。
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Durable conversation section shared by the Host schema and the browser scope. */
// 宿主 schema 与浏览器端共用的持久化会话设置段。
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  // 繁忙时按 Enter 的投递模式。
  busyEnter: BusyEnterBehavior
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
// 持久化会话 schema；同时也是浏览器端校验所依据的线格式信封。
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
})
