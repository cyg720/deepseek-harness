/**
 * 文件职责：验证Pi AI LLM的 convert.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef, ImageRequestPolicy, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ToolCallId, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { toPiContext } from '../src/context.ts'
import { toPiReplayState } from '../src/replay.ts'
import { mapStopReason, mapUsage, toStreamChunks } from '../src/stream.ts'

/** 中文说明：函数 usage 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** 中文说明：函数 assistant 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

/** 中文说明：函数 feed 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function* feed(...events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
  for (const event of events) yield event
}

/** 中文说明：函数 collect 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  /** 中文说明：测试局部值 out，由紧邻初始化决定。 */
  const out: StreamChunk[] = []
  /** 中文说明：测试局部值 chunk，由紧邻初始化决定。 */
  for await (const chunk of stream) out.push(chunk)
  return out
}

/** 中文说明：函数 requestVersion 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function requestVersion(ref: ImageAttachmentRef): RequestImageAttachment {
  return {
    variantId: ImageVariantId(`sha256:${'e'.repeat(64)}`),
    attachment: ref,
    data: Uint8Array.of(1, 2, 3),
    mediaType: ref.mediaType,
    bytes: 3,
    width: ref.width,
    height: ref.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: true,
  }
}

/** 中文说明：函数 attachmentStore 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function attachmentStore(readImageRequest: (
  ref: ImageAttachmentRef,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
) => Promise<RequestImageAttachment>): AttachmentStore {
  return { readImageRequest, imageHostPath: () => undefined } as unknown as AttachmentStore
}

function imageContext(attachments: AttachmentStore) {
  return { attachments, resolveImageAccess: () => undefined }
}

describe('toPiContext', () => {
  it('maps system prompt, user text, and tools', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system: 'be helpful',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
      tools: [{ name: 'f', description: 'F', parameters: { type: 'object', properties: {} } }],
    })
    expect(context.systemPrompt).toBe('be helpful')
    expect(context.messages).toEqual([{ role: 'user', content: 'hi', timestamp: 0 }])
    expect(context.tools).toEqual([
      { name: 'f', description: 'F', parameters: { type: 'object', properties: {} } },
    ])
  })

  it('omits empty tools and absent system prompt', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({ provider: 'deepseek', model: 'm', messages: [], tools: [] })
    expect(context.systemPrompt).toBeUndefined()
    expect(context.tools).toBeUndefined()
  })

  it('resolves durable image references into native pi-ai image content', async () => {
    /** 中文说明：测试局部值 attachment，由紧邻初始化决定。 */
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
    }
    /** 中文说明：测试局部值 readImageRequest，由紧邻初始化决定。 */
    const readImageRequest = vi.fn((value: ImageAttachmentRef, _policy: ImageRequestPolicy) => (
      Promise.resolve(requestVersion(value))
    ))
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = await toPiContext({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'describe' }, { type: 'image', attachment }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }, imageContext(attachmentStore(readImageRequest)))

    expect(readImageRequest).toHaveBeenCalledWith(
      attachment,
      { maxPixels: 2048 * 2048, maxBytes: 1024 * 1024 },
      undefined,
    )
    expect(context.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        { type: 'text', text: expect.stringContaining(`Image ${attachment.attachmentId}`) as string },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      timestamp: 0,
    })
  })

  it('flattens nested tool-result images into the enclosing result', async () => {
    /** 中文说明：测试局部值 attachment，由紧邻初始化决定。 */
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
    }
    /** 中文说明：测试局部值 readImageRequest，由紧邻初始化决定。 */
    const readImageRequest = vi.fn((value: ImageAttachmentRef, _policy: ImageRequestPolicy) => (
      Promise.resolve(requestVersion(value))
    ))
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = await toPiContext({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('outer'),
          content: [
            { type: 'tool-result', toolCallId: ToolCallId('empty'), content: [] },
            { type: 'text', text: 'before' },
            { type: 'tool-result', toolCallId: ToolCallId('text'), content: [{ type: 'text', text: 'middle' }] },
            {
              type: 'tool-result',
              toolCallId: ToolCallId('inner'),
              content: [
                { type: 'image', attachment },
                { type: 'text', text: 'after' },
              ],
            },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }, imageContext(attachmentStore(readImageRequest)))

    expect(context.messages).toEqual([{
      role: 'toolResult',
      toolCallId: 'outer',
      toolName: 'unknown',
      content: [
        { type: 'text', text: 'before' },
        { type: 'text', text: 'middle' },
        { type: 'text', text: expect.stringContaining(`Image ${attachment.attachmentId}`) as string },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
        { type: 'text', text: 'after' },
      ],
      isError: false,
      timestamp: 0,
    }])
  })

  it('rejects structured image history when no durable resolver is supplied', () => {
    expect(() => toPiContext({
      provider: 'openai', model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
            mediaType: 'image/png', bytes: 1, width: 1, height: 1,
          },
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('maps assistant text/reasoning/tool-call blocks', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hmm' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: ToolCallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    const message = context.messages[0] as AssistantMessage
    expect(message.role).toBe('assistant')
    expect(message.stopReason).toBe('toolUse')
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'calling' },
      { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
    ])
  })

  it('marks tool-call-free assistant messages with stopReason stop', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant', content: [{ type: 'text', text: 'done' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).stopReason).toBe('stop')
  })

  it('preserves provider and model for foreign assistant messages without replay state', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'openai',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'deepseek', model: 'old-model' },
      })],
    })
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'old-model',
    })
  })

  it('parses malformed tool-call arguments to {}', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'f', arguments: '{broken' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    /** 中文说明：测试局部值 message，由紧邻初始化决定。 */
    const message = context.messages[0] as AssistantMessage
    expect(message.content[0]).toEqual({ type: 'toolCall', id: 'c1', name: 'f', arguments: {} })
  })

  it('parses non-object argument JSON (arrays, scalars) to {}', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'f', arguments: '[1,2]' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).content[0]).toMatchObject({ arguments: {} })
  })

  it('recovers toolName for tool results from the preceding assistant call', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [
        createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'get_weather', arguments: '{}' }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
        createUserMessage({
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('c1'),
            content: [
              { type: 'text', text: 'Sunny' },
              { type: 'tool-result', toolCallId: ToolCallId('nested'), content: [{ type: 'text', text: '!' }] },
              { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
            ],
          }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
    })
    expect(context.messages[1]).toEqual({
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'get_weather',
      content: [{ type: 'text', text: 'Sunny!' }],
      isError: false,
      timestamp: 0,
    })
  })

  it('labels unmatched tool results with toolName unknown and keeps isError', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createUserMessage({
        content: [{ type: 'tool-result', toolCallId: ToolCallId('zz'), content: [], isError: true }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(context.messages[0]).toMatchObject({
      role: 'toolResult',
      toolName: 'unknown',
      isError: true,
      content: [{ type: 'text', text: '(no output)' }],
    })
  })

  it('splits mixed user text + tool results and folds history system messages', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [
        createMessage({
          role: 'system', content: [{ type: 'text', text: 'rule' }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
        createUserMessage({
          content: [
            { type: 'text', text: 'note' },
            { type: 'tool-result', toolCallId: ToolCallId('c1'), content: [{ type: 'text', text: 'ok' }] },
          ],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
    })
    expect(context.messages.map(message => message.role)).toEqual(['user', 'user', 'toolResult'])
  })

  it('skips plugin-added (unknown) blocks in assistant content', () => {
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'visible' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).content).toEqual([{ type: 'text', text: 'visible' }])
  })

  it('recombines durable content with pi-ai replay metadata across target providers and models', () => {
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = toPiReplayState(assistant({
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5',
      responseModel: 'gpt-5-2026-01-01',
      responseId: 'resp_123',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'private reasoning', thinkingSignature: 'think-sig', redacted: true },
        { type: 'text', text: 'calling', textSignature: 'text-sig' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 }, thoughtSignature: 'tool-sig' },
      ],
    }))
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'anthropic',
      model: 'claude-next',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private reasoning' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: ToolCallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'openai', model: 'gpt-5', replayState: state },
        },
      })],
    })

    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5',
      responseModel: 'gpt-5-2026-01-01',
      responseId: 'resp_123',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'private reasoning', thinkingSignature: 'think-sig', redacted: true },
        { type: 'text', text: 'calling', textSignature: 'text-sig' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 }, thoughtSignature: 'tool-sig' },
      ],
    })
  })

  it('replays all native block kinds when optional metadata is absent', () => {
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = toPiReplayState(assistant({
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'calling' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
      ],
    }))
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private reasoning' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: ToolCallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    })

    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'calling' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
      ],
    })
    expect(context.messages[0]).not.toHaveProperty('responseModel')
    expect(context.messages[0]).not.toHaveProperty('responseId')
  })

  it('degrades unsupported replay-state versions to provider-neutral history', () => {
    /** 中文说明：测试局部值 onDegrade，由紧邻初始化决定。 */
    const onDegrade = vi.fn()
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{
            provider: 'deepseek',
            model: 'old',
            replayState: { response: { kind: 'pi-ai', version: 3 }, blocks: [] },
          },
        },
      })],
    }, undefined, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'old',
      content: [{ type: 'text', text: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('unsupported version 3'))
  })

  it('degrades the flat pre-envelope replay state a legacy session log carries', () => {
    /** 中文说明：测试局部值 onDegrade，由紧邻初始化决定。 */
    const onDegrade = vi.fn()
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            replayState: {
              kind: 'pi-ai',
              version: 1,
              api: 'openai-completions',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              stopReason: 'stop',
              blocks: [{ type: 'text' }],
            },
          },
        },
      })],
    }, undefined, onDegrade)
    expect(context.messages[0]).toMatchObject({ role: 'assistant', api: 'dsh-foreign' })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('expected a response object'))
  })

  it('degrades replay metadata whose blocks do not match the durable content', () => {
    /** 中文说明：测试局部值 onDegrade，由紧邻初始化决定。 */
    const onDegrade = vi.fn()
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = toPiReplayState(assistant({ content: [{ type: 'text', text: 'done' }] }))
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    }, undefined, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      content: [{ type: 'thinking', thinking: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('block 0 does not match assistant content'))
  })

  it('degrades replay metadata whose block count differs from durable content', () => {
    /** 中文说明：测试局部值 onDegrade，由紧邻初始化决定。 */
    const onDegrade = vi.fn()
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = toPiReplayState(assistant())
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    }, undefined, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'stop',
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('block count does not match assistant content'))
  })

  /** 中文说明：测试局部值 validResponse，由紧邻初始化决定。 */
  const validResponse = {
    kind: 'pi-ai',
    version: 2,
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    stopReason: 'stop',
  }
  /** 中文说明：测试局部值 validReplay，由紧邻初始化决定。 */
  const validReplay = { response: validResponse, blocks: [{ type: 'text' }] }

  /** Convert with the given state and assert the message degraded to foreign with the given reason. */
  /* 中文说明：函数 expectDegraded 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
  function expectDegraded(replayState: unknown, message: string): void {
    /** 中文说明：测试局部值 onDegrade，由紧邻初始化决定。 */
    const onDegrade = vi.fn()
    /** 中文说明：测试局部值 context，由紧邻初始化决定。 */
    const context = toPiContext({
      provider: 'deepseek',
      model: 'next-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState },
        },
      })],
    }, undefined, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      content: [{ type: 'text', text: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining(message))
  }

  it.each([
    ['provider', { ...validReplay, response: { ...validResponse, provider: 'openai' } }],
    ['model', { ...validReplay, response: { ...validResponse, model: 'deepseek-v4-pro' } }],
  ])('degrades replay metadata whose %s differs from assistant source', (field, replayState) => {
    expectDegraded(replayState, `${field} does not match assistant source`)
  })

  it.each([
    ['number state', 1, 'expected a replay envelope'],
    ['null state', null, 'expected a replay envelope'],
    ['array state', [], 'expected a replay envelope'],
    ['missing response', { blocks: [] }, 'expected a response object'],
    ['array response', { ...validReplay, response: [] }, 'expected a response object'],
    ['unknown kind', { ...validReplay, response: { ...validResponse, kind: 'other' } }, 'unknown state kind'],
    ['non-string api', { ...validReplay, response: { ...validResponse, api: 1 } }, 'api must be a non-empty string'],
    ['empty provider', { ...validReplay, response: { ...validResponse, provider: '' } }, 'provider must be a non-empty string'],
    ['missing model', { ...validReplay, response: { ...validResponse, model: undefined } }, 'model must be a non-empty string'],
    ['unknown stop reason', { ...validReplay, response: { ...validResponse, stopReason: 'pause' } }, 'unknown stopReason'],
    ['non-string response model', { ...validReplay, response: { ...validResponse, responseModel: 1 } }, 'responseModel must be a string'],
    ['non-string response id', { ...validReplay, response: { ...validResponse, responseId: 1 } }, 'responseId must be a string'],
    ['missing blocks', { response: validResponse }, 'blocks must be an array'],
    ['non-array blocks', { ...validReplay, blocks: 'text' }, 'blocks must be an array'],
    ['number block', { ...validReplay, blocks: [1] }, 'block 0 must be an object'],
    ['null block', { ...validReplay, blocks: [null] }, 'block 0 must be an object'],
    ['array block', { ...validReplay, blocks: [[]] }, 'block 0 must be an object'],
    ['unknown block type', { ...validReplay, blocks: [{ type: 'audio' }] }, 'block 0 has an unknown type'],
    ['non-string signature', { ...validReplay, blocks: [{ type: 'text', textSignature: 1 }] }, 'textSignature must be a string'],
    ['non-boolean redaction', { ...validReplay, blocks: [{ type: 'reasoning', redacted: 'yes' }] }, 'redacted must be boolean'],
  ])('degrades malformed replay state: %s', (_name, replayState, message) => {
    expectDegraded(replayState, message)
  })
})

describe('toStreamChunks', () => {
  /** 中文说明：测试局部值 partialWithToolCall，由紧邻初始化决定。 */
  const partialWithToolCall = assistant({
    content: [{ type: 'toolCall', id: 'call-1', name: 'f', arguments: {} }],
  })

  it('maps text events to text blocks', async () => {
    /** 中文说明：测试局部值 done，由紧邻初始化决定。 */
    const done = assistant({ content: [{ type: 'text', text: 'hi' }], usage: usage(3, 2) })
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'start', partial: assistant() },
      { type: 'text_start', contentIndex: 0, partial: assistant() },
      { type: 'text_delta', contentIndex: 0, delta: 'hi', partial: assistant() },
      { type: 'text_end', contentIndex: 0, content: 'hi', partial: assistant() },
      { type: 'done', reason: 'stop', message: done },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: {
            kind: 'pi-ai',
            version: 2,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            stopReason: 'stop',
          },
          blocks: [{ type: 'text' }],
        },
      },
    ])
  })

  it('maps thinking events to reasoning blocks', async () => {
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'thinking_start', contentIndex: 0, partial: assistant() },
      { type: 'thinking_delta', contentIndex: 0, delta: 'mull', partial: assistant() },
      { type: 'thinking_end', contentIndex: 0, content: 'mull', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks.slice(0, 3)).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'mull' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'mull' } },
    ])
  })

  it('maps tool-call events, re-stringifying parsed arguments', async () => {
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: partialWithToolCall },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{"a"', partial: partialWithToolCall },
      { type: 'toolcall_delta', contentIndex: 0, delta: ':1}', partial: partialWithToolCall },
      {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'call-1', name: 'f', arguments: { a: 1 } },
        partial: partialWithToolCall,
      },
      { type: 'done', reason: 'toolUse', message: assistant({ content: partialWithToolCall.content, stopReason: 'toolUse' }) },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'f', argumentsDelta: '{"a"' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'f', argumentsDelta: ':1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'f', arguments: '{"a":1}' } },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      {
        type: 'finish',
        reason: { kind: 'tool-calls' },
        replayState: {
          response: {
            kind: 'pi-ai',
            version: 2,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            stopReason: 'toolUse',
          },
          blocks: [{ type: 'tool-call' }],
        },
      },
    ])
  })

  it('tolerates toolcall_start with a missing partial entry', async () => {
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: assistant() },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' })
  })

  it('maps error events to error finish chunks (in-stream error style)', async () => {
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = assistant({ stopReason: 'error', errorMessage: 'boom', usage: usage(1, 0) })
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'error', reason: 'error', error },
    )))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'PI_AI_ERROR' } } },
    ])
  })

  it('maps aborted error events to aborted finish', async () => {
    /** 中文说明：测试局部值 error，由紧邻初始化决定。 */
    const error = assistant({ stopReason: 'aborted' })
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed({ type: 'error', reason: 'aborted', error })))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } },
    })
  })

  it('rejects a stream that ends without done or error', async () => {
    await expect(collect(toStreamChunks(feed({ type: 'start', partial: assistant() }))))
      .rejects.toThrow(/without done\/error/)
  })

  it('preserves an unknown SDK iterator Error exactly', async () => {
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = Object.assign(new Error('SDK transport exploded'), { code: 'ECONNRESET' })
    /** 中文说明：函数 failedSdkStream 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
    async function* failedSdkStream(): AsyncGenerator<AssistantMessageEvent> {
      throw original
    }

    await expect(collect(toStreamChunks(failedSdkStream()))).rejects.toBe(original)
  })
})

describe('mapStopReason / mapUsage', () => {
  it.each([
    ['stop', { kind: 'stop' }],
    ['length', { kind: 'max-tokens' }],
    ['toolUse', { kind: 'tool-calls' }],
    ['pending', {
      kind: 'error',
      failure: { message: 'pi-ai stream for model "deepseek-v4-flash" ended pending', code: 'PI_AI_ERROR' },
    }],
    ['deferred', {
      kind: 'error',
      failure: { message: 'pi-ai deferred response for model "deepseek-v4-flash" is not supported', code: 'PI_AI_ERROR' },
    }],
    ['aborted', { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } }],
  ] as const)('maps %s', (stopReason, expected) => {
    expect(mapStopReason(assistant({ stopReason, content: [{ type: 'text', text: 'ok' }] }))).toEqual(expected)
  })

  it('classifies a completed stop with no content as an EMPTY_RESPONSE error', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop' }))).toEqual({
      kind: 'error',
      failure: {
        message: 'model "deepseek-v4-flash" returned a completed response with no content',
        code: EMPTY_RESPONSE_CODE,
      },
    })
  })

  it('keeps a thinking-only stop successful (any block counts as content)', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop', content: [{ type: 'thinking', thinking: 'mull' }] })))
      .toEqual({ kind: 'stop' })
  })

  it('defaults the error message when pi-ai omits it', () => {
    expect(mapStopReason(assistant({ stopReason: 'error' })))
      .toEqual({ kind: 'error', failure: { message: 'pi-ai stream error', code: 'PI_AI_ERROR' } })
  })

  it('maps routable HTTP-ish error messages to stable codes', () => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 401: bad key' })))
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: rate limit' })))
      .toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: insufficient_quota' })))
      .toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.',
    }))).toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 500: backend down' })))
      .toMatchObject({ kind: 'error', failure: { code: 'SERVER' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'provider timed out' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'ECONNRESET socket closed' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: input exceeds the model context window limit',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: request too large for model context',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: invalid input: temperature exceeds maximum allowed value',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 413: Payload Too Large' })))
      .toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'Failed to buffer the request body: length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'vector length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  })

  it.each([
    'other side closed',
    'HTTP2 request did not get a response',
    'WebSocket closed unexpectedly',
    // undici flattens a mid-stream socket drop to this bare word (its SocketError
    // cause is discarded upstream before it reaches us).
    'terminated',
    'Premature close',
    // pi-ai's per-provider throws when the wire closes before the terminal event.
    'Anthropic stream ended before message_stop',
    'OpenAI Responses stream ended before a terminal response event',
    'openrouter stream ended without a terminal event',
    'Stream ended without finish_reason',
  ])('maps pi-ai transport wording %j', (errorMessage) => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
  })

  it('uses pi-ai provider-specific overflow classification without losing rate-limit exclusions', () => {
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'ThrottlingException: Too many tokens, rate limit reached',
    }))).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
  })

  it('uses the resolved context window for silent and length-stop overflows', () => {
    // Non-empty content keeps the no-window branch on the successful stop path
    // (an empty stop is EMPTY_RESPONSE, covered above); overflow wins over both.
    /** 中文说明：测试局部值 silent，由紧邻初始化决定。 */
    const silent = assistant({ stopReason: 'stop', usage: usage(101, 0), content: [{ type: 'text', text: 'x' }] })
    expect(mapStopReason(silent)).toEqual({ kind: 'stop' })
    expect(mapStopReason(silent, 100)).toEqual({
      kind: 'error',
      failure: {
        message: 'pi-ai detected context overflow for model "deepseek-v4-flash"',
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })

    /** 中文说明：测试局部值 truncated，由紧邻初始化决定。 */
    const truncated = assistant({ stopReason: 'length', usage: usage(80, 0, 19) })
    expect(mapStopReason(truncated)).toEqual({ kind: 'max-tokens' })
    expect(mapStopReason(truncated, 100)).toMatchObject({
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    })
  })

  it('maps cache fields only when nonzero', () => {
    expect(mapUsage(usage(10, 5, 8, 2))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 25,
      cacheReadTokens: 8,
      cacheWriteTokens: 2,
    })
    expect(mapUsage(usage(10, 5))).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })
})

describe('toStreamChunks edge branches', () => {
  it('omits the name field for tool calls whose partial carried an empty name', async () => {
    /** 中文说明：测试局部值 blank，由紧邻初始化决定。 */
    const blank = assistant({ content: [{ type: 'toolCall', id: 'x', name: '', arguments: {} }] })
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: blank },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: blank },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'x', argumentsDelta: '{}' })
  })
})

describe('toStreamChunks defensive branches', () => {
  it('tolerates a toolcall_delta with no preceding toolcall_start', async () => {
    /** 中文说明：测试局部值 chunks，由紧邻初始化决定。 */
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[0]).toEqual({ type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' })
  })
})
