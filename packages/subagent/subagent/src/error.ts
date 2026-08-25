/*
 * ================================ 文件注释 ================================
 * 【文件职责】定义 subagent 能力缝的统一定型错误类型 SubagentError，供服务端与提供者共同抛出。
 * 【技术维度】继承自 dsh-llm 的 HarnessError，携带错误码字符串；HarnessError 自身支持 cause 链。
 * 【产品维度】工具层通过错误码（如 NO_PROVIDER、UNSUPPORTED_CAPABILITY）把失败映射成
 *   模型可见的 isError 工具结果，而不是让底层异常直接泄漏给模型。
 * 【逻辑维度】仅一个类：构造时透传 message/code/options 并固定 name 为 'SubagentError'。
 * 【关键边界】错误码是字符串而非枚举，便于后续扩展；不在此处做任何格式化。
 * 【新手阅读建议】全文件很短，了解构造签名即可；用 code 区分失败类别是后续读代码的关键线索。
 * ==========================================================================
 */

/**
 * Typed failures shared by subagent service and provider operations.
 *
 * @module @deepseek-ai/dsh-subagent
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Typed failure for the subagent seam. */
// 中文：子代理能力缝的统一错误类型。服务端校验、提供者实现、工具层消费都抛/捕这个类型，
// 通过 code 字符串（如 'NO_PROVIDER'、'UNSUPPORTED_CAPABILITY'）区分失败类别。
export class SubagentError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'SubagentError'
  }
}
