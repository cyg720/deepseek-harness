/**
 * 文件职责：验证DeepSeek LLM的 sse.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { DONE, parseSse } from '../src/sse.ts'

/**
 * DeepSeek protocol contract only: the [DONE] sentinel and STREAM_CLOSED on
 * EOF without it. SSE framing (chunk splits, CRLF, multi-data joins, comments)
 * is eventsource-parser's contract, not re-proven here.
 */

/** Build an SSE byte stream from string fragments (fragments = network reads). */
/* 中文说明：函数 bytes 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function bytes(...fragments: string[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  /** 中文说明：测试局部值 encoder，由紧邻初始化决定。 */
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      /** 中文说明：测试局部值 fragment，由紧邻初始化决定。 */
      for (const fragment of fragments) controller.enqueue(encoder.encode(fragment))
      controller.close()
    },
  })
}

/** 中文说明：函数 collect 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
  const out: string[] = []
  /** 中文说明：测试局部值 item，由紧邻初始化决定。 */
  for await (const item of stream) out.push(item)
  return out
}

describe('parseSse', () => {
  it('yields event payloads and the DONE sentinel', async () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = await collect(parseSse(bytes('data: {"a":1}\n\ndata: [DONE]\n\n')))
    expect(events).toEqual(['{"a":1}', DONE])
  })

  it('reports comments out of band without yielding them', async () => {
    /** 中文说明：测试局部值 comments，由紧邻初始化决定。 */
    const comments: string[] = []
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = await collect(parseSse(
      bytes(': keep-alive\n\ndata: {"a":1}\n\ndata: [DONE]\n\n'),
      (comment) => { comments.push(comment) },
    ))
    expect(comments).toEqual(['keep-alive'])
    expect(events).toEqual(['{"a":1}', DONE])
  })

  it('stops yielding after DONE even when more data follows', async () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = await collect(parseSse(bytes('data: [DONE]\n\ndata: {"late":1}\n\n')))
    expect(events).toEqual([DONE])
  })

  it('throws STREAM_CLOSED when the stream ends without DONE', async () => {
    await expect(collect(parseSse(bytes('data: {"a":1}\n\n')))).rejects.toThrow(LlmError)
    await expect(collect(parseSse(bytes('data: {"a":1}\n\n')))).rejects.toThrow(/without \[DONE\]/)
  })

  it('throws STREAM_CLOSED for an empty stream', async () => {
    await expect(collect(parseSse(bytes()))).rejects.toThrow(/without \[DONE\]/)
  })

  it('throws STREAM_CLOSED for a mid-event close', async () => {
    await expect(collect(parseSse(bytes('data: {"a"')))).rejects.toThrow(/without \[DONE\]/)
  })

  it('treats a final DONE missing its blank-line terminator as truncation', async () => {
    // Spec-strict framing: an event dispatches only on its blank-line
    // terminator, so an unterminated tail at EOF is STREAM_CLOSED — real
    // providers always terminate events, so a missing terminator is truncation.
    await expect(collect(parseSse(bytes('data: {"a":1}\n\ndata: [DONE]')))).rejects.toThrow(/without \[DONE\]/)
  })
})
