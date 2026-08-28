/**
 * 文件职责：验证DeepSeek LLM的 serialize.spec.ts 行为与网络边界。
 * 技术维度：TypeScript、Fetch、SSE、OAuth/密钥认证、模型目录和运行时模式校验。
 * 产品维度：让 Agent 能稳定调用供应商模型、发现能力并接收流式结果。
 * 逻辑维度：构造请求或模拟服务器，驱动适配器并断言事件与错误。
 * 关键边界：网络响应属于不可信输入；密钥和令牌不得记录；取消必须终止请求与流。
 * 新手阅读建议：先读 config/auth/catalog，再看 adapter/stream，最后阅读错误和重放测试。
 */
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ToolCallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import {
  serializeMessages,
  serializeMessagesWithImages,
  serializeRequest,
  serializeRequestWithImages,
} from '../src/serialize.ts'
import type { ImageSerializationOptions } from '../src/serialize.ts'

/** 中文说明：类型或类 FileResolver 约束模型请求、认证或流事件职责。 */
type FileResolver = Extract<ImageSerializationOptions['representation'], { kind: 'file' }>['resolveFileId']

/** 中文说明：函数 request 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [], ...overrides }
}

/** 中文说明：函数 imageRef 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function imageRef(mediaType: ImageMediaType = 'image/png', bytes = 3): ImageAttachmentRef {
  /** 中文说明：测试局部值 digit，由紧邻初始化决定。 */
  const digit = ({
    'image/png': 'a',
    'image/jpeg': 'b',
    'image/webp': 'c',
    'image/gif': 'd',
  } as const)[mediaType]
  return {
    attachmentId: AttachmentId(`sha256:${digit.repeat(64)}`),
    mediaType,
    bytes,
    width: 1,
    height: 1,
  }
}

/** 中文说明：函数 fileResolver 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function fileResolver(id = 'file-api-image') {
  return vi.fn<FileResolver>(() => Promise.resolve(id))
}

/** 中文说明：函数 requestVersion 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function requestVersion(ref: ImageAttachmentRef): RequestImageAttachment {
  /** 中文说明：测试局部值 hash，由紧邻初始化决定。 */
  const hash = String(ref.attachmentId).slice('sha256:'.length)
  return {
    variantId: ImageVariantId(`sha256:${hash}`),
    attachment: ref,
    data: new Uint8Array(ref.bytes),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: ref.mediaType === 'image/png',
  }
}

/** 中文说明：函数 imageOptions 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function imageOptions(
  refs: readonly ImageAttachmentRef[],
  resolveFileId: FileResolver = fileResolver(),
  maxRequestImageBytes = 20 * 1024 * 1024,
): ImageSerializationOptions {
  return {
    representation: { kind: 'file' as const, resolveFileId },
    requestImages: new Map(refs.map(ref => [ref.attachmentId, requestVersion(ref)])),
    maxRequestImageBytes,
  }
}

/** 中文说明：函数 inlineImageOptions 的参数见签名，返回结果供模型流程使用；示例见本文件。 */
function inlineImageOptions(
  refs: readonly ImageAttachmentRef[],
  maxRequestImageBytes = 20 * 1024 * 1024,
  byteQuantum = 10 * 1024 * 1024,
): ImageSerializationOptions {
  return {
    representation: { kind: 'base64' },
    requestImages: new Map(refs.map(ref => [ref.attachmentId, requestVersion(ref)])),
    maxRequestImageBytes,
    byteQuantum,
  }
}

describe('serializeMessages', () => {
  it('maps user text to string content', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('passes reasoning_content back on tool-call-free turns', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    // A gateway that re-encodes the conversation for another vendor recovers
    // the upstream thinking signature by hashing this exact text, and a turn
    // that called no tool carries it nowhere else.
    expect(wire).toEqual([{ role: 'assistant', content: 'answer', reasoning_content: 'thinking…' }])
  })

  it('passes reasoning_content back on tool-call turns (official passback rule)', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: ToolCallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      // "" (not null) on tool-call turns — mirrors the official samples'
      // verbatim message replay; some gateways reject null.
      content: '',
      reasoning_content: 'I should check the weather.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('serializes parallel tool calls in order', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: ToolCallId('a'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: ToolCallId('b'), name: 'two', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    /** 中文说明：测试局部值 assistant，由紧邻初始化决定。 */
    const assistant = wire[0] as { tool_calls: { id: string }[] }
    expect(assistant.tool_calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  it('turns tool results into role:tool messages', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('call-1'),
          content: [{ type: 'text', text: 'Sunny 22C' }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: 'Sunny 22C' }])
  })

  it('sends a sentinel for empty tool-result content', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: '(no output)' }])
  })

  it('splits mixed user text + tool results into separate wire messages', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'context note' },
          { type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [{ type: 'text', text: 'ok' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'context note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('skips plugin-added block types (merge-extensible ContentBlockMap)', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([
      createUserMessage({
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'see chart' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'see chart' }])
  })

  it('rejects image blocks instead of silently flattening them away', () => {
    expect(() => serializeMessages([createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
          mediaType: 'image/png', bytes: 68, width: 1, height: 1,
        },
      }],
      source: { kind: 'plugin', plugin: 'test' },
    })])).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT' }))
  })

  it('emits an empty user message rather than dropping block-less messages', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([createUserMessage({
      content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'user', content: '' }])
  })
})

describe('serializeRequest', () => {
  /** 中文说明：测试局部值 history，由紧邻初始化决定。 */
  const history: Message[] = [createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })]

  it('always streams with usage and maps the basics', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history }))
    expect(wire).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('prepends the system prompt', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history, system: 'be helpful' }))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(wire.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('maps sampling params and stop sequences', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history, temperature: 0.2, maxTokens: 100, stop: ['END'] }))
    expect(wire.temperature).toBe(0.2)
    expect(wire.max_tokens).toBe(100)
    expect(wire.stop).toEqual(['END'])
  })

  it('maps tools to the wire function shape', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({
      messages: history,
      tools: [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } },
      ],
    }))
    expect(wire.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ])
  })

  it('omits an empty tools array', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it.each(['low', 'high', 'max'] as const)('maps adapter-default thinking and request effort %s', (effort) => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId(effort) }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe(effort)
  })

  it('maps off to disabled thinking without a wire reasoning effort', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', () => {
    expect(() => serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })

  it('disables thinking for session-title requests without changing adapter defaults', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', () => {
    expect(() => serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }))
  })
})

describe('image serialization', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ] as const)('preserves ordered text and %s image parts', async (mediaType) => {
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = fileResolver()
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef(mediaType)
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'text', text: 'before' },
          { type: 'image', attachment: ref },
          { type: 'text', text: 'after' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref], resolveFileId))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'before' },
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'file', file_id: 'file-api-image' },
        { type: 'text', text: 'after' },
      ],
    }])
  })

  it.each([
    ['image/png', 'data:image/png;base64,AAAA'],
    ['image/jpeg', 'data:image/jpeg;base64,AAAA'],
    ['image/webp', 'data:image/webp;base64,AAAA'],
    ['image/gif', 'data:image/gif;base64,AAAA'],
  ] as const)('serializes every retained %s request version as an inline data URL', async (mediaType, url) => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef(mediaType)
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), inlineImageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining(`Image ${ref.attachmentId}; request preview 1x1px`) as string },
        { type: 'image_url', image_url: { url } },
      ],
    }])
  })

  it('gives image-only input a stable handle and request dimensions', async () => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef()
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref]))

    expect(wire.messages).toEqual([{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Image ${ref.attachmentId}; request preview 1x1px. It may be resized or re-encoded; source dimensions, format, and byte size may differ.`,
        },
        { type: 'file', file_id: 'file-api-image' },
      ],
    }])
  })

  it('includes provider-resolved normalized access in a retained image handle', async () => {
    const ref = { ...imageRef(), name: 'diagram.png', width: 2048, height: 1024 }
    const images = imageOptions([ref])
    const version = images.requestImages.get(ref.attachmentId) as RequestImageAttachment
    version.width = 1130
    version.height = 565
    images.resolveImageAccess = () => ({ readonlyPath: '/tmp/dsh/objects/aa/object' })
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [{
        type: 'text',
        text: expect.stringContaining('Image "diagram.png"') as string,
      }, { type: 'file' }],
    })
    expect(JSON.stringify(wire.messages[0])).toContain('/tmp/dsh/objects/aa/object')
    expect(JSON.stringify(wire.messages[0])).toContain('request preview 1130x565px')
  })

  it('rejects an image whose prepared request version is absent', async () => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef()
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: ref }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([]))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('keeps tool content textual and groups consecutive tool-result images afterward', async () => {
    /** 中文说明：测试局部值 messages，由紧邻初始化决定。 */
    const messages = [
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('first'),
          content: [{ type: 'image', attachment: imageRef() }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('second'),
          content: [
            { type: 'text', text: 'caption' },
            { type: 'image', attachment: imageRef('image/jpeg') },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    /** 中文说明：测试局部值 png，由紧邻初始化决定。 */
    const png = imageRef()
    /** 中文说明：测试局部值 jpeg，由紧邻初始化决定。 */
    const jpeg = imageRef('image/jpeg')
    await expect(serializeMessagesWithImages(messages, imageOptions(
      [png, jpeg],
      vi.fn((version: RequestImageAttachment) => Promise.resolve(`file-api-${version.mediaType}`)),
    ))).resolves.toEqual([
      {
        role: 'tool',
        tool_call_id: 'first',
        content: expect.stringContaining(`Image ${png.attachmentId}`) as string,
      },
      {
        role: 'tool',
        tool_call_id: 'second',
        content: expect.stringContaining(`caption\nImage ${jpeg.attachmentId}`) as string,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Attached image(s) from tool result:' },
          { type: 'file', file_id: 'file-api-image/png' },
          { type: 'file', file_id: 'file-api-image/jpeg' },
        ],
      },
    ])
  })

  it('does not emit an empty user message for ignored content beside a tool result', async () => {
    /** 中文说明：测试局部值 messages，由紧邻初始化决定。 */
    const messages = [createUserMessage({
      content: [
        { type: 'text', text: '' },
        { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
        {
          type: 'tool-result',
          toolCallId: ToolCallId('result'),
          content: [{ type: 'text', text: 'ok' }],
        },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(messages, imageOptions([], fileResolver()))).resolves.toEqual([
      { role: 'tool', tool_call_id: 'result', content: 'ok' },
    ])
  })

  it('recursively converts nested tool-result content and preserves the empty fallback', async () => {
    /** 中文说明：测试局部值 messages，由紧邻初始化决定。 */
    const messages = [createUserMessage({
      content: [
        {
          type: 'tool-result',
          toolCallId: ToolCallId('nested'),
          content: [{
            type: 'tool-result',
            toolCallId: ToolCallId('inner'),
            content: [{ type: 'text', text: 'inside' }],
          }],
        },
        { type: 'tool-result', toolCallId: ToolCallId('empty'), content: [] },
      ],
      source: { kind: 'plugin', plugin: 'test' },
    })]

    await expect(serializeMessagesWithImages(messages, imageOptions([], fileResolver()))).resolves.toEqual([
      { role: 'tool', tool_call_id: 'nested', content: 'inside' },
      { role: 'tool', tool_call_id: 'empty', content: '(no output)' },
    ])
  })

  it('flushes tool-result images before system and assistant history', async () => {
    /** 中文说明：测试局部值 imageResult，由紧邻初始化决定。 */
    const imageResult = (id: string) => createUserMessage({
      content: [{
        type: 'tool-result',
        toolCallId: ToolCallId(id),
        content: [{ type: 'image', attachment: imageRef() }],
      }],
      source: { kind: 'plugin' as const, plugin: 'test' },
    })
    /** 中文说明：测试局部值 messages，由紧邻初始化决定。 */
    const messages = [
      imageResult('before-system'),
      createMessage({
        role: 'system',
        content: [{ type: 'text', text: 'system history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      imageResult('before-assistant'),
      createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant history' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ]

    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeMessagesWithImages(messages, imageOptions([imageRef()], fileResolver()))
    expect(wire).toEqual([
      {
        role: 'tool',
        tool_call_id: 'before-system',
        content: expect.stringContaining('request preview 1x1px') as string,
      },
      expect.objectContaining({ role: 'user' }),
      { role: 'system', content: 'system history' },
      {
        role: 'tool',
        tool_call_id: 'before-assistant',
        content: expect.stringContaining('request preview 1x1px') as string,
      },
      expect.objectContaining({ role: 'user' }),
      { role: 'assistant', content: 'assistant history' },
    ])
  })

  it('offloads oldest images before reads and keeps the newest image', async () => {
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = fileResolver()
    /** 中文说明：测试局部值 png，由紧邻初始化决定。 */
    const png = imageRef('image/png', 3)
    /** 中文说明：测试局部值 jpeg，由紧邻初始化决定。 */
    const jpeg = imageRef('image/jpeg', 3)
    const images = imageOptions([png, jpeg], resolveFileId, 4)
    images.resolveImageAccess = ref => ref.mediaType === 'image/png'
      ? { readonlyPath: '/tmp/dsh/objects/png' }
      : undefined
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [
          { type: 'image', attachment: png },
          { type: 'image', attachment: jpeg },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), images)

    expect(wire.messages[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'text',
          text: expect.stringContaining(`image omitted to fit request image limits; ${png.attachmentId}. Normalized copy (read-only; may be resized or re-encoded): "/tmp/dsh/objects/png"`) as string,
        },
        { type: 'text', text: expect.stringContaining(`Image ${jpeg.attachmentId}`) as string },
        { type: 'file', file_id: 'file-api-image' },
      ],
    })
    expect(resolveFileId).toHaveBeenCalledTimes(1)
    expect(resolveFileId.mock.calls[0]?.[0]).toMatchObject({ attachment: { mediaType: 'image/jpeg' } })
  })

  it('drops base64 history from a 20-unit high watermark to a 10-unit low watermark', async () => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef('image/png', 3)
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: Array.from({ length: 21 }, () => ({ type: 'image' as const, attachment: ref })),
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), inlineImageOptions([ref], 80, 40))

    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = wire.messages[0]?.content
    expect(JSON.stringify(content).match(/image omitted to fit request image limits/g)).toHaveLength(11)
    expect(JSON.stringify(content).match(/"type":"image_url"/g)).toHaveLength(10)
  })

  it('rejects an unprepared image while computing exact request bytes', async () => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef()
    await expect(serializeRequestWithImages(request({
      model: 'deepseek-v4-flash-vision-exp',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([]))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it.each(['system', 'assistant'] as const)('rejects an image in %s history before reading attachments', async (role) => {
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = vi.fn()
    await expect(serializeMessagesWithImages([createMessage({
      role,
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveFileId).not.toHaveBeenCalled()
  })

  it('rejects unsupported image history before request offloading can replace it', async () => {
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = vi.fn()
    await expect(serializeRequestWithImages(request({
      messages: [createMessage({
        role: 'system',
        content: [{ type: 'image', attachment: imageRef('image/png', 300) }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([imageRef('image/png', 300)], resolveFileId, 1)))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(resolveFileId).not.toHaveBeenCalled()
  })

  it('prepends the request system prompt on the image path', async () => {
    /** 中文说明：测试局部值 ref，由紧邻初始化决定。 */
    const ref = imageRef()
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = await serializeRequestWithImages(request({
      system: 'system prompt',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }), imageOptions([ref]))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'system prompt' })
  })

  it('preserves stable file-resolution failure codes', async () => {
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('Stored attachment bytes are corrupt.') as Error & { code: string }
    failure.code = 'ATTACHMENT_CORRUPT'
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = vi.fn(() => Promise.reject(failure))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId)))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('preserves non-attachment resolver failures', async () => {
    /** 中文说明：测试局部值 failure，由紧邻初始化决定。 */
    const failure = new Error('resolver failed')
    /** 中文说明：测试局部值 resolveFileId，由紧邻初始化决定。 */
    const resolveFileId = vi.fn(() => Promise.reject(failure))
    await expect(serializeMessagesWithImages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })], imageOptions([imageRef()], resolveFileId))).rejects.toBe(failure)
  })
})

describe('review fixes: assistant content shapes', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', () => {
    // Aborted/empty assistant turns: no text, no calls → "". The earlier
    // null shape was live-falsified: the API 400s a null-content assistant
    // message without tool_calls ("content or tool_calls must be set").
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content beside its reasoning', () => {
    // The model can answer entirely in the reasoning channel (a v4-flash
    // greeting did, live). Content must still be SET — a null here poisoned
    // the session log and bricked every later turn of that session.
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{
      role: 'assistant', content: '', reasoning_content: '你好！有什么我可以帮你的吗？',
    }])
  })

  it('serializes tool-call turns with empty string content, not null', () => {
    /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
    const wire = serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: ToolCallId('c'), name: 'f', arguments: '{}' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire[0]).toMatchObject({ content: '' })
  })
})
