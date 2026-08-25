/*
 * ================================ 文件注释 ================================
 * 【文件职责】把 SSE 字节流解码为事件 data 负载（供 translate 消费），是
 * DeepSeek 流式响应的"分帧"层。
 * 【技术维度】帧处理（chunk 重组、UTF-8/CRLF/BOM、注释与非 data 字段跳过、
 * 多条 data: 拼接）交给 eventsource-parser；本模块只保持 DeepSeek 协议约定：
 * 字面量 [DONE] 原样产出（由调用方决定最终冲刷），EOF 在它之前到达则抛错。
 * 分帧严格遵循规范：事件只在空行终止符处分发，因此 EOF 处未终止的尾巴是
 * "截断"而非可冲刷的负载。
 * 【产品维度】流式响应可能中途被切断，[DONE] 哨兵是"响应完整"的唯一可信
 * 信号；缺失时整次模型调用不可信，必须报错而非当作正常结束。
 * 【逻辑维度】DONE 常量 → parseSse：TextDecoderStream 解码 → EventSource
 * ParserStream 解析 → 逐条产出 data，遇 [DONE] 提前返回，否则抛 STREAM_CLOSED。
 * 【关键边界】onComment 回调只作传输活动观察，注释绝不进入产出流。
 * 【新手阅读建议】先读英文模块注释理解"帧/负载"分层，再看 parseSse 的
 * 三行管道式调用。
 * ==========================================================================
 */

/**
 * Decode an SSE byte stream into event `data` payloads. Framing — chunk
 * reassembly, UTF-8/CRLF/BOM handling, comment and non-data field skipping,
 * multi-`data:` joining — is `eventsource-parser`'s. Comments are reported
 * only through an optional transport-activity callback. This module keeps the
 * DeepSeek protocol: the literal `[DONE]` is yielded so the caller owns final
 * flushing, and EOF before it raises {@link LlmError}. Framing is spec-strict:
 * an event dispatches only on its blank-line terminator, so an unterminated
 * tail at EOF is truncation, not a flushable payload.
 *
 * @module dsh-llm-deepseek/sse
 */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** The terminal payload DeepSeek (and OpenAI) send after the last chunk. */
// 中文：DeepSeek（和 OpenAI）在最后一个块后发送的终结负载。
export const DONE = '[DONE]'

/*
 * （中文）把 SSE 字节流解析成 data 负载。最后产出 [DONE] 后返回；流在没有
 * 它的情况下结束（响应被截断——本次模型调用不可信）时抛
 * LlmError('STREAM_CLOSED')。
 * @param stream 原始 SSE 字节；读取可能在任何位置分裂，包括 UTF-8 序列中间。
 * @param onComment 可选的传输活动回调；注释绝不进入产出的负载流。
 * @returns 按到达顺序产出每个事件的 data 负载，最后是 [DONE] 哨兵。
 */
/**
 * Parse an SSE byte stream into data payloads. Yields `[DONE]` as the final
 * value and returns; throws `LlmError('STREAM_CLOSED')` when the stream ends
 * without it (truncated response — the model call cannot be trusted).
 * @param stream - raw SSE bytes; reads may split anywhere, including mid-UTF-8 sequence.
 * @param onComment - optional transport-activity callback; comments never enter the yielded payload stream.
 * @returns each event's data payload in arrival order, the `[DONE]` sentinel last.
 */
export async function* parseSse(
  stream: ReadableStream<BufferSource>,
  onComment?: (comment: string) => void,
): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const { data } of events) {
    yield data
    if (data === DONE) return
  }
  throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}
