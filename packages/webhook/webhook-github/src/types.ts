/** GitHub event values projected after signature verification. */

/*
 * 文件说明：文件职责：实现 webhook/webhook-github 中 types 模块的职责，并向相邻模块提供可复用能力。
 * ；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * webhook/webhook-github 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Signed GitHub JSON object. Event-specific field validation belongs to each rule. */
export type GitHubJsonObject = { readonly [key: string]: JsonValue }

/** Provider event supplied to `WebhookRule<'github'>`. */
export interface GitHubWebhookEvent {
  /** Raw `X-GitHub-Event` name such as `pull_request`. */
  readonly name: string
  /** Signed JSON object exactly as parsed from the request body. */
  readonly payload: GitHubJsonObject
}

declare module '@deepseek-ai/dsh-webhook' {
  interface WebhookEventMap {
    github: GitHubWebhookEvent
  }
}

export type { EmitterWebhookEvent, EmitterWebhookEventName } from '@octokit/webhooks'
