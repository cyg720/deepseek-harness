/**
 * Wire-safe authorization types, free of cordis/service imports so browser type
 * chains can consume them without loading this
 * package's Context augmentation.
 * @module @deepseek-ai/dsh-authorization/types
 */

/*
 * ================================ 文件注释 ================================
 * 【文件职责】授权缝的"线上安全"类型词汇表：方法、通知、提问、状态、结算、结果与条目；
 *   不含 cordis/service 导入，浏览器端类型链（apiproxy → client）可安全消费。
 * 【技术维度】纯类型模块；AuthorizationPrompt 是带可选信号的判别联合（text/secret/select）。
 * 【产品维度】定义 flow 与交互面之间中立的对话词汇：一条进度通知、一个必须回答的问题、一次选择。
 * 【逻辑维度】方法 → 通知 → 提问选项 → 提问联合 → 状态/结算 → 结果 → 注册条目。
 * 【关键边界】secret 与 text 仅展示差异（输入掩码、不进日志）；failed 结算只出现在事件流上
 *   ——发起者看到的是抛出的错误，旁观者靠它区分"拒绝"与"故障"。
 * 【新手阅读建议】对照 index.ts 的 AuthorizationSession 与 AuthorizationInteraction 接口阅读。
 * ==========================================================================
 */

import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

// 一种获取凭据的方式，由提供它的 flow 命名：id 供调用方选择，label 供 UI 展示。
/** One way a flow can obtain its credential, named by the flow that offers it. */
export interface AuthorizationMethod {
  /** Flow-owned identifier, echoed back when a caller picks this method. */
  id: string
  /** User-facing label for a picker. */
  label: string
}

// 运行中 flow 给旁观者的进度报告：正在发生什么 / 人下一步要做什么；永不携带秘密。
/** A running flow's report to whoever is watching it. Never carries a secret. */
export interface AuthorizationNotice {
  /** What is happening, or what the human must do next. */
  message: string
  /** A page the human must open to continue. */
  url?: string
  /** A short code the human must enter on that page. */
  code?: string
}

/** One choice offered by a `select` prompt. */
export interface AuthorizationPromptOption {
  /** Value returned when this option is chosen. */
  id: string
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable surfaces. */
  description?: string
}

/**
 * A question a flow must have answered before it can continue. `secret` differs
 * from `text` only in presentation — a surface masks it and keeps it out of
 * logs — and `select` answers with the chosen option's `id`.
 */
export type AuthorizationPrompt = {
  /**
   * Withdraws this prompt alone, leaving the flow running. A flow that races a
   * typed code against a browser callback aborts the losing prompt here; the
   * whole authorization is cancelled through the request's signal instead.
   */
  signal?: AbortSignal
} & ({
  kind: 'text'
  message: string
  placeholder?: string
} | {
  kind: 'secret'
  message: string
  placeholder?: string
} | {
  kind: 'select'
  message: string
  options: readonly AuthorizationPromptOption[]
})

/** How one authorization attempt ended, as its own caller sees it. */
export type AuthorizationStatus = 'authorized' | 'cancelled'

/**
 * How one attempt ended, as an onlooker sees it. A failure reaches its caller
 * as a thrown error rather than an outcome, so `failed` exists only here — on
 * the event stream, where a watcher that did not start the attempt has no
 * other way to tell a refusal from a breakage.
 */
export type AuthorizationSettlement = AuthorizationStatus | 'failed'

/** The result of one `begin()` attempt. */
export interface AuthorizationOutcome {
  /** `authorized` once the record is committed and observed; `cancelled` when the human or caller withdrew. */
  status: AuthorizationStatus
}

/** A registered flow as a surface sees it: what it authorizes and whether it is busy. */
export interface AuthorizationEntry {
  /** The credential record this flow writes. */
  key: CredentialKey
  /** User-facing name of what is being authorized. */
  label: string
  /** The methods this flow offers, most preferred first. */
  methods: readonly AuthorizationMethod[]
  /** Whether an attempt for this key is running right now. */
  inFlight: boolean
}
