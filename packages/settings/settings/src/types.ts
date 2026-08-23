/**
 * Client-safe type surface of the user-settings seam: the namespace brand, the
 * commit-origin union, and the seam's Cordis event declarations. Types only —
 * no runtime code, and nothing here reaches a Host-only symbol, so a Client
 * compilation face reads exactly the signatures the Host emits.
 *
 * @module @deepseek-ai/dsh-settings/types
 */

/**
 * ================================ 文件注释 ================================
 * 【文件职责】dsh-settings 缝对"客户端"（Client 编译面）暴露的纯类型表面：命名空间品牌类型、
 *   提交来源联合类型、以及 Cordis 事件声明。只含类型、无任何运行时代码。
 * 【技术维度】利用 TS declaration merging 扩展 Cordis 的 Events 接口；Branded 品牌类型防止
 *   裸字符串被误当作命名空间使用；不触碰 Host 专属符号，保证 Client 面读到的签名与 Host 一致。
 * 【产品维度】事件 settings/updated 与 settings/document-updated 是配置界面与插件感知设置
 *   变更的通道：前者面向消费方（按解析值是否变化过滤），后者面向配置面（按原始段落修订号通知）。
 * 【逻辑维度】命名空间品牌 → 更新来源联合 → 两个事件的声明与语义说明。
 * 【关键边界】监听器失败被包含并记日志，仅 INVARIANT 类失败在全部监听跑完后重抛；同步监听器
 *   不应写成 async（异步拒绝无法经 INVARIANT 重抛）。
 * 【新手阅读建议】先读 index.ts 理解事件在哪里发出，再回来看本文件的事件语义与参数说明。
 * ==========================================================================
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

// 命名空间是"品牌"类型：底层仍是 string，但编译器禁止与普通字符串混用，防止传错参数。
/** Nominal id of one registered settings namespace. */
export type SettingsNamespace = Branded<'SettingsNamespace'>

// 一次设置变更的来源：'update' 表示经服务 API 写入，'provider' 表示由存储层（如文件监听）发布。
/** Origin of one committed settings change. */
export type SettingsUpdateSource = 'update' | 'provider'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Committed change to one registered namespace's resolved value. Emitted
     * after the provider persisted (for `update`) or published (`provider`)
     * the change; never emitted when the resolved value is deep-equal.
     * Listener failures are contained and logged — a sync throw and an async
     * rejection alike — except `INVARIANT`-coded failures, which rethrow
     * after every listener ran; that rethrow reaches the emitter only from
     * synchronous listeners, so invariant checks on this event must not be
     * async functions.
     * @param ns - the namespace whose resolved value changed.
     * @param next - the new resolved value.
     * @param prev - the previous resolved value.
     * @param source - whether the change entered through `update()` or the provider.
     * @mode emit
     */
    // 提交事件：命名空间解析值发生变化后发出；消费方（设置 UI、插件逻辑）靠它感知变更并刷新。
    'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void

    /**
     * One registered namespace's RAW user section changed, whether or not the
     * resolved value did. `settings/updated` is the consumer-facing event and
     * stays deep-equal-gated; this one exists for configuration surfaces,
     * which must learn that a field went from inherited to overridden (same
     * resolved value, different meaning) and that their held revision is
     * stale. Listener containment matches `settings/updated`.
     * @param ns - the namespace whose stored section changed.
     * @param revision - the namespace's new revision.
     * @mode emit
     */
    // 文档事件：原始用户段落一有变化即发出（哪怕解析值未变），配置界面据此得知"字段从继承变为覆盖"。
    'settings/document-updated'(ns: SettingsNamespace, revision: number): void
  }
}
