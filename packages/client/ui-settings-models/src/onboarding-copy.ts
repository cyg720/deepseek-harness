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

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '内测声明',
    body: 'DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。',
    continueLabel: '继续',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.",
    continueLabel: 'Continue',
  },
} as const
