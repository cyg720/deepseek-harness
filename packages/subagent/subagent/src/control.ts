/**
 * Browser-facing subagent control assembly: the catalog view sampled against
 * the live Agent registry, one browser zone's validation, and the stable
 * failure codes the Remote surface answers with.
 *
 * @module @deepseek-ai/dsh-subagent
 * @remarks 文件说明：文件职责：实现 subagent/subagent 中 control 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的 subagent/subagent 能力，
 * 使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  SubagentCatalog, SubagentControlErrorDetailsMap, SubagentListEntry,
} from './control-types.ts'
import { SubagentError } from './error.ts'

/** Strict browser-zone profile: UTC or an IANA Area/Location-style identifier.
 * @remarks 中文说明：常量说明：IANA_TIME_ZONE 用于处理 IANA_TIME_ZONE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。 */
const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)+$/

/**
 * 常量说明：SESSION_ID_SCHEMA 用于处理 SESSION_ID_SCHEMA 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const SESSION_ID_SCHEMA = z.string().min(1)
/**
 * 常量说明：CONTROL_ID_SCHEMAS 用于处理 CONTROL_ID_SCHEMAS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const CONTROL_ID_SCHEMAS = {
  'subagent.list': z.object({ parentSessionId: SESSION_ID_SCHEMA }),
  'subagent.prompt': z.object({
    parentSessionId: SESSION_ID_SCHEMA,
    childSessionId: SESSION_ID_SCHEMA,
    mode: z.literal('continuable'),
  }),
  'subagent.interrupt': z.object({
    parentSessionId: SESSION_ID_SCHEMA,
    childSessionId: SESSION_ID_SCHEMA,
    mode: z.literal('continuable'),
  }),
} as const

/**
 * Validate and canonicalize one browser-supplied IANA zone at the wire boundary.
 * @param value - the browser's reported zone name.
 * @returns the canonical zone, or `undefined` when the name is unusable.
 * @remarks 中文说明：功能说明：处理 canonicalClientTimeZone 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string | undefined；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * canonicalClientTimeZone(value)，并按返回类型处理结果。
 */
export function canonicalClientTimeZone(value: string): string | undefined {
  if (value.length === 0 || value.trim() !== value
    || (value !== 'UTC' && !IANA_TIME_ZONE.test(value))) return undefined
  try {
    /**
     * 常量说明：canonical 用于处理 canonical 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: value })
      .resolvedOptions().timeZone
    /* v8 ignore next -- Intl returns UTC or a canonical IANA Area/Location for accepted input. */
    if (canonical !== 'UTC' && !IANA_TIME_ZONE.test(canonical)) return undefined
    return canonical
  } catch {
    // Intl rejects unsupported zone names; the caller maps that parser rejection.
    return undefined
  }
}

/**
 * Refuse one Remote call with a stable business failure the carrier preserves.
 * @param code - declared caller-facing code.
 * @param message - human-readable refusal.
 * @param details - that code's declared detail payload.
 * @returns Never — the failure is thrown.
 * @throws {TypertRemoteFailure} always.
 * @remarks 中文说明：功能说明：处理 rejectControl 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：code（Code）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：message（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：details（SubagentControlErrorDetailsMap[Code]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；返回值：never；调用方应按声明类型处理，不应假定未声明的附加状态。；
 * 使用示例：典型用法：在完成前置校验后调用 rejectControl(code, message, details)，并按返回类型处理结果。
 */
export function rejectControl<Code extends keyof SubagentControlErrorDetailsMap>(
  code: Code,
  message: string,
  details: SubagentControlErrorDetailsMap[Code],
): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * Apply the subagent payload checks that are stricter than generated
 * branded-string codecs.
 * @param method - method name carried in the failure message.
 * @param payload - decoded control fields to validate.
 * @throws {TypertRemoteFailure} `bad-request` with the original Zod issues.
 * @remarks 中文说明：功能说明：校验 Control Request 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：method（keyof typeof CONTROL_ID_SCHEMAS）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。；参数说明：payload（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：void；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * validateControlRequest(method, payload)，并按返回类型处理结果。
 */
export function validateControlRequest(
  method: keyof typeof CONTROL_ID_SCHEMAS,
  payload: unknown,
): void {
  /**
   * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const parsed = CONTROL_ID_SCHEMAS[method].safeParse(payload)
  if (!parsed.success) {
    return rejectControl('bad-request', `invalid payload for ${method}`, {
      issues: parsed.error.issues,
    })
  }
}

/**
 * Project one durable listing onto the catalog view, replacing each row's
 * store-derived activity with the live Agent driver's status and reporting
 * whether the exact parent Agent is live. Without an Agent registry no driver
 * runs at all, so every row is inactive and the parent is unavailable.
 * @param ctx - Host context that may carry the Agent registry.
 * @param parentSessionId - the listed parent.
 * @param entries - the durable direct-child listing.
 * @returns the catalog view answered to one browser.
 * @remarks 中文说明：功能说明：处理 catalogView 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
 * 参数说明：parentSessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：entries（readonly SubagentListEntry[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SubagentCatalog；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * catalogView(ctx, parentSessionId, entries)，并按返回类型处理结果。
 */
export function catalogView(
  ctx: Context,
  parentSessionId: SessionId,
  entries: readonly SubagentListEntry[],
): SubagentCatalog {
  /**
   * 常量说明：agents 用于处理 agents 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const agents = ctx.get('agents')
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：entry（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SubagentListEntry；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(entry)，并按返回类型处理结果。
   */
  return {
    entries: entries.map((entry): SubagentListEntry => entry.kind === 'child'
      ? { ...entry, activity: agents?.get(entry.id)?.status === 'running' ? 'running' : 'inactive' }
      : entry),
    parentAvailable: agents?.get(parentSessionId) !== undefined,
  }
}

/**
 * Refuse one catalog read while preserving cancellation and a missing
 * projections registry as distinct failures.
 * @param error - the thrown value.
 * @param signal - the caller's cancellation.
 * @returns Never — the refusal is thrown.
 * @throws {TypertRemoteFailure} always.
 * @remarks 中文说明：功能说明：处理 rejectCatalogRead 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rejectCatalogRead(error,
 * signal)，并按返回类型处理结果。
 */
export function rejectCatalogRead(error: unknown, signal: AbortSignal): never {
  if (isCancellation(error, signal)) {
    return rejectControl('cancelled', 'subagent catalog read was cancelled', {})
  }
  if (error instanceof SubagentError && error.code === 'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE') {
    return rejectControl(
      'subagent-projections-unavailable',
      'subagent catalog is unavailable: this deployment does not mount the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
      {},
    )
  }
  return rejectControl('internal', 'subagent catalog read failed', {})
}

/**
 * Refuse one continuation prompt without exposing provider detail: admission
 * failures the caller can act on keep their own code, everything else is
 * internal.
 * @param error - the thrown value.
 * @param childSessionId - the addressed child.
 * @param signal - the caller's cancellation.
 * @returns Never — the refusal is thrown.
 * @throws {TypertRemoteFailure} always.
 * @remarks 中文说明：功能说明：处理 rejectPrompt 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：error（unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：childSessionId（SessionId）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；返回值：never；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 rejectPrompt(error,
 * childSessionId, signal)，并按返回类型处理结果。
 */
export function rejectPrompt(error: unknown, childSessionId: SessionId, signal: AbortSignal): never {
  if (isCancellation(error, signal)) {
    return rejectControl('cancelled', 'subagent prompt was cancelled', {})
  }
  if (error instanceof SubagentError) {
    switch (error.code) {
      case 'NOT_RESUMABLE':
        return rejectControl('subagent-not-resumable', 'subagent cannot be resumed', { childSessionId })
      case 'UNAUTHORIZED':
        return rejectControl(
          'subagent-unauthorized',
          'subagent does not belong to this parent',
          { childSessionId },
        )
      case 'DRAINING':
      case 'ACTIVATION_CLOSING':
      case 'CONTINUATION_UNAVAILABLE':
      case 'PERSISTENCE_UNAVAILABLE':
        return rejectControl(
          'subagent-delivery-unavailable',
          'subagent follow-up is temporarily unavailable',
          { childSessionId },
        )
      // A code outside the admission vocabulary is not the caller's move to make.
      default:
        break
    }
  }
  return rejectControl('internal', 'subagent prompt failed', {})
}

/**
 * 功能说明：判断是否为 Cancellation 相关流程；使用场景由所在模块及调用位置决定。
 * @param error （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param signal （AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
 * @returns boolean；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 isCancellation(error, signal)，并按返回类型处理结果。
 */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof SubagentError && error.code === 'CANCELLED')
}
