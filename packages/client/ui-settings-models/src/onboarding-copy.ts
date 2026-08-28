/*
 * ================================ 文件注释 ================================
 * 【文件职责】产品级 GUI 引导（onboarding）的持久设置命名空间常量与文案：
 *             欢迎通知的版本确认与双语内测声明。
 * 【技术维度】纯常量：命名空间/字段/版本号 + 双语文案对象（as const）。
 * 【产品维度】首次运行的"内测声明"对话框及其"已读确认"的持久化。
 * 【逻辑维度】WELCOME_NOTICE_VERSION 是精确相等比较的版本号；
 *             WELCOME_NOTICE_COPY 是双语完整可编辑文案。
 * 【关键边界】版本号仅在声明发生实质变化、需所有用户重看时递增。
 * 【新手阅读建议】与 welcome-store.ts 的读写对照阅读。
 * ==========================================================================
 */
/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-13.1'
