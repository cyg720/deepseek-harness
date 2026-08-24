/**
 * 文件职责：验证Agent Loop的 mock-adapter.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Agent Loop在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */
import type { GenerateOptions, LlmModelReasoningInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Helpers to write scripted responses tersely. */
/** 中文说明：测试辅助函数 textResponse 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * Like {@link textResponse} but the stream ends with a `max-tokens` finish —
 * the model was cut off at the output-token ceiling (DeepSeek's `length`).
 * Used to exercise the turn-end `max-tokens` surfacing rule.
 */
/** 中文说明：测试辅助函数 maxTokensResponse 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
export function maxTokensResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ]
}

/** 中文说明：测试辅助函数 toolCallResponse 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
export function toolCallResponse(rawCallId: string, name: string, args: object, text?: string): StreamChunk[] {
  /** 中文说明：测试局部值 callId，由紧邻初始化决定，仅在当前场景使用。 */
  const callId = CallId(rawCallId)
  /** 中文说明：测试局部值 argumentsJson，由紧邻初始化决定，仅在当前场景使用。 */
  const argumentsJson = JSON.stringify(args)
  /** 中文说明：测试局部值 chunks，由紧邻初始化决定，仅在当前场景使用。 */
  const chunks: StreamChunk[] = []
  /** 中文说明：测试局部值 index，由紧邻初始化决定，仅在当前场景使用。 */
  let index = 0
  if (text) {
    chunks.push(
      { type: 'block-start', index, blockType: 'text' },
      { type: 'text-delta', index, text },
      { type: 'block-end', index, block: { type: 'text', text } },
    )
    index += 1
  }
  chunks.push(
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id: callId, name, argumentsDelta: argumentsJson.slice(0, 5) },
    { type: 'tool-call-delta', index, id: callId, argumentsDelta: argumentsJson.slice(5) },
    {
      type: 'block-end',
      index,
      block: { type: 'tool-call', id: callId, name, arguments: argumentsJson },
    },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/** Script entry that streams the given chunks, then hangs until aborted. */
/** 中文说明：测试类型或类 HangAfter 约束夹具数据和行为。 */
export interface HangAfter {
  hangAfter: StreamChunk[]
}

/**
 * Mock adapter driven by a script: each model call consumes the next entry.
 * Records every request it receives for assertions. An entry may be a
 * function to compute chunks from the request, a 'hang' marker that
 * streams one chunk then waits until aborted, 'hang-slow' which takes
 * 50ms to notice the abort — a stand-in for slow real-world teardown
 * (LLM stream cancellation, tool unwinding) — or a {@link HangAfter}
 * scripting the exact chunks delivered before the hang.
 */
/** 中文说明：测试类型或类 MockAdapter 约束夹具数据和行为。 */
export class MockAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(
    private script: (StreamChunk[] | ((options: GenerateOptions) => StreamChunk[]) | 'hang' | 'hang-slow' | HangAfter)[],
    private readonly reasoning?: LlmModelReasoningInfo,
    private readonly defaultMaxTokens?: number,
  ) {
    super()
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
      ...this.defaultMaxTokens === undefined ? {} : { defaultMaxTokens: this.defaultMaxTokens },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    /** 中文说明：测试局部值 entry，由紧邻初始化决定，仅在当前场景使用。 */
    const entry = this.script.shift()
    if (!entry) throw new Error('MockAdapter: script exhausted')
    if (entry === 'hang') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    if (typeof entry === 'object' && !Array.isArray(entry) && 'hangAfter' in entry) {
      /** 中文说明：测试局部值 chunk，由紧邻初始化决定，仅在当前场景使用。 */
      for (const chunk of entry.hangAfter) yield chunk
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      })
      return
    }
    if (entry === 'hang-slow') {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'partial' }
      await new Promise<void>((_resolve, reject) => {
        /** 中文说明：测试局部值 fail，由紧邻初始化决定，仅在当前场景使用。 */
        const fail = (): void => { reject(new Error('aborted')) }
        if (options.signal?.aborted) { setTimeout(fail, 50); return }
        options.signal?.addEventListener('abort', () => { setTimeout(fail, 50) }, { once: true })
      })
      return
    }
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定，仅在当前场景使用。 */
    const chunks = typeof entry === 'function' ? entry(options) : entry
    /** 中文说明：测试局部值 chunk，由紧邻初始化决定，仅在当前场景使用。 */
    for (const chunk of chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}
