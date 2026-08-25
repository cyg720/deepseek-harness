/*
 * ================================ 文件注释 ================================
 * 【文件职责】把"最终 LLM 适配器边界抛出的任意值"规范化为可序列化的 LlmFailure
 * 事实对象，供终结性 finish 块使用；核心函数是 normalizeLlmFailure。
 * 【技术维度】防御性编程：适配器可能抛出任意值（Error 或非 Error），且 SDK
 * 对象可能带会抛错的访问器，因此所有读取都走 try/catch 与属性描述符，只信任
 * 通过校验的数据。对跨包拷贝的 HarnessError，用"自带 failure 快照 + code 一致"
 * 双条件决定是否信任其携带的事实。
 * 【产品维度】适配器边界是 harness 与外部 provider 的交汇点，失败信息需要被
 * 稳定地序列化进会话日志与流协议，保证错误类别的可路由性和可回放性。
 * 【逻辑维度】入口 normalizeLlmFailure → 统一包装为非 Error 抛出值 → 读取
 * 自带快照与 code 并交叉校验 → 决定信任快照还是重建最小失败事实。
 * 【关键边界】只信任 Harness 自己的 code 体系（第三方 SDK 的 code 不是本
 * 项目分类法）；所有 getter/toString 都可能抛错，必须被兜底。
 * 【新手阅读建议】按"入口 → 四个只读辅助"的顺序读：thrownMessage、ownErrorCode、
 * ownFailureSnapshot、failureSnapshot、errorMessage、harnessErrorCode。
 * ==========================================================================
 */

/**
 * Normalization for values thrown by a final LLM adapter boundary.
 *
 * @module @deepseek-ai/dsh-llm/adapter-failure
 */

import { HarnessError } from './error.ts'
import type { LlmFailure } from './types.ts'

/*
 * （中文）从适配器抛出的值中剥离出可序列化的 provider 失败事实。若传入的不是
 * Error 实例，先包装成 code 为 UNKNOWN 的 HarnessError；若它是跨包拷贝的
 * HarnessError（自带 failure 快照且 code 与自身属性一致），则信任并返回该快照，
 * 否则重建一个最小失败事实。
 * @param value 适配器分发或迭代期间抛出的任意值。
 * @returns 不可变的、provider 无关的失败事实，适合放进终结性 finish 块。
 */
/**
 * Detach serializable provider facts from a value thrown by an adapter.
 * @param value - arbitrary value thrown during adapter dispatch or iteration.
 * @returns immutable provider-neutral facts suitable for a terminal finish chunk.
 * @internal
 */
export function normalizeLlmFailure(value: unknown): LlmFailure {
  const error = value instanceof Error
    ? value
    : new HarnessError(thrownMessage(value), 'UNKNOWN', { cause: value })
  // Cross-package copies preserve own data but not class identity. Trust the
  // carried facts only when both own properties agree after validation.
  // 中文：跨包拷贝会保留自有数据但丢失类身份（instanceof 不成立）。只有自带
  // 数据与自身属性校验一致时才信任携带的事实。
  const carried = ownFailureSnapshot(error)
  if (carried !== undefined && carried.code === ownErrorCode(error)) return carried
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error),
  })
}

/** Render a non-Error throw without letting hostile coercion escape normalization. */
// 中文：渲染非 Error 的抛出值，防止恶意的强制转换（会抛错的 toString 等）
// 逃逸出规范化流程。
function thrownMessage(value: unknown): string {
  try {
    const message = String(value)
    return message.length > 0 ? message : 'LLM adapter failed'
  } catch (_hostileThrownValue) {
    return 'LLM adapter failed'
  }
}

/** Read a foreign error's own data-backed `code` without invoking accessors. */
// 中文：读取外部错误对象自带的、由数据支撑的 code 属性，不触发任何访问器。
function ownErrorCode(error: Error): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code')
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Snapshot an own data property without invoking an SDK-defined accessor. */
// 中文：读取外部错误对象自带的 failure 数据属性快照，不触发 SDK 定义的访问器。
function ownFailureSnapshot(error: Error): LlmFailure | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'failure')
    return descriptor !== undefined && 'value' in descriptor
      ? failureSnapshot(descriptor.value)
      : undefined
  } catch (_sdkPropertyTrap) {
    return undefined
  }
}

/** Validate and detach an arbitrary serializable failure payload. */
// 中文：校验并剥离任意可序列化的失败负载：字段类型不符即返回 undefined，
// 绝不把未经校验的数据当作可信事实。
function failureSnapshot(value: unknown): LlmFailure | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const candidate = value as Partial<LlmFailure>
    const message = candidate.message
    const code = candidate.code
    const status = candidate.status
    const providerRetryAfterMs = candidate.providerRetryAfterMs
    const requestId = candidate.requestId
    if (typeof message !== 'string' || message.length === 0
      || typeof code !== 'string' || code.length === 0
      || (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599))
      || (providerRetryAfterMs !== undefined
        && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0))
      || (requestId !== undefined && (typeof requestId !== 'string' || requestId.length === 0))) return undefined
    return Object.freeze({
      message,
      code,
      ...status === undefined ? {} : { status },
      ...providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs },
      ...requestId === undefined ? {} : { requestId },
    })
  } catch (_sdkFailureGetter) {
    return undefined
  }
}

/** Read an SDK error message without letting an accessor replace the primary failure. */
// 中文：读取 SDK 错误消息，防止访问器用别的值替换掉主要失败信息。
function errorMessage(error: Error): string {
  try {
    const message: unknown = error.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch (_sdkMessageGetter) {
    // The fallback below preserves a serializable failure beside the original Error.
    // 中文：下面的兜底值保证在原 Error 旁边仍保留一个可序列化的失败事实。
  }
  return 'LLM adapter failed'
}

/** Trust only Harness-owned codes; third-party SDK codes are not our taxonomy. */
// 中文：只信任 Harness 自己的 code；第三方 SDK 的 code 不属于本项目的分类法，
// 一律归为 UNKNOWN。
function harnessErrorCode(error: Error): string {
  return error instanceof HarnessError ? error.code : 'UNKNOWN'
}
