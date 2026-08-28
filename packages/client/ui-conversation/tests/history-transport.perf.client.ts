/** Opt-in synthetic benchmark for packed session-history transport and exact replay.
 * @remarks 文件说明：文件职责：验证 client/ui-conversation 中 history transport perf
 * client 相关行为与失败场景。；技术维度：主要使用TypeScript/JavaScript 的 ESM 模块、严格类型约束与 Cordis
 * 插件机制，通过当前文件中的类型、函数与数据结构完成实现。；产品维度：保障用户实际使用路径在演进过程中保持稳定，降低回归风险。；
 * 逻辑维度：建议按“依赖与类型定义 → 常量和状态 → 核心函数或类 → 导出或注册入口”的顺序理解。；
 * 关键边界：调用方必须遵守类型、生命周期和错误处理约定；涉及外部输入、异步任务或资源释放时需特别关注异常分支。；
 * 新手阅读建议：先确认导入依赖和公开导出，再沿主要函数调用链阅读，最后结合相邻测试理解输入、输出与边界条件。 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { performance } from 'node:perf_hooks'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { isChunkRow, packChunkRuns } from '@deepseek-ai/dsh-session/chunk-rows'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type {
  ChunkRowEvent,
  SessionEventEntry,
  SessionHistoryRecord,
  SessionWireEvent,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { historyEntries } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/history-records.ts'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationNodeDefinition,
  ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * 常量说明：LOGICAL_EVENTS 用于处理 LOGICAL_EVENTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const LOGICAL_EVENTS = 416_756
/**
 * 常量说明：DELTA_EVENTS 用于处理 DELTA_EVENTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DELTA_EVENTS = 416_176
/**
 * 常量说明：ORDINARY_EVENTS 用于处理 ORDINARY_EVENTS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const ORDINARY_EVENTS = LOGICAL_EVENTS - DELTA_EVENTS
/**
 * 常量说明：DELTA_RUNS 用于处理 DELTA_RUNS 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const DELTA_RUNS = 116
/**
 * 常量说明：TIME_ZERO 用于处理 TIME_ZERO 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const TIME_ZERO = 1_700_000_000_000

interface Timed<T> {
  readonly value: T
  readonly ms: number
}

interface HeapPeaks<T> {
  readonly value: T
  readonly medianPeakBytes: number
  readonly peakBytes: readonly number[]
}

interface TransferSample {
  readonly headersMs: number
  readonly bodyMs: number
  readonly totalMs: number
}

interface TransferTimings {
  readonly headersMs: number
  readonly bodyMs: number
  readonly totalMs: number
  readonly samples: readonly TransferSample[]
}

interface FoldState {
  readonly blocks: readonly string[]
  readonly deltaCount: number
  readonly lastDeltaSeq?: number
  readonly firstTokenTime?: number
  readonly firstVisibleSeq?: number
  readonly firstVisibleTime?: number
}

interface FoldSnapshots {
  readonly chat: unknown
  readonly trajectory: unknown
}

interface RawHistoryValue {
  readonly events: SessionEventEntry[]
  readonly hasMore: boolean
}

interface PackedHistoryValue {
  readonly records: SessionHistoryRecord[]
  readonly hasMore: boolean
}

/**
 * 常量说明：safeIntegerSchema 用于处理 safeIntegerSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const safeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
/**
 * 常量说明：sessionWireEventSchema 用于处理 sessionWireEventSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const sessionWireEventSchema = z.object({
  type: z.string(),
  seq: safeIntegerSchema,
  time: safeIntegerSchema,
  data: z.json(),
  sourceEventSeqs: z.array(safeIntegerSchema).optional(),
  surfaceOp: z.json().optional(),
}).strict()
/**
 * 常量说明：historyEntrySchema 用于处理 historyEntrySchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const historyEntrySchema = z.object({
  type: z.literal('event'),
  event: sessionWireEventSchema,
}).strict()
/**
 * 常量说明：chunkRunBaseSchema 用于处理 chunkRunBaseSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
const chunkRunBaseSchema = {
  turn: z.number(),
  step: z.number(),
  index: z.number(),
  dt: z.array(safeIntegerSchema),
}
/**
 * 常量说明：textChunkEventSchema 用于处理 textChunkEventSchema 相关数据，作用于当前作用域；
 * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const textChunkEventSchema = z.object({
  type: z.enum(['chunkrow/text-chunks', 'chunkrow/reasoning-chunks']),
  seq: safeIntegerSchema.nonnegative(),
  time: safeIntegerSchema,
  data: z.object({
    ...chunkRunBaseSchema,
    texts: z.array(z.string()).min(1),
  }).strict(),
}).strict()
/**
 * 常量说明：toolCallChunkEventSchema 用于处理 toolCallChunkEventSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const toolCallChunkEventSchema = z.object({
  type: z.literal('chunkrow/tool-call-chunks'),
  seq: safeIntegerSchema.nonnegative(),
  time: safeIntegerSchema,
  data: z.object({
    ...chunkRunBaseSchema,
    id: z.string(),
    name: z.string().optional(),
    args: z.array(z.string()).min(1),
  }).strict(),
}).strict()
/**
 * 常量说明：chunkEventSchema 用于处理 chunkEventSchema 相关数据，作用于当前作用域；初始化后不可重新赋值，
 * 但对象内部是否可变仍由其类型决定。
 */
/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
 * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；参数：context（由 TypeScript
 * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
 * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event, context)，
 * 并按返回类型处理结果。
 */
const chunkEventSchema: z.ZodType<ChunkRowEvent> = z.discriminatedUnion('type', [
  textChunkEventSchema,
  toolCallChunkEventSchema,
]).superRefine((event, context) => {
  /**
   * 常量说明：members 用于处理 members 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const members = event.type === 'chunkrow/tool-call-chunks' ? event.data.args : event.data.texts
  if (event.data.dt.length !== members.length - 1) {
    context.addIssue({
      code: 'custom',
      message: 'packed chunk dt length must be one less than member count',
      path: ['data', 'dt'],
    })
  }
  if (members.length - 1 > Number.MAX_SAFE_INTEGER - event.seq) {
    context.addIssue({ code: 'custom', message: 'packed chunk seqs must stay safe integers', path: ['seq'] })
  }
  /**
   * 变量说明：time 用于处理 time 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let time = event.time
  /**
   * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let index = 0; index < event.data.dt.length; index++) {
    time += event.data.dt[index] as number
    if (Number.isSafeInteger(time)) continue
    context.addIssue({
      code: 'custom',
      message: 'packed chunk times must stay safe integers',
      path: ['data', 'dt', index],
    })
    break
  }
}) as z.ZodType<ChunkRowEvent>
/**
 * 常量说明：packedHistoryValueSchema 用于处理 packedHistoryValueSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const packedHistoryValueSchema: z.ZodType<PackedHistoryValue> = z.object({
  records: z.array(z.union([
    historyEntrySchema,
    z.object({ type: z.literal('chunks'), event: chunkEventSchema }).strict(),
  ])),
  hasMore: z.boolean(),
}) as z.ZodType<PackedHistoryValue>
/**
 * 常量说明：rawSessionHistoryValueSchema 用于处理 rawSessionHistoryValueSchema 相关数据，
 * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
 */
const rawSessionHistoryValueSchema: z.ZodType<RawHistoryValue> = z.object({
  events: z.array(historyEntrySchema),
  hasMore: z.boolean(),
}) as z.ZodType<RawHistoryValue>

/**
 * 功能说明：处理 timed 相关流程；使用场景由所在模块及调用位置决定。
 * @param run （() => T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Timed<T>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 timed(run)，并按返回类型处理结果。
 */
function timed<T>(run: () => T): Timed<T> {
  /**
   * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const start = performance.now()
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = run()
  return { value, ms: performance.now() - start }
}

/**
 * 功能说明：处理 rounded 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 rounded(value)，并按返回类型处理结果。
 */
function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 功能说明：处理 reduction 相关流程；使用场景由所在模块及调用位置决定。
 * @param before （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param after （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 reduction(before, after)，并按返回类型处理结果。
 */
function reduction(before: number, after: number): number {
  return rounded((1 - after / before) * 100)
}

/**
 * 功能说明：处理 median 相关流程；使用场景由所在模块及调用位置决定。
 * @param values （readonly number[]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 median(values)，并按返回类型处理结果。
 */
function median(values: readonly number[]): number {
  /**
   * 常量说明：ordered 用于处理 ordered 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：left（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：right（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(left, right)，并按返回类型处理结果。
   */
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)]!
}

/**
 * 功能说明：处理 listen 相关流程；使用场景由所在模块及调用位置决定。
 * @param server （Server）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<number>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 listen(server)，并按返回类型处理结果。
 */
async function listen(server: Server): Promise<number> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  await new Promise<void>((resolve, reject) => {
    /**
     * 常量说明：failed 用于处理 failed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 failed 相关流程；使用场景由所在模块及调用位置决定。
     * @param error （Error）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 failed(error)，并按返回类型处理结果。
     */
    const failed = (error: Error): void => { reject(error) }
    server.once('error', failed)
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    server.listen(0, '127.0.0.1', () => {
      server.off('error', failed)
      resolve()
    })
  })
  /**
   * 常量说明：address 用于处理 address 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('history transport benchmark server has no TCP port')
  return address.port
}

/**
 * 功能说明：关闭 close 相关流程；使用场景由所在模块及调用位置决定。
 * @param server （Server）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<void>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 close(server)，并按返回类型处理结果。
 */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：resolve（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：reject（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(resolve, reject)，
   * 并按返回类型处理结果。
   */
  await new Promise<void>((resolve, reject) => {
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：error（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(error)，并按返回类型处理结果。
     */
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

/**
 * 功能说明：处理 loopbackTransfer 相关流程；使用场景由所在模块及调用位置决定。
 * @param json （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns Promise<TransferTimings>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 loopbackTransfer(json)，并按返回类型处理结果。
 */
async function loopbackTransfer(json: string): Promise<TransferTimings> {
  /**
   * 常量说明：server 用于处理 server 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_request（由 TypeScript
   * 根据调用位置推断的类型）：提供调用方提交的请求信息；必须满足声明的类型及调用时序要求。；参数：response（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_request, response)，
   * 并按返回类型处理结果。
   */
  const server = createServer((_request, response) => {
    // Production Response.json reaches the bridge without content-length, so
    // leave Node's response chunked for the same body-transfer behavior.
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write(json)
    response.end()
  })
  /**
   * 常量说明：port 用于处理 port 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const port = await listen(server)
  /**
   * 常量说明：once 用于处理 once 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   * 功能说明：处理 once 相关流程；使用场景由所在模块及调用位置决定。
   * @returns Promise<TransferSample>；调用方应按声明类型处理，不应假定未声明的附加状态。
   * @example 在完成前置校验后调用 once()，并按返回类型处理结果。
   */
  const once = async (): Promise<TransferSample> => {
    /**
     * 常量说明：started 用于处理 started 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const started = performance.now()
    /**
     * 常量说明：response 用于处理 response 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const response = await fetch(`http://127.0.0.1:${String(port)}/`)
    /**
     * 常量说明：headers 用于处理 headers 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const headers = performance.now()
    /**
     * 常量说明：body 用于处理 body 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const body = await response.text()
    /**
     * 常量说明：completed 用于处理 completed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const completed = performance.now()
    if (body !== json) throw new Error('history transport benchmark received a changed body')
    return {
      headersMs: headers - started,
      bodyMs: completed - headers,
      totalMs: completed - started,
    }
  }
  try {
    await once()
    /**
     * 常量说明：samples 用于处理 samples 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const samples: TransferSample[] = []
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let index = 0; index < 5; index++) samples.push(await once())
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
     */
    return {
      headersMs: median(samples.map(sample => sample.headersMs)),
      bodyMs: median(samples.map(sample => sample.bodyMs)),
      totalMs: median(samples.map(sample => sample.totalMs)),
      samples,
    }
  } finally {
    await close(server)
  }
}

/** Measure caller-sampled additional V8 heap from forced-GC baselines.
 * @remarks 中文说明：功能说明：处理 sampledPeakHeap 相关流程；使用场景由所在模块及调用位置决定。；
 * 参数说明：run（(sample: () => void) => T）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；
 * 返回值：HeapPeaks<T>；调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用
 * sampledPeakHeap(run)，并按返回类型处理结果。 */
function sampledPeakHeap<T>(run: (sample: () => void) => T): HeapPeaks<T> {
  /**
   * 常量说明：forceGc 用于处理 forceGc 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const forceGc = globalThis.gc
  if (forceGc === undefined) {
    throw new Error('history transport memory benchmark requires Vitest worker --expose-gc')
  }
  /**
   * 常量说明：samples 用于处理 samples 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const samples = Array.from({ length: 3 }, () => {
    forceGc()
    forceGc()
    /**
     * 常量说明：baseline 用于处理 baseline 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const baseline = process.memoryUsage().heapUsed
    /**
     * 变量说明：peak 用于处理 peak 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
     */
    let peak = baseline
    /**
     * 常量说明：sample 用于处理 sample 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     * 功能说明：处理 sample 相关流程；使用场景由所在模块及调用位置决定。
     * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
     * @example 在完成前置校验后调用 sample()，并按返回类型处理结果。
     */
    const sample = (): void => {
      peak = Math.max(peak, process.memoryUsage().heapUsed)
    }
    /**
     * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const value = run(sample)
    sample()
    return { value, peakBytes: peak - baseline }
  })
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  return {
    value: samples[0]!.value,
    medianPeakBytes: median(samples.map(sample => sample.peakBytes)),
    peakBytes: samples.map(sample => sample.peakBytes),
  }
}

/**
 * 功能说明：处理 append 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param type （Type）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param data （SessionEventMap[Type]）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param options （{ readonly surfaceOp?: 'append' }）：提供本次操作使用的配置选项；
 * 必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 append(events, type, data, options)，并按返回类型处理结果。
 */
function append<Type extends keyof SessionEventMap>(
  events: SessionEvent[],
  type: Type,
  data: SessionEventMap[Type],
  options: { readonly surfaceOp?: 'append' } = {},
): void {
  /**
   * 常量说明：seq 用于处理 seq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seq = events.length
  events.push({ type, seq, time: TIME_ZERO + seq, data, ...options } as SessionEvent<Type>)
}

/**
 * 功能说明：处理 appendSeparator 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param run （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param separator （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns void；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 appendSeparator(events, run, separator)，并按返回类型处理结果。
 */
function appendSeparator(events: SessionEvent[], run: number, separator: number): void {
  /**
   * 常量说明：seq 用于处理 seq 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const seq = events.length
  events.push({
    type: 'benchmark/separator',
    seq,
    time: TIME_ZERO + seq,
    data: { run, separator },
  } as SessionEvent)
}

/**
 * 功能说明：处理 fragment 相关流程；使用场景由所在模块及调用位置决定。
 * @param run （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param index （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 fragment(run, index)，并按返回类型处理结果。
 */
function fragment(run: number, index: number): string {
  /**
   * 常量说明：value 用于处理 value 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const value = (Math.imul(run + 1, 0x9E3779B1) ^ Math.imul(index + 1, 0x85EBCA6B)) >>> 0
  return value.toString(36).padStart(7, '0').slice(-2)
}

/** Build the private sample's event/run cardinality from deterministic synthetic content.
 * @remarks 中文说明：功能说明：构建 Events 相关流程；使用场景由所在模块及调用位置决定。；返回值：SessionEvent[]；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；使用示例：典型用法：在完成前置校验后调用 buildEvents()，并按返回类型处理结果。 */
function buildEvents(): SessionEvent[] {
  /**
   * 常量说明：events 用于处理 events 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const events: SessionEvent[] = []
  append(events, 'turn/start', { turn: 1 })
  append(events, 'user/message', createUserMessage({
    content: [{ type: 'text', text: 'synthetic history transport benchmark' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  append(events, 'step/start', { turn: 1, step: 1 })

  /**
   * 常量说明：baseRunLength 用于处理 baseRunLength 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const baseRunLength = Math.floor(DELTA_EVENTS / DELTA_RUNS)
  /**
   * 常量说明：longerRuns 用于处理 longerRuns 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const longerRuns = DELTA_EVENTS % DELTA_RUNS
  /**
   * 变量说明：run 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let run = 0; run < DELTA_RUNS; run++) {
    /**
     * 常量说明：runLength 用于执行 Length 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const runLength = baseRunLength + (run < longerRuns ? 1 : 0)
    /**
     * 变量说明：index 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let index = 0; index < runLength; index++) {
      append(events, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'reasoning-delta',
          index: run,
          text: fragment(run, index),
        },
      })
    }
    /**
     * 常量说明：separators 用于处理 separators 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const separators = run < 3 ? 4 : 5
    /**
     * 变量说明：separator 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
     */
    for (let separator = 0; separator < separators; separator++) {
      appendSeparator(events, run, separator)
    }
  }
  return events
}

/**
 * 功能说明：处理 memberTime 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （ChunkRowEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @param index （number）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns number；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 memberTime(event, index)，并按返回类型处理结果。
 */
function memberTime(event: ChunkRowEvent, index: number): number {
  /**
   * 变量说明：time 用于处理 time 相关数据，作用于当前作用域；其值可能随流程推进而变化，读写时需遵守声明类型和所在生命周期。
   */
  let time = event.time
  /**
   * 变量说明：cursor 保存当前循环的迭代状态；取值范围由循环输入决定，仅在循环作用域内使用。
   */
  for (let cursor = 0; cursor < index; cursor++) time += event.data.dt[cursor] as number
  return time
}

/**
 * 功能说明：处理 foldDefinition 相关流程；使用场景由所在模块及调用位置决定。
 * @param kind （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @param target （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ConversationNodeDefinition<FoldState>；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 foldDefinition(kind, target)，并按返回类型处理结果。
 */
function foldDefinition(kind: string, target: string): ConversationNodeDefinition<FoldState> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；参数：match（由
   * TypeScript 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context, match)，
   * 并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：context（由 TypeScript
   * 根据调用位置推断的类型）：提供当前 Cordis 插件上下文与已声明服务；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript
   * 根据实现推断的结果；调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(context)，
   * 并按返回类型处理结果。
   */
  return {
    kind,
    target,
    match: (event) => {
      if (event.type === 'step/start') return { id: `${String(event.data.turn)}:${String(event.data.step)}`, role: 'start' }
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'reasoning-delta') {
        return { id: `${String(event.data.turn)}:${String(event.data.step)}`, role: 'update' }
      }
      if (event.type === 'chunkrow/reasoning-chunks') {
        return { id: `${String(event.data.turn)}:${String(event.data.step)}`, role: 'update' }
      }
      return null
    },
    start: () => ({ blocks: [], deltaCount: 0 }),
    update: (context, match) => {
      if (match.event.type === 'chunkrow/reasoning-chunks') {
        /**
         * 常量说明：event 用于处理 event 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const event = match.event
        /**
         * 常量说明：blocks 用于处理 blocks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
         */
        const blocks = [...context.state.blocks]
        blocks[event.data.index] = (blocks[event.data.index] ?? '') + event.data.texts.join('')
        /**
         * 常量说明：firstToken 用于处理 firstToken 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
         */
        const firstToken = event.data.texts.findIndex(text => text !== '')
        /**
         * 常量说明：firstVisible 用于处理 firstVisible 相关数据，作用于当前作用域；初始化后不可重新赋值，
         * 但对象内部是否可变仍由其类型决定。
         */
        /**
         * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：text（由 TypeScript
         * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
         * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(text)，并按返回类型处理结果。
         */
        const firstVisible = event.data.texts.findIndex(text => text.trim() !== '')
        return {
          ...context.state,
          blocks,
          deltaCount: context.state.deltaCount + event.data.texts.length,
          lastDeltaSeq: event.seq + event.data.texts.length - 1,
          ...context.state.firstTokenTime === undefined && firstToken >= 0
            ? { firstTokenTime: memberTime(event, firstToken) }
            : {},
          ...context.state.firstVisibleSeq === undefined && firstVisible >= 0
            ? {
              firstVisibleSeq: event.seq + firstVisible,
              firstVisibleTime: memberTime(event, firstVisible),
            }
            : {},
        }
      }
      if (match.event.type !== 'assistant/chunk' || match.event.data.chunk.type !== 'reasoning-delta') {
        return context.state
      }
      /**
       * 常量说明：chunk 用于处理 chunk 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const chunk = match.event.data.chunk
      /**
       * 常量说明：blocks 用于处理 blocks 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      const blocks = [...context.state.blocks]
      blocks[chunk.index] = (blocks[chunk.index] ?? '') + chunk.text
      /**
       * 常量说明：visible 用于处理 visible 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
       */
      /**
       * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：block（由 TypeScript
       * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
       * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(block)，并按返回类型处理结果。
       */
      const visible = blocks.some(block => block.trim() !== '')
      return {
        ...context.state,
        blocks,
        deltaCount: context.state.deltaCount + 1,
        lastDeltaSeq: match.event.seq,
        ...context.state.firstTokenTime === undefined ? { firstTokenTime: match.event.time } : {},
        ...visible && context.state.firstVisibleSeq === undefined
          ? { firstVisibleSeq: match.event.seq, firstVisibleTime: match.event.time }
          : {},
      }
    },
    buildViewNode: context => context.state === undefined
      ? null
      : {
        key: context.key,
        kind: context.kind,
        id: context.id,
        target,
        data: context.state,
      },
  }
}

/**
 * 功能说明：处理 viewDefinition 相关流程；使用场景由所在模块及调用位置决定。
 * @param target （string）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns ConversationViewDefinition<ConversationViewNode, readonly
 * Conversatio…；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 viewDefinition(target)，并按返回类型处理结果。
 */
function viewDefinition(target: string): ConversationViewDefinition<ConversationViewNode, readonly ConversationViewNode[]> {
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ nodes }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ nodes })，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：{ upserts }（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调({ upserts })，并按返回类型处理结果。
   */
  return {
    target,
    create: () => ({
      empty: [],
      replace: ({ nodes }) => nodes,
      apply: ({ upserts }) => upserts,
    }),
  }
}

/**
 * 功能说明：处理 wireEntry 相关流程；使用场景由所在模块及调用位置决定。
 * @param event （SessionEvent）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEventEntry；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wireEntry(event)，并按返回类型处理结果。
 */
function wireEntry(event: SessionEvent): SessionEventEntry {
  return { type: 'event', event: event as unknown as SessionWireEvent }
}

/**
 * 功能说明：处理 wireEntries 相关流程；使用场景由所在模块及调用位置决定。
 * @param events （readonly SessionEvent[]）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。
 * @returns SessionEventEntry[]；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 wireEntries(events)，并按返回类型处理结果。
 */
function wireEntries(events: readonly SessionEvent[]): SessionEventEntry[] {
  return events.map(wireEntry)
}

/**
 * 功能说明：处理 chunkEntry 相关流程；使用场景由所在模块及调用位置决定。
 * @param row （ChunkRow）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionHistoryRecord；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 chunkEntry(row)，并按返回类型处理结果。
 */
function chunkEntry(row: ChunkRow): SessionHistoryRecord {
  return {
    type: 'chunks',
    event: {
      type: `chunkrow/${row.type}`,
      seq: row.seq0,
      time: row.time0,
      data: row.data,
    } as ChunkRowEvent,
  }
}

/**
 * 功能说明：处理 historyRecord 相关流程；使用场景由所在模块及调用位置决定。
 * @param record （SessionEvent | ChunkRow）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns SessionHistoryRecord；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 historyRecord(record)，并按返回类型处理结果。
 */
function historyRecord(record: SessionEvent | ChunkRow): SessionHistoryRecord {
  return isChunkRow(record) ? chunkEntry(record) : wireEntry(record)
}

/**
 * 功能说明：处理 assemble 相关流程；使用场景由所在模块及调用位置决定。
 * @param entries （readonly SessionEventLikeEntry[]）：提供本次调用所需的数据；
 * 必须满足声明的类型及调用时序要求。
 * @returns FoldSnapshots；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 assemble(entries)，并按返回类型处理结果。
 */
function assemble(entries: readonly SessionEventLikeEntry[]): FoldSnapshots {
  /**
   * 常量说明：definitions 用于处理 definitions 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const definitions = [
    foldDefinition('benchmark-chat-assistant', 'chat'),
    foldDefinition('benchmark-trajectory-assistant', 'trajectory'),
  ]
  /**
   * 常量说明：assembler 用于处理 assembler 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const assembler = new ConversationNodeAssembler(
    { entries: () => definitions, fallbackEntry: () => undefined },
    { entries: () => [viewDefinition('chat'), viewDefinition('trajectory')] },
  )
  assembler.replaceWindow(entries, false)
  assembler.flush()
  return {
    chat: assembler.snapshot('chat'),
    trajectory: assembler.snapshot('trajectory'),
  }
}

/**
 * 功能说明：处理 digest 相关流程；使用场景由所在模块及调用位置决定。
 * @param value （unknown）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。
 * @returns string；调用方应按声明类型处理，不应假定未声明的附加状态。
 * @example 在完成前置校验后调用 digest(value)，并按返回类型处理结果。
 */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('reports packed history transport and exact replay costs', async () => {
  /**
   * 常量说明：fixture 用于处理 fixture 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const fixture = timed(buildEvents)

  assemble(historyEntries(wireEntries(fixture.value.slice(0, 1_000))))
  /**
   * 常量说明：rawHostHeap 用于处理 rawHostHeap 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  const rawHostHeap = sampledPeakHeap((sample) => {
    /**
     * 常量说明：entries 用于处理 entries 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const entries = wireEntries(fixture.value)
    sample()
    /**
     * 常量说明：json 用于处理 json 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const json = JSON.stringify({ events: entries, hasMore: false } satisfies RawHistoryValue)
    sample()
    return Buffer.byteLength(json)
  })
  /**
   * 常量说明：packedHostHeap 用于处理 packedHostHeap 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  const packedHostHeap = sampledPeakHeap((sample) => {
    /**
     * 常量说明：packedEvents 用于处理 packedEvents 相关数据，作用于当前作用域；初始化后不可重新赋值，
     * 但对象内部是否可变仍由其类型决定。
     */
    const packedEvents = packChunkRuns(fixture.value)
    sample()
    /**
     * 常量说明：records 用于处理 records 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const records = packedEvents.map(historyRecord)
    sample()
    /**
     * 常量说明：json 用于处理 json 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const json = JSON.stringify({
      records,
      hasMore: false,
    } satisfies PackedHistoryValue)
    sample()
    return Buffer.byteLength(json)
  })

  /**
   * 常量说明：rawEntries 用于处理 rawEntries 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawEntries = timed(() => wireEntries(fixture.value))
  /**
   * 常量说明：packed 用于处理 packed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packed = timed(() => packChunkRuns(fixture.value))
  /**
   * 常量说明：packedRecords 用于处理 packedRecords 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedRecords = timed(() => packed.value.map(historyRecord))
  /**
   * 常量说明：rawValue 用于处理 rawValue 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rawValue: RawHistoryValue = { events: rawEntries.value, hasMore: false }
  /**
   * 常量说明：packedValue 用于处理 packedValue 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedValue: PackedHistoryValue = {
    records: packedRecords.value,
    hasMore: false,
  }

  /**
   * 常量说明：rawJson 用于处理 rawJson 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawJson = timed(() => JSON.stringify(rawValue))
  /**
   * 常量说明：packedJson 用于处理 packedJson 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedJson = timed(() => JSON.stringify(packedValue))
  /**
   * 常量说明：rawGzip 用于处理 rawGzip 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawGzip = timed(() => gzipSync(rawJson.value).byteLength)
  /**
   * 常量说明：packedGzip 用于处理 packedGzip 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedGzip = timed(() => gzipSync(packedJson.value).byteLength)
  /**
   * 常量说明：rawBrotli 用于处理 rawBrotli 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawBrotli = timed(() => brotliCompressSync(rawJson.value).byteLength)
  /**
   * 常量说明：packedBrotli 用于处理 packedBrotli 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedBrotli = timed(() => brotliCompressSync(packedJson.value).byteLength)
  /**
   * 常量说明：rawTransfer 用于处理 rawTransfer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const rawTransfer = await loopbackTransfer(rawJson.value)
  /**
   * 常量说明：packedTransfer 用于处理 packedTransfer 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedTransfer = await loopbackTransfer(packedJson.value)

  /**
   * 常量说明：rawClientHeap 用于处理 rawClientHeap 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  const rawClientHeap = sampledPeakHeap((sample) => {
    /**
     * 常量说明：wire 用于处理 wire 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wire: unknown = JSON.parse(rawJson.value)
    sample()
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = rawSessionHistoryValueSchema.parse(wire)
    sample()
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = historyEntries(parsed.events)
    sample()
    /**
     * 常量说明：folded 用于处理 folded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const folded = assemble(prepared)
    sample()
    return digest(folded)
  })
  /**
   * 常量说明：packedClientHeap 用于处理 packedClientHeap 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  const packedClientHeap = sampledPeakHeap((sample) => {
    /**
     * 常量说明：wire 用于处理 wire 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const wire: unknown = JSON.parse(packedJson.value)
    sample()
    /**
     * 常量说明：parsed 用于处理 parsed 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const parsed = packedHistoryValueSchema.parse(wire)
    sample()
    /**
     * 常量说明：prepared 用于处理 prepared 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const prepared = historyEntries(parsed.records)
    sample()
    /**
     * 常量说明：folded 用于处理 folded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const folded = assemble(prepared)
    sample()
    return digest(folded)
  })

  /**
   * 常量说明：parsedRaw 用于处理 parsedRaw 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const parsedRaw = timed((): unknown => JSON.parse(rawJson.value))
  /**
   * 常量说明：parsedPacked 用于处理 parsedPacked 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：unknown；调用方应按声明类型处理，不应假定未声明的附加状态。
   * ；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const parsedPacked = timed((): unknown => JSON.parse(packedJson.value))
  /**
   * 常量说明：rawValidation 用于处理 rawValidation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawValidation = timed(() => rawSessionHistoryValueSchema.parse(parsedRaw.value))
  /**
   * 常量说明：packedValidation 用于处理 packedValidation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedValidation = timed(() => packedHistoryValueSchema.parse(parsedPacked.value))
  /**
   * 常量说明：rawPreparation 用于处理 rawPreparation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawPreparation = timed(() => historyEntries(rawValidation.value.events))
  /**
   * 常量说明：packedPreparation 用于处理 packedPreparation 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedPreparation = timed(() => historyEntries(packedValidation.value.records))

  assemble(rawPreparation.value.slice(0, 1_000))
  assemble(packedPreparation.value)
  /**
   * 常量说明：rawFold 用于处理 rawFold 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const rawFold = timed(() => assemble(rawPreparation.value))
  /**
   * 常量说明：packedFold 用于处理 packedFold 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
   */
  const packedFold = timed(() => assemble(packedPreparation.value))

  /**
   * 常量说明：rawBytes 用于处理 rawBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rawBytes = Buffer.byteLength(rawJson.value)
  /**
   * 常量说明：packedBytes 用于处理 packedBytes 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedBytes = Buffer.byteLength(packedJson.value)
  /**
   * 常量说明：packedRows 用于处理 packedRows 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedRows = packed.value.filter(isChunkRow)
  expect(fixture.value).toHaveLength(LOGICAL_EVENTS)
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：event（由 TypeScript
   * 根据调用位置推断的类型）：提供需要处理或投影的事件数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(event)，并按返回类型处理结果。
   */
  expect(fixture.value.filter(event => event.type !== 'assistant/chunk')).toHaveLength(ORDINARY_EVENTS)
  expect(packedRows).toHaveLength(DELTA_RUNS)
  expect(packed.value).toHaveLength(696)
  expect(packedPreparation.value).toHaveLength(696)
  expect(digest(packedFold.value)).toBe(digest(rawFold.value))
  expect(packedClientHeap.value).toBe(rawClientHeap.value)
  expect(rawHostHeap.value).toBe(rawBytes)
  expect(packedHostHeap.value).toBe(packedBytes)
  expect(packedBytes).toBeLessThan(rawBytes)

  /**
   * 常量说明：rawResponseMs 用于处理 rawResponseMs 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const rawResponseMs = rawEntries.ms + rawJson.ms
  /**
   * 常量说明：packedResponseMs 用于处理 packedResponseMs 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedResponseMs = packed.ms + packedRecords.ms + packedJson.ms
  /**
   * 常量说明：rawClientMs 用于处理 rawClientMs 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const rawClientMs = parsedRaw.ms + rawValidation.ms + rawPreparation.ms + rawFold.ms
  /**
   * 常量说明：packedClientMs 用于处理 packedClientMs 相关数据，作用于当前作用域；初始化后不可重新赋值，
   * 但对象内部是否可变仍由其类型决定。
   */
  const packedClientMs = parsedPacked.ms + packedValidation.ms + packedPreparation.ms + packedFold.ms
  /**
   * 常量说明：rawSyntheticApiWaitMs 用于处理 rawSyntheticApiWaitMs 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rawSyntheticApiWaitMs = rawResponseMs + rawTransfer.totalMs + parsedRaw.ms + rawValidation.ms
  /**
   * 常量说明：packedSyntheticApiWaitMs 用于处理 packedSyntheticApiWaitMs 相关数据，
   * 作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packedSyntheticApiWaitMs = packedResponseMs + packedTransfer.totalMs + parsedPacked.ms + packedValidation.ms
  /**
   * 常量说明：rawSyntheticReadyMs 用于处理 rawSyntheticReadyMs 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const rawSyntheticReadyMs = rawResponseMs + rawTransfer.totalMs + rawClientMs
  /**
   * 常量说明：packedSyntheticReadyMs 用于处理 packedSyntheticReadyMs 相关数据，作用于当前作用域；
   * 初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  const packedSyntheticReadyMs = packedResponseMs + packedTransfer.totalMs + packedClientMs
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：sample（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(sample)，并按返回类型处理结果。
   */
  process.stdout.write(`HISTORY_TRANSPORT_PERF_RESULT ${JSON.stringify({
    fixture: {
      buildMs: rounded(fixture.ms),
      logicalEvents: fixture.value.length,
      ordinaryEvents: ORDINARY_EVENTS,
      deltaEvents: DELTA_EVENTS,
      deltaRuns: packedRows.length,
      packedRecords: packed.value.length,
      conversationInputs: packedPreparation.value.length,
    },
    bytes: {
      rawJson: rawBytes,
      packedJson: packedBytes,
      jsonReductionPct: reduction(rawBytes, packedBytes),
      rawGzip: rawGzip.value,
      packedGzip: packedGzip.value,
      gzipReductionPct: reduction(rawGzip.value, packedGzip.value),
      rawBrotli: rawBrotli.value,
      packedBrotli: packedBrotli.value,
      brotliReductionPct: reduction(rawBrotli.value, packedBrotli.value),
    },
    memory: {
      samples: 3,
      rawHostAdditionalHeapPeakBytes: rawHostHeap.medianPeakBytes,
      packedHostAdditionalHeapPeakBytes: packedHostHeap.medianPeakBytes,
      hostReductionPct: reduction(rawHostHeap.medianPeakBytes, packedHostHeap.medianPeakBytes),
      rawClientAdditionalHeapPeakBytes: rawClientHeap.medianPeakBytes,
      packedClientAdditionalHeapPeakBytes: packedClientHeap.medianPeakBytes,
      clientReductionPct: reduction(rawClientHeap.medianPeakBytes, packedClientHeap.medianPeakBytes),
      rawHostPeakSamples: rawHostHeap.peakBytes,
      packedHostPeakSamples: packedHostHeap.peakBytes,
      rawClientPeakSamples: rawClientHeap.peakBytes,
      packedClientPeakSamples: packedClientHeap.peakBytes,
    },
    host: {
      rawEntryWrapMs: rounded(rawEntries.ms),
      packMs: rounded(packed.ms),
      packedRecordWrapMs: rounded(packedRecords.ms),
      rawStringifyMs: rounded(rawJson.ms),
      packedStringifyMs: rounded(packedJson.ms),
      rawGzipMs: rounded(rawGzip.ms),
      packedGzipMs: rounded(packedGzip.ms),
      rawBrotliMs: rounded(rawBrotli.ms),
      packedBrotliMs: rounded(packedBrotli.ms),
      rawResponseMs: rounded(rawResponseMs),
      packedResponseMs: rounded(packedResponseMs),
      responseReductionPct: reduction(rawResponseMs, packedResponseMs),
    },
    transport: {
      samples: 5,
      rawHeadersMs: rounded(rawTransfer.headersMs),
      packedHeadersMs: rounded(packedTransfer.headersMs),
      rawBodyMs: rounded(rawTransfer.bodyMs),
      packedBodyMs: rounded(packedTransfer.bodyMs),
      rawTotalMs: rounded(rawTransfer.totalMs),
      packedTotalMs: rounded(packedTransfer.totalMs),
      totalReductionPct: reduction(rawTransfer.totalMs, packedTransfer.totalMs),
      rawSamples: rawTransfer.samples.map(sample => ({
        headersMs: rounded(sample.headersMs),
        bodyMs: rounded(sample.bodyMs),
        totalMs: rounded(sample.totalMs),
      })),
      packedSamples: packedTransfer.samples.map(sample => ({
        headersMs: rounded(sample.headersMs),
        bodyMs: rounded(sample.bodyMs),
        totalMs: rounded(sample.totalMs),
      })),
    },
    client: {
      rawParseMs: rounded(parsedRaw.ms),
      packedParseMs: rounded(parsedPacked.ms),
      rawValidationMs: rounded(rawValidation.ms),
      packedValidationMs: rounded(packedValidation.ms),
      rawPrepareMs: rounded(rawPreparation.ms),
      packedPrepareMs: rounded(packedPreparation.ms),
      rawFoldMs: rounded(rawFold.ms),
      packedFoldMs: rounded(packedFold.ms),
      rawHistoryMs: rounded(rawClientMs),
      packedHistoryMs: rounded(packedClientMs),
      historyReductionPct: reduction(rawClientMs, packedClientMs),
    },
    combined: {
      rawSyntheticApiWaitMs: rounded(rawSyntheticApiWaitMs),
      packedSyntheticApiWaitMs: rounded(packedSyntheticApiWaitMs),
      syntheticApiWaitReductionPct: reduction(rawSyntheticApiWaitMs, packedSyntheticApiWaitMs),
      rawSyntheticReadyMs: rounded(rawSyntheticReadyMs),
      packedSyntheticReadyMs: rounded(packedSyntheticReadyMs),
      syntheticReadyReductionPct: reduction(rawSyntheticReadyMs, packedSyntheticReadyMs),
    },
  })}\n`)
}, 600_000)

/**
 * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
 * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
 */
it('reports compact folding cost for long whitespace-prefix runs', () => {
  historyEntries([{
    type: 'chunks',
    event: {
      type: 'chunkrow/reasoning-chunks',
      seq: 0,
      time: TIME_ZERO,
      data: { turn: 1, step: 1, index: 0, dt: [], texts: ['x'] },
    },
  }])
  /**
   * 常量说明：results 用于处理 results 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
   */
  /**
   * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：members（由 TypeScript
   * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
   * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(members)，并按返回类型处理结果。
   */
  const results = [10_000, 20_000, 40_000].map((members) => {
    /**
     * 常量说明：record 用于处理 record 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；参数：_（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；参数：index（由 TypeScript
     * 根据调用位置推断的类型）：提供本次调用所需的数据；必须满足声明的类型及调用时序要求。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调(_, index)，并按返回类型处理结果。
     */
    const record: SessionHistoryRecord = {
      type: 'chunks',
      event: {
        type: 'chunkrow/reasoning-chunks',
        seq: 1,
        time: TIME_ZERO + 1,
        data: {
          turn: 1,
          step: 1,
          index: 0,
          dt: Array.from({ length: members - 1 }, () => 1),
          texts: Array.from({ length: members }, (_, index) => index === members - 1 ? 'x' : ' '),
        },
      },
    }
    /**
     * 常量说明：start 用于启动 start 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const start = wireEntry({
      type: 'step/start',
      seq: 0,
      time: TIME_ZERO,
      data: { turn: 1, step: 1 },
    })
    /**
     * 常量说明：inputs 用于处理 inputs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const inputs = historyEntries([start, record])
    /**
     * 常量说明：folded 用于处理 folded 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    const folded = assemble(inputs)
    /**
     * 常量说明：samplesMs 用于处理 samplesMs 相关数据，作用于当前作用域；初始化后不可重新赋值，但对象内部是否可变仍由其类型决定。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    /**
     * 功能说明：处理 匿名回调 相关流程；使用场景由所在模块及调用位置决定。；返回值：由 TypeScript 根据实现推断的结果；
     * 调用方应按声明类型处理，不应假定未声明的附加状态。；典型用法：在完成前置校验后调用 匿名回调()，并按返回类型处理结果。
     */
    const samplesMs = Array.from({ length: 5 }, () => timed(() => assemble(inputs)).ms)
    expect((folded.chat as readonly { readonly data: FoldState }[])[0]?.data).toMatchObject({
      deltaCount: members,
      lastDeltaSeq: members,
      firstVisibleSeq: members,
      firstVisibleTime: TIME_ZERO + members,
    })
    return {
      members,
      medianMs: rounded(median(samplesMs)),
      samplesMs: samplesMs.map(rounded),
    }
  })
  process.stdout.write(`HISTORY_WHITESPACE_PREFIX_PERF_RESULT ${JSON.stringify(results)}\n`)
})
