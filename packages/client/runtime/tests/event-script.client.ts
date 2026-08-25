/**
 * 文件职责：提供会话投影测试使用的类型化事件脚本构造器和递增序号。
 * 技术维度：TypeScript 泛型、SessionEventMap、品牌标识与测试数据工厂。
 * 产品维度：让大量投影测试用简短、可读的方式构造合法会话日志事件。
 * 逻辑维度：维护默认会话与序号，为不同事件载荷补齐信封字段并返回类型化事件。
 * 关键边界：只用于测试；调用顺序会影响自动序号，显式覆盖时要避免制造无意冲突。
 * 新手阅读建议：先看默认标识和序号规则，再看通用 event 构造器，最后使用各专用辅助函数。
 */
import { createUserMessage, createMessage, createToolResultMessage, CallId } from '@deepseek-ai/dsh-llm'
// Minimal SessionEvent builders for orchestration tests (shape mirrors what the
// host emits; only the fields the object layer reads).
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** One text content block (local helper). */
/* 中文说明：当前测试场景使用的局部状态或中间值；变量 `text` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const text = (t: string): ContentBlock[] => [{ type: 'text', text: t }]

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `at` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
const at = (seq: number, e: Record<string, unknown>): SessionEvent =>
  ({ seq, time: 1_700_000_000_000 + seq, ...e }) as unknown as SessionEvent

/** 中文说明：当前测试场景使用的局部状态或中间值；变量 `ev` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
export const ev = {
  turnStart: (seq: number, turn: number): SessionEvent =>
    at(seq, { type: 'turn/start', data: { turn } }),
  user: (seq: number, body: string): SessionEvent =>
    at(seq, { type: 'user/message', surfaceOp: 'append', data: createUserMessage({
      content: text(body), source: { kind: 'user' },
    }) }),
  stepStart: (seq: number, turn: number, step = 0): SessionEvent =>
    at(seq, { type: 'step/start', data: { turn, step } }),
  chunkStart: (seq: number, turn: number, step = 0, index = 0): SessionEvent =>
    at(seq, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'block-start', index, blockType: 'text' } } }),
  chunkText: (seq: number, turn: number, piece: string, step = 0, index = 0): SessionEvent =>
    at(seq, { type: 'assistant/chunk', data: { turn, step, chunk: { type: 'text-delta', index, text: piece } } }),
  assistant: (seq: number, turn: number, body: string, step = 0): SessionEvent =>
    at(seq, { type: 'assistant/message', surfaceOp: 'append', data: {
      turn, step,
      message: createMessage({
        role: 'assistant',
        content: text(body),
        source: {
          kind: 'model',
          ...{ provider: 'fake', model: 'fk-1' },
        },
      }),
    } }),
  toolCall: (seq: number, turn: number, callId: string, name: string, args: string, step = 0): SessionEvent =>
    at(seq, { type: 'tool/call', data: { turn, step, callId, name, arguments: args } }),
  toolResult: (seq: number, turn: number, callId: string, body: string, step = 0): SessionEvent =>
    at(seq, {
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn,
        step,
        message: createToolResultMessage({
          callId: CallId(callId),
          content: text(body),
          isError: false,
        }),
      },
    }),
  codeDispatchStart: (seq: number, parentCallId: string, n: number, name: string, args: unknown): SessionEvent =>
    at(seq, {
      type: 'tool/code-dispatch-start',
      data: { rootCallId: parentCallId, parentCallId, subCallId: `${parentCallId}:code:${n}`, name, arguments: args },
    }),
  codeDispatch: (seq: number, parentCallId: string, n: number, name: string, args: unknown, body: string, isError = false): SessionEvent =>
    at(seq, {
      type: 'tool/code-dispatch',
      data: { rootCallId: parentCallId, parentCallId, subCallId: `${parentCallId}:code:${n}`, name, arguments: args, isError, content: text(body) },
    }),
  stepEnd: (seq: number, turn: number, step = 0): SessionEvent =>
    at(seq, { type: 'step/end', data: { turn, step } }),
  retry: (
    seq: number,
    turn: number,
    step = 0,
    retry = 1,
    maxRetries = 2,
    delayMs = 500,
    message = 'temporary transport failure',
  ): SessionEvent =>
    at(seq, {
      type: 'llm/retry',
      data: {
        turn, step,
        provider: 'fake', mode: 'normal', policyKey: 'fake-normal',
        retry, maxRetries, delayMs,
        failure: { code: 'TRANSPORT', message },
      },
    }),
  turnEnd: (seq: number, turn: number, reason: 'completed' | 'aborted' | 'disposed' = 'completed'): SessionEvent =>
    at(seq, { type: 'turn/end', data: {
      turn,
      reason: reason === 'completed'
        ? { kind: 'completed' }
        : { kind: 'aborted', reason: { kind: reason === 'disposed' ? 'disposed' : 'user' } },
    } }),
  commandRun: (seq: number, commandId: string, name: string, args = ''): SessionEvent =>
    at(seq, { type: 'command/run', data: { commandId, name, args, source: { kind: 'user' } } }),
  commandRunWithoutInput: (seq: number, commandId: string, name: string): SessionEvent =>
    at(seq, { type: 'command/run', data: { commandId, name, source: { kind: 'user' } } }),
  commandDone: (
    seq: number,
    commandId: string,
    kind: 'success' | 'error' = 'success',
    text?: string,
    sourceEventSeq?: number,
  ): SessionEvent =>
    at(seq, { type: 'command/done', data: {
      commandId,
      kind,
      ...text === undefined ? {} : { text },
      ...sourceEventSeq === undefined ? {} : { sourceEventSeq },
    } }),
  /** A compaction's log-only `compaction/summary` record. */
  compactSummary: (seq: number, summary: string, start: number, end: number): SessionEvent =>
    at(seq, { type: 'compaction/summary', data: {
      summary: text(summary),
      shadowedRange: { start, end },
      shadowedSeqs: [start, end],
      shadowedTokenCount: 100,
      provider: 'fake',
      model: 'compact-1',
    } }),
  /** The replacement user message a compaction backend lands (the checkpoint). */
  compactCheckpoint: (seq: number, summarySeq: number, start: number, end: number): SessionEvent =>
    at(seq, {
      type: 'user/message',
      surfaceOp: { op: 'replace', start, end },
      sourceEventSeqs: [summarySeq, start, end],
      data: createUserMessage({
        content: text('<context_checkpoint>model only</context_checkpoint>'),
        source: { kind: 'plugin', plugin: 'compact' },
      }),
    }),
}

/** One complete plain turn (turn/start → user → step → assistant → turn/end), 6 events from startSeq. */
/* 中文说明：测试辅助函数 `plainTurn`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function plainTurn(startSeq: number, turn: number, ask: string, answer: string): SessionEvent[] {
  return [
    ev.turnStart(startSeq, turn),
    ev.user(startSeq + 1, ask),
    ev.stepStart(startSeq + 2, turn),
    ev.assistant(startSeq + 3, turn, answer),
    ev.stepEnd(startSeq + 4, turn),
    ev.turnEnd(startSeq + 5, turn),
  ]
}

/** Wrap raw events as view-less history entries (the wire shape history returns). */
/* 中文说明：测试辅助函数 `entries`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
export function entries(events: readonly SessionEvent[]): { event: SessionEvent }[] {
  return events.map(event => ({ event }))
}
