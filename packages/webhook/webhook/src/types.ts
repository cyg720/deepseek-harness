/** Provider-neutral webhook deliveries, rules, and Session requests. */

/*
 * 文件说明：文件职责：实现 webhook/webhook 中 types 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 webhook/webhook 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { WebhookDeliveryId, WebhookRuleId, WebhookSourceId } from './brand.ts'

/** Provider adapters add their normalized event type through declaration merging. */
export interface WebhookEventMap {}

/** Event value for a known provider kind, or generic lossless JSON for an out-of-tree kind. */
export type WebhookEventOf<K extends string> =
  K extends keyof WebhookEventMap ? WebhookEventMap[K] : JsonValue

/** One authenticated and parsed provider delivery. */
export interface VerifiedWebhookDelivery<K extends string = string> {
  /** Provider family such as `github`. */
  readonly kind: K
  /** Configured adapter instance such as `primary-github`. */
  readonly source: WebhookSourceId
  /** Provider identity exposed as provenance, never as built-in deduplication state. */
  readonly deliveryId: WebhookDeliveryId
  /** Provider-normalized lossless JSON. */
  readonly event: WebhookEventOf<K>
  /** Host receipt time in Unix epoch milliseconds. */
  readonly receivedAt: number
}

/** Optional explicit model route and output cap for a webhook-created Agent. */
export interface WebhookModelSelection {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Optional positive output-token cap. */
  readonly maxTokens?: number
}

/** The sole runtime action: create and prompt one root Session. */
export interface WebhookSessionRequest {
  /** Existing local directory to resolve or create as a Web Workspace. */
  readonly workspacePath: string
  /** Explicit Session title. */
  readonly title: string
  /** Non-empty initial text prompt. */
  readonly prompt: string
  /** Agent composition mounted before publication. */
  readonly agentPreset: string
  /** Sandbox and approval preset applied before prompt admission. */
  readonly permissionPreset: string
  /** Optional explicit route; omission uses the complete current default, including reasoning effort. */
  readonly model?: WebhookModelSelection
}

/** Trusted code that optionally creates one Session for a delivery. */
export interface WebhookRule<K extends string = string> {
  /** Globally unique diagnostic identity. */
  readonly id: WebhookRuleId
  /** Provider kind this rule receives. */
  readonly kind: K
  /**
   * Run arbitrary trusted code and optionally request one Session.
   * @param delivery - immutable authenticated provider data.
   * @param signal - aborts when this registration or the runtime unloads.
   * @returns one Session request, or `null` for no action.
   */
  run(
    delivery: Readonly<VerifiedWebhookDelivery<K>>,
    signal: AbortSignal,
  ): WebhookSessionRequest | null | Promise<WebhookSessionRequest | null>
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Programmatic input admitted from one verified webhook rule. */
    webhook: {
      readonly kind: 'webhook'
      readonly provider: string
      readonly source: WebhookSourceId
      readonly deliveryId: WebhookDeliveryId
      readonly ruleId: WebhookRuleId
      readonly form: 'notice'
      readonly summary: string
    }
  }
}
