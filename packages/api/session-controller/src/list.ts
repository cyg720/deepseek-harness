/** Cold-safe Session list and search projection.
 * @remarks 文件说明：文件职责：实现 api/session-controller 中 list 模块的职责，并向相邻模块提供可复用能力。；
 * 技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis 插件机制，
 * 通过当前文件中的类型、函数与数据结构完成实现。；产品维度：支撑 DeepSeek Harness 的
 * api/session-controller 能力，使上层功能能够稳定组合和扩展。；逻辑维度：建议按“依赖与类型定义 → 常量和状态 →
 * 核心函数或类 → 导出或注册入口”的顺序理解。；关键边界：调用方必须遵守类型、生命周期和错误处理约定；
 * 涉及外部输入、异步任务或资源释放时需特别关注异常分支。；新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，
 * 最后结合相邻测试理解输入、输出与边界条件。 */

import { stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { SessionQueryError, type SessionSearchCursor } from '@deepseek-ai/dsh-session-query'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './types.ts'
import type {
  SessionListMetadata, SessionProjectionHints, SessionProjectionValues, SessionSearchItem,
  SessionSearchValue, SessionSummary,
} from './types.ts'

/** Default maximum artifact size eligible for one cold projection observation.
 * @remarks 中文说明：常量说明：DEFAULT_COLD_BLANK_PROBE_MAX_BYTES 用于处理
 * DEFAULT_COLD_BLANK_PROBE_MAX_BYTES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。 */
export const DEFAULT_COLD_BLANK_PROBE_MAX_BYTES = 1024

/**
 * 常量说明：COLD_SUMMARY_BATCH_SIZE 用于处理 COLD_SUMMARY_BATCH_SIZE 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const COLD_SUMMARY_BATCH_SIZE = 16
/**
 * 常量说明：SEARCH_PROVIDER_CALL_LIMIT 用于处理 SEARCH_PROVIDER_CALL_LIMIT 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SEARCH_PROVIDER_CALL_LIMIT = 100
/**
 * 常量说明：SESSION_SEARCH_QUERY_MAX_CHARS 用于处理 SESSION_SEARCH_QUERY_MAX_CHARS
 * 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const SESSION_SEARCH_QUERY_MAX_CHARS = 500
/**
 * 常量说明：MESSAGE_TYPES 用于处理 MESSAGE_TYPES 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/**
 * 常量说明：sessionListMetadataSchema 用于处理 sessionListMetadataSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
})

/**
 * 常量说明：imageLimitsSchema 用于处理 imageLimitsSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const imageLimitsSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImagesPerMessage: z.number().int().positive(),
  maxMessageImageBytes: z.number().int().positive(),
  maxImagePixels: z.number().int().positive(),
  maxImageDimension: z.number().int().positive(),
  mediaTypes: z.array(z.string()),
}) as unknown as z.ZodType<ImageAttachmentLimits>

/**
 * Advance the Session-list metadata projection by one committed event.
 * @param state - metadata before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced metadata value.
 * @remarks 中文说明：功能说明：注册并应用 Session List Metadata 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：state（SessionListMetadata）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：event（SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；
 * 返回值：SessionListMetadata；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * applySessionListMetadata(state, event)，并按返回类型处理结果。
 */
export function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  /**
   * 常量说明：blank 用于处理 blank 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const blank = state.blank && event.type !== 'turn/start'
  /**
   * 常量说明：lastPromptAt 用于处理 lastPromptAt 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 * @remarks 中文说明：功能说明：处理 truncateUnicodeCodePoints 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：value（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 参数说明：maximum（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：string；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * truncateUnicodeCodePoints(value, maximum)，并按返回类型处理结果。
 */
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  /**
   * 变量说明：count 用于处理 count 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let count = 0
  /**
   * 变量说明：end 用于处理 end 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let end = 0
  for (const /*
   * 变量说明：codePoint 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */ codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}

/** Owns list projection registration, bounded cold summaries, and authorized search.
 * @remarks 中文说明：类说明：ApiSessionList 用于集中封装 处理 ApiSessionList 相关状态与行为。；
 * 核心功能：通过成员字段保存状态，并由公开方法提供受类型约束的操作入口。；使用场景：由 api/session-controller
 * 在对应插件或业务生命周期内创建和调用。 */
export class ApiSessionList {
  /**
   * @param ctx - Host context carrying Session, query, persistence, and projection services.
   * @param coldBlankProbeMaxBytes - maximum physical artifact size eligible for a full observation.
   * @remarks 中文说明：功能说明：处理 ApiSessionList 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：ctx（Context）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；
   * 参数说明：coldBlankProbeMaxBytes（number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 返回值：当前类实例；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：通过 new ApiSessionList(ctx,
   * coldBlankProbeMaxBy…) 创建实例，并在所属生命周期内使用。
   */
  constructor(
    private readonly ctx: Context,
    private readonly coldBlankProbeMaxBytes: number,
  ) {
    ctx.inject(['sessionProjections'], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：projectionCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(projectionCtx)，并按返回类型处理结果。
 */ (projectionCtx) => {
        projectionCtx.sessionProjections.register<'sessionListMetadata', SessionListMetadata>({
          key: 'sessionListMetadata',
          stateSchema: sessionListMetadataSchema,
          init: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => ({ blank: true, lastPromptAt: null }),
          apply: applySessionListMetadata,
          wire: { viewSchema: sessionListMetadataSchema, view: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
 */ state => state },
          stateVersion: 1,
        })
      })
    ctx.inject(['sessionProjections', 'attachments'], /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：projectionCtx（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(projectionCtx)，并按返回类型处理结果。
 */ (projectionCtx) => {
        projectionCtx.sessionProjections.register<'imageLimits', null>({
          key: 'imageLimits',
          stateSchema: z.null(),
          init: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => null,
          apply: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：state（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(state)，并按返回类型处理结果。
 */ state => state,
          wire: {
            viewSchema: imageLimitsSchema,
            view: /*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */ () => projectionCtx.attachments.imageLimits,
          },
          stateVersion: 1,
        })
      })
  }

  /**
   * Build one current attached-Session summary.
   * @param session - attached Session to summarize.
   * @returns current list metadata and available projections.
   * @remarks 中文说明：功能说明：处理 summaryFor 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：session（Session）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：SessionSummary；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 summaryFor(session)，
   * 并按返回类型处理结果。
   */
  summaryFor(session: Session): SessionSummary {
    /**
     * 常量说明：projections 用于处理 projections 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const projections = this.projectionsFor(session.header, session)
    /**
     * 常量说明：metadata 用于处理 metadata 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const metadata = projections?.values.sessionListMetadata
    return {
      sessionId: session.id,
      updatedAt: updatedAt(session.header, metadata),
      running: this.ctx.agents.get(session.id)?.status === 'running',
      blank: metadata?.blank ?? session.seq === 0,
      ...listFields(session.header),
      ...(projections === undefined ? {} : { projections }),
    }
  }

  /**
   * Read every visible attached and persisted Session without activating an Agent.
   * @param signal - optional cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   * @remarks 中文说明：功能说明：列出 list 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionSummary[]>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 list(signal)，并按返回类型处理结果。
   */
  async list(signal?: AbortSignal): Promise<SessionSummary[]> {
    signal?.throwIfAborted()
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = await this.ctx.sessionQuery.listSessions(signal)
    signal?.throwIfAborted()
    /**
     * 常量说明：items 用于处理 items 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const items: SessionSummary[] = []
    /**
     * 常量说明：cold 用于处理 cold 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cold: SessionHeader[] = []
    for (const /*
     * 变量说明：record 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ record of records) {
      /**
       * 常量说明：live 用于处理 live 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const live = this.ctx.sessions.get(record.header.id)
      if (live !== undefined) {
        items.push(this.summaryFor(live))
        continue
      }
      if (record.header.cwd === undefined) continue
      cold.push(record.header)
    }
    for (let /*
     * 变量说明：offset 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */ offset = 0; offset < cold.length; offset += COLD_SUMMARY_BATCH_SIZE) {
      /**
       * 常量说明：settled 用于处理 settled 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const settled = await Promise.allSettled(cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE)
        .map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：header（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(header)，并按返回类型处理结果。
 */ header => this.summarizeCold(header, signal)))
      for (const /*
       * 变量说明：result 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
       */ result of settled) {
        if (result.status === 'rejected') throw result.reason
        items.push(result.value)
      }
    }
    items.sort(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
 */ (left, right) => right.updatedAt - left.updatedAt)
    return items
  }

  /**
   * 功能说明：处理 summarizeCold 相关流程；使用场景由所在模块及调用位置决定。
   * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<SessionSummary>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 summarizeCold(header, signal)，并按返回类型处理结果。
   */
  private async summarizeCold(
    header: SessionHeader,
    signal: AbortSignal | undefined,
  ): Promise<SessionSummary> {
    /**
     * 常量说明：cached 用于处理 cached 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const cached = this.projectionsFor(header, undefined)
    /**
     * 常量说明：projections 用于处理 projections 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const projections = cached?.values.sessionListMetadata?.blank === false
      ? cached
      : await this.probeSmallCold(header, signal) ?? cached
    /**
     * 常量说明：raced 用于处理 raced 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const raced = this.ctx.sessions.get(header.id)
    if (raced !== undefined) return this.summaryFor(raced)
    /**
     * 常量说明：metadata 用于处理 metadata 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const metadata = projections?.values.sessionListMetadata
    return {
      sessionId: header.id,
      updatedAt: updatedAt(header, metadata),
      running: false,
      // A large or inaccessible cache miss remains unknown and visible.
      blank: metadata?.blank ?? false,
      ...listFields(header),
      ...(projections === undefined ? {} : { projections }),
    }
  }

  /**
   * 功能说明：处理 probeSmallCold 相关流程；使用场景由所在模块及调用位置决定。
   * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param signal （AbortSignal | undefined）：传递取消或终止信号；必须满足声明的类型及调用时序要求。
   * @returns Promise<SessionProjectionHints | undefined>；调用方应按声明类型处理，
   * 不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 probeSmallCold(header, signal)，并按返回类型处理结果。
   */
  private async probeSmallCold(
    header: SessionHeader,
    signal: AbortSignal | undefined,
  ): Promise<SessionProjectionHints | undefined> {
    if (this.coldBlankProbeMaxBytes === 0) return undefined
    /**
     * 常量说明：persistence 用于处理 persistence 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const persistence = this.ctx.get('sessionPersistence')
    /**
     * 常量说明：location 用于处理 location 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const location = persistence?.locate(header)
    if (location === undefined) return undefined
    signal?.throwIfAborted()
    try {
      if ((await stat(location.path)).size > this.coldBlankProbeMaxBytes) return undefined
    } catch {
      signal?.throwIfAborted()
      return undefined
    }
    try {
      /**
       * 变量说明：observation 用于处理 observation 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      using observation = await this.ctx.sessionQuery.observeSession(header.id, {
        ...(signal === undefined ? {} : { signal }),
        projectionMode: 'all',
      })
      /**
       * 常量说明：block 用于处理 block 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const block = observation.projections
      return block === undefined
        ? undefined
        : { asOfSeq: block.asOfSeq, values: block.values as SessionProjectionValues }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      signal?.throwIfAborted()
      this.ctx.logger.warn(
        `api-session.list: small cold observation for "${header.id}" failed; serving it as visible: ${String(error)}`,
      )
      return undefined
    }
  }

  /**
   * Search current visible message content without activating any matching Session.
   * @param query - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   * @remarks 中文说明：功能说明：处理 search 相关流程；使用场景由所在模块及调用位置决定。；
   * 参数说明：query（string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
   * 参数说明：signal（AbortSignal）：传递取消或终止信号；必须满足声明的类型及调用时序要求。；
   * 返回值：Promise<SessionSearchValue>；调用方应按声明类型处理，不应假定未声明的附加状态。；
   * 使用示例：典型用法：在完成前置校验后调用 search(query, signal)，并按返回类型处理结果。
   */
  async search(query: string, signal: AbortSignal): Promise<SessionSearchValue> {
    /**
     * 常量说明：normalizedQuery 用于处理 normalizedQuery 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const normalizedQuery = normalizeSearchQuery(query)
    signal.throwIfAborted()
    /**
     * 常量说明：provider 用于处理 provider 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const provider = this.ctx.get('sessionQuery')
    if (provider === undefined) {
      reject(
        'internal',
        'session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query',
        {},
      )
    }
    try {
      /**
       * 常量说明：visible 用于处理 visible 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const visible = await provider.listSessions(signal)
      signal.throwIfAborted()
      /**
       * 常量说明：visibleIds 用于处理 visibleIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const visibleIds = new Set(visible
        .filter(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.header.cwd !== undefined)
        .map(/*
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：record（由 TypeScript
 * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(record)，并按返回类型处理结果。
 */ record => record.header.id))
      if (visibleIds.size === 0) return { items: [], hasMore: false }
      /**
       * 常量说明：authorized 用于处理 authorized 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const authorized: SessionSearchItem[] = []
      /**
       * 常量说明：acceptedIds 用于处理 acceptedIds 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const acceptedIds = new Set<SessionId>()
      /**
       * 常量说明：seenCursors 用于处理 seenCursors 相关数据，作用于当前作用域；初始化后不可重新赋值，
       * 但对象内部是否可变仍由其类型决定。
       */
      const seenCursors = new Set<SessionSearchCursor>()
      /**
       * 变量说明：cursor 用于处理 cursor 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
       */
      let cursor: SessionSearchCursor | undefined
      /**
       * 变量说明：providerCalls 用于处理 providerCalls 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let providerCalls = 0
      /**
       * 变量说明：pageLimit 用于处理 pageLimit 相关数据，作用于当前作用域；其值可能随流程推进而变化，
       * 读写时需遵守声明类型和所在生命周期。
       */
      let pageLimit = SESSION_SEARCH_RESULT_LIMIT
      while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
        signal.throwIfAborted()
        if (providerCalls >= SEARCH_PROVIDER_CALL_LIMIT) {
          throw new Error(`session search provider exceeded the ${SEARCH_PROVIDER_CALL_LIMIT}-call work budget`)
        }
        providerCalls++
        /**
         * 常量说明：requestedCursor 用于处理 requestedCursor 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const requestedCursor = cursor
        /**
         * 常量说明：requestedLimit 用于处理 requestedLimit 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        const requestedLimit = pageLimit
        /**
         * 变量说明：page 用于处理 page 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
         */
        let page
        try {
          page = await provider.searchSessions({
            query: normalizedQuery,
            eventFilters: [
              { kind: 'type', values: ['user/message', 'assistant/message'] },
              { kind: 'surface', values: ['current'] },
            ],
            limit: requestedLimit,
            ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
          }, { signal })
          signal.throwIfAborted()
        } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
          signal.throwIfAborted()
          if (requestedCursor === undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_INVALID_LIMIT'
            && requestedLimit > 1) {
            pageLimit = Math.max(1, Math.floor(requestedLimit / 2))
            continue
          }
          if (requestedCursor !== undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_STALE_CURSOR') {
            authorized.length = 0
            acceptedIds.clear()
            seenCursors.clear()
            cursor = undefined
            continue
          }
          throw error
        }
        if (page.items.length > requestedLimit) {
          throw new Error(`session search provider returned ${String(page.items.length)} items; maximum is ${String(requestedLimit)}`)
        }
        for (const /*
         * 变量说明：hit 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
         */ hit of page.items) {
          if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue
          if (!visibleIds.has(hit.header.id)
            || hit.bestMatch.sessionId !== hit.header.id
            || hit.bestMatch.surface !== 'current'
            || !MESSAGE_TYPES.has(hit.bestMatch.type)
            || acceptedIds.has(hit.header.id)) continue
          acceptedIds.add(hit.header.id)
          authorized.push({
            sessionId: hit.header.id,
            snippet: truncateUnicodeCodePoints(hit.bestMatch.snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS),
          })
        }
        if (page.nextCursor !== undefined) {
          if (seenCursors.has(page.nextCursor)) {
            throw new Error('session search provider repeated a continuation cursor')
          }
          seenCursors.add(page.nextCursor)
        }
        if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      return {
        items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
        hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
      }
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error: unknown) {
      signal.throwIfAborted()
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED') {
        reject('cancelled', 'session search was aborted', {})
      }
      reject('internal', `session search failed: ${String(error)}`, {})
    }
  }

  /**
   * 功能说明：处理 projectionsFor 相关流程；使用场景由所在模块及调用位置决定。
   * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @param session （Session | undefined）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
   * @returns SessionProjectionHints | undefined；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 projectionsFor(header, session)，并按返回类型处理结果。
   */
  private projectionsFor(
    header: SessionHeader,
    session: Session | undefined,
  ): SessionProjectionHints | undefined {
    try {
      /**
       * 常量说明：block 用于处理 block 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const block = session === undefined
        ? this.ctx.get('sessionProjectionCache')?.cachedSnapshot(header)
        : this.ctx.get('sessionProjections')?.cachedSnapshot(session)
      return block !== undefined && Object.keys(block.values).length > 0
        ? {
          asOfSeq: block.asOfSeq,
          // Listing hints contain every currently cached wire value but remain
          // partial: missing cells and cache rows are never materialized here.
          values: block.values as SessionProjectionValues,
        }
        : undefined
    } catch (/*
 * 变量说明：error 保存当前捕获的异常；使用前应按项目约定缩小其类型。
 */ error) {
      this.ctx.logger.warn(
        `api-session.list: projection column for "${header.id}" failed; serving the row without it: ${String(error)}`,
      )
      return undefined
    }
  }
}

/**
 * 功能说明：规范化 Search Query 相关流程；使用场景由所在模块及调用位置决定。
 * @param query （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 normalizeSearchQuery(query)，并按返回类型处理结果。
 */
function normalizeSearchQuery(query: string): string {
  /**
   * 常量说明：normalized 用于处理 normalized 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const normalized = query.trim()
  if (normalized.length === 0) {
    reject('bad-request', 'session search query must not be empty', {})
  }
  if (normalized.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
    reject(
      'bad-request',
      `session search query must contain at most ${SESSION_SEARCH_QUERY_MAX_CHARS} UTF-16 code units`,
      {},
    )
  }
  if (normalized.includes('\0')) {
    reject('bad-request', 'session search query must not contain NUL', {})
  }
  return normalized
}

/**
 * 功能说明：处理 reject 相关流程；使用场景由所在模块及调用位置决定。
 * @param code （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param message （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param details （object）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns never；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 reject(code, message, details)，并按返回类型处理结果。
 */
function reject(code: string, message: string, details: object): never {
  throw new TypertRemoteFailure({ code, message, details })
}

/**
 * 功能说明：处理 updatedAt 相关流程；使用场景由所在模块及调用位置决定。
 * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param metadata （SessionListMetadata | undefined）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 updatedAt(header, metadata)，并按返回类型处理结果。
 */
function updatedAt(header: SessionHeader, metadata: SessionListMetadata | undefined): number {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)
}

/**
 * 功能说明：列出 Fields 相关流程；使用场景由所在模块及调用位置决定。
 * @param header （SessionHeader）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns { readonly parentSessionId?: SessionId readonly origin?:
 * 'subagent' r…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 listFields(header)，并按返回类型处理结果。
 */
function listFields(header: SessionHeader): {
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
} {
  return {
    ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}
