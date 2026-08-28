/*
 * ================================ 文件注释 ================================
 * 【文件职责】声明 Code Mode（代码模式）下 `run_code` 程序内每一次嵌套工具子调用
 *   （sub-dispatch）写入会话日志的两类事件的载荷类型，并通过声明合并把它们挂进
 *   dsh-session 的事件表，使持久日志能完整记录每个子调用的开始与落定。
 * 【技术维度】纯类型模块：TypeScript 接口 + `declare module` 模块扩充（把新事件键
 *   合并进既有 `SessionEventMap` 接口），无任何运行时代码。
 * 【产品维度】UI 与持久化依赖这两个事件实现"逐子调用"的实时运行状态展示与完整
 *   日志回放；模型上下文不受影响（消息派生逻辑会忽略它们）。
 * 【逻辑维度】先定义 start（子调用开始）与 settle（子调用落定）两个载荷接口；随后在
 *   declare module 块内把 'tool/code-dispatch-start' 与 'tool/code-dispatch' 两个
 *   事件键及其载荷类型合入 SessionEventMap。
 * 【关键边界】arguments 字段保存的是分派前已完成 JSON 归一化的精确值，因此追加日志
 *   永不因载荷形状失败；每个已开始的子调用必然恰好对应一条落定事件（含中止场景）。
 * 【新手阅读建议】先读两个接口的字段含义，再读 declare module 内两段事件说明；
 *   写入时机可对照 code-mode.ts 中 binding() 内的 session.append 调用来理解。
 * ==========================================================================
 */

/**
 * Durable Tool event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-tools/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  /** 子调用面向模型的完整内容块（与原生 tool/result 使用同一词汇表）。 */
  content: ContentBlock[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the deterministic sub-call id (`<parent>:code:<n>`,
     * numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/code-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     */
    'tool/code-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/code-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * model-facing outcome in `tool/result`'s own vocabulary
     * (`content` + `isError`), so UIs render a sub-call through the exact
     * code path that renders a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     */
    'tool/code-dispatch': PtcDispatchEventData
  }
}
