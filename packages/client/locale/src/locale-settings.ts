/**
 * ================================ 文件注释 ================================
 * 【文件职责】存储在 Host 用户设置文档中的语言偏好（locale preference）
 *   的线契约：命名空间、字段名、发货语言 id 与持久化 schema。
 * 【技术维度】纯契约模块：schemastery schema 同时是浏览器作用域校验的
 *   线信封；LOCALE_IDS 是发货语言的单一事实源。
 * 【产品维度】用户的语言选择持久化到 Host 设置文档，跨重启/跨浏览器生效；
 *   偏好缺失时委托给浏览器语言。
 * 【逻辑维度】命名空间常量、字段常量、id 数组与派生类型、持久化 schema。
 * 【关键边界】preference 字段可缺失（缺省委托浏览器）；schema 由 Host
 *   与浏览器共享以防漂移。
 * 【新手阅读建议】对照 client/index.ts 的 LocaleRuntime 使用点理解。
 * ==========================================================================
 */
/** Locale preference stored in the Host user-settings document. */
/** 存储在 Host 用户设置文档中的语言偏好。 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin. */
/** locale 插件拥有的设置命名空间。 */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
/** 携带显式语言选择的字段；缺失时委托给浏览器。 */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Locale identifiers shipped by the browser client. */
/** 浏览器客户端发货的语言标识符。 */
export const LOCALE_IDS = ['zh', 'en'] as const

/** Shipped locale identifier. */
/** 发货语言标识符。 */
export type LocaleId = typeof LOCALE_IDS[number]

/** Durable locale section shared by the Host schema and the browser scope. */
/** Host schema 与浏览器作用域共享的持久化语言段。 */
export interface LocaleSettings {
  /** Explicit locale selection; absence delegates to the browser. */
  /** 显式语言选择；缺失时委托给浏览器。 */
  preference?: LocaleId
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
/** 持久化语言 schema；也是浏览器作用域校验的线信封。 */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.union([...LOCALE_IDS]).required(false),
})
