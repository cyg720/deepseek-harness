/**
 * 文件职责：验证 service.spec.ts 覆盖的 LLM 计量、配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型调用及令牌统计能向 Agent 和使用者提供稳定、可追踪的结果。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、投影结果和清理行为。
 * 关键边界：测试替身必须保持确定性；持久化事件应可重放；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, {
  errorChain,
  GenerateOptions,
  HarnessError,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmAdapter,
  LlmError,
  ProviderRequestId,
  ReasoningEffortId,
  resolveRetryPolicy,
  StreamChunk,
  createMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type {
  LlmModelContext,
  LlmModelInfo,
  LlmModelReasoningInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
} from '@deepseek-ai/dsh-llm'

/** 中文说明：class ScriptedAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class ScriptedAdapter extends LlmAdapter {
  constructor(private script: StreamChunk[]) {
    super()
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * this.script
  }
}

/** 中文说明：class RecordingAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class RecordingAdapter extends ScriptedAdapter {
  lastOptions: GenerateOptions | undefined

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    yield * super.stream(options)
  }
}

/** 中文说明：class ThrowingAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class ThrowingAdapter extends LlmAdapter {
  constructor(private readonly failure: Error) {
    super()
  }

  stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw this.failure
  }
}

/** 中文说明：class CatalogAdapter 定义本测试所需的数据或行为，用于表达当前协议场景。 */
class CatalogAdapter extends ScriptedAdapter {
  constructor(
    private readonly provider: LlmProviderInfo,
    private readonly models: readonly LlmModelInfo[],
    private readonly contexts: Readonly<Record<string, LlmModelContext>> = {},
    private readonly reasoning: Readonly<Record<string, LlmModelReasoningInfo>> = {},
    private readonly defaultMaxTokens: Readonly<Record<string, number>> = {},
  ) {
    super(SCRIPT)
  }

  override providerInfo(_provider: string): LlmProviderInfo {
    return this.provider
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.contexts[model] === undefined ? {} : { context: this.contexts[model] },
      ...this.reasoning[model] === undefined ? {} : { reasoning: this.reasoning[model] },
      ...this.defaultMaxTokens[model] === undefined ? {} : { defaultMaxTokens: this.defaultMaxTokens[model] },
    })
  }
}

/** 中文说明：常量 SCRIPT 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

/** 中文说明：函数 collect 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const chunks: StreamChunk[] = []
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('LlmRuntime', () => {
  it('recognizes structured and model-capacity context-window overflow details', () => {
    expect(isContextWindowExceededError('context_length_exceeded maximum context length')).toBe(true)
    expect(isContextWindowExceededError('context-window-overflowed')).toBe(true)
    expect(isContextWindowExceededError('This model maximum context length is 128000 tokens')).toBe(true)
    expect(isContextWindowExceededError('input is too long for this model')).toBe(true)
    expect(isContextWindowExceededError('request too large for model context')).toBe(true)
    expect(isContextWindowExceededError('input exceeds the model context window limit')).toBe(true)
  })

  it('does not mistake unrelated input validation for context-window overflow', () => {
    expect(isContextWindowExceededError('invalid request: malformed tool arguments')).toBe(false)
    expect(isContextWindowExceededError('invalid input: temperature exceeds maximum allowed value')).toBe(false)
    expect(isContextWindowExceededError('input exceeds maximum allowed value')).toBe(false)
    expect(isContextWindowExceededError('context window size must be positive')).toBe(false)
  })

  it('distinguishes exhausted account quota from transient rate limiting', () => {
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for (const detail of [
      'insufficient_quota',
      'account balance depleted',
      'usage-limit-exceeded',
      'out of credits',
      'OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.',
    ]) expect(isQuotaExceededError(detail)).toBe(true)
    expect(isQuotaExceededError('HTTP 429: rate limit reached')).toBe(false)
    expect(isQuotaExceededError('quota resets in one minute')).toBe(false)
  })

  it('errorChain renders the full cause chain of a wrapped transport failure', () => {
    /** 中文说明：变量 chain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chain = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') })
    expect(errorChain(chain)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:443')
  })

  it('errorChain renders AggregateError members (Happy Eyeballs multi-address failures)', () => {
    /** 中文说明：变量 aggregate 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const aggregate = new AggregateError(
      [new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')],
      '',
    )
    /** 中文说明：变量 wrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wrapped = new TypeError('fetch failed', { cause: aggregate })
    expect(errorChain(wrapped)).toBe(
      'fetch failed: AggregateError [connect ECONNREFUSED ::1:443; connect ECONNREFUSED 127.0.0.1:443]',
    )
  })

  it('errorChain survives non-Error values, hostile coercion, and circular causes', () => {
    expect(errorChain('plain string')).toBe('plain string')
    expect(errorChain({ message: 'structured provider failure', code: 'SERVER' }))
      .toBe('structured provider failure')
    expect(errorChain({ toString: () => { throw new Error('hostile') } })).toBe('<unrenderable value>')
    /** 中文说明：变量 circular 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const circular = new Error('outer')
    circular.cause = circular
    expect(errorChain(circular)).toBe('outer: <circular cause>')
    // A hostile accessor collapses only its own node, not the whole chain.
    /** 中文说明：变量 hostileNode 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const hostileNode = new Error('node')
    Object.defineProperty(hostileNode, 'message', { get() { throw new Error('hostile getter') } })
    expect(errorChain(new Error('outer', { cause: hostileNode }))).toBe('outer: <unrenderable value>')
    // A diamond-shared (non-cyclic) cause renders in full on both paths.
    /** 中文说明：变量 shared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const shared = new Error('shared')
    /** 中文说明：变量 diamond 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const diamond = new AggregateError([new Error('a', { cause: shared }), new Error('b', { cause: shared })], 'agg')
    expect(errorChain(diamond)).toBe('agg [a: shared; b: shared]')
  })

  it('errorChain falls back to the error name, skips empty aggregates, and stops at null causes', () => {
    expect(errorChain(new TypeError('', { cause: null }))).toBe('TypeError')
    expect(errorChain(new AggregateError([], 'all failed'))).toBe('all failed')
  })

  it('errorChain collapses a cause that repeats the wrapper message verbatim', () => {
    // The `new HarnessError(String(value), code, { cause: value })` normalization
    // pattern repeats its cause; rendering it twice would only add noise.
    /** 中文说明：变量 wrapped 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const wrapped = new HarnessError('boom', 'UNKNOWN', { cause: 'boom' })
    expect(errorChain(wrapped)).toBe('boom')
  })

  it('routes stream() to the registered adapter', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test-provider'], new ScriptedAdapter(SCRIPT))

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: StreamChunk[] = []
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) chunks.push(chunk)
    expect(chunks).toEqual(SCRIPT)
  })

  it('trusts the immutable message creation boundary for direct calls', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['test-provider'], adapter)
    /** 中文说明：变量 message 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const message = createMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    })

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({
      provider: 'test-provider',
      model: 'test-model',
      messages: [message],
    })) { /* drain */ }

    expect(adapter.lastOptions?.messages[0]).toBe(message)
  })

  it('projects file blocks through every host-path availability outcome', async () => {
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'ab'.repeat(32)}`),
      name: 'notes.txt',
      bytes: 3,
    }
    const cases = [
      {
        name: 'native tools under read-only permission receive the mapped read path',
        attachments: { fileHostPath: () => '/host/notes.txt' },
        fs: { processPathFromHostPath: () => '/sandbox/notes.txt' },
        expected: '"/sandbox/notes.txt"',
      },
      {
        name: 'Code Mode under workspace-write permission receives the same mapped read path',
        attachments: { fileHostPath: () => '/host/notes.txt' },
        fs: { processPathFromHostPath: () => '/code-sandbox/notes.txt' },
        expected: '"/code-sandbox/notes.txt"',
      },
      {
        name: 'missing attachment service',
        expected: 'current execution environment cannot access a readable path',
      },
      {
        name: 'provider without a host path',
        attachments: { fileHostPath: () => undefined },
        expected: 'current execution environment cannot access a readable path',
      },
      {
        name: 'invalid durable reference',
        attachments: { fileHostPath: () => { throw new Error('invalid ref') } },
        expected: 'current execution environment cannot access a readable path',
      },
      {
        name: 'missing filesystem mapping',
        attachments: { fileHostPath: () => '/host/notes.txt' },
        expected: 'current execution environment cannot access a readable path',
      },
    ]

    for (const fixture of cases) {
      const ctx = new Context()
      if (fixture.attachments !== undefined) ctx.provide('attachments', fixture.attachments as never)
      if (fixture.fs !== undefined) ctx.provide('fs', fixture.fs as never)
      await ctx.plugin(LlmRuntime)
      const adapter = new RecordingAdapter(SCRIPT)
      ctx.llm.registerAdapter(['test-provider'], adapter)

      await collect(ctx.llm.stream({
        provider: 'test-provider',
        model: 'test-model',
        messages: [createUserMessage({
          content: [{ type: 'file', attachment }],
          source: { kind: 'user' },
        })],
      }))

      const projected = adapter.lastOptions?.messages[0]?.content[0]
      expect(projected, fixture.name).toMatchObject({ type: 'text' })
      if (projected?.type !== 'text') throw new Error(`expected projected text for ${fixture.name}`)
      expect(projected.text, fixture.name).toContain(fixture.expected)
      if (fixture.fs !== undefined) {
        expect(projected.text, fixture.name).toContain('include this saved path in the delegation prompt')
      }
    }
  })

  it('captures provider-owned retry policy at registration and defaults omission', async () => {
    /** 中文说明：变量 configured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const configured = resolveRetryPolicy({ mode: 'always' }, 'test retryPolicy')
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override providerRetryPolicy(provider: string) {
        return provider === 'configured' ? configured : undefined
      }
    }(SCRIPT)
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['configured', 'defaulted'], adapter)

    expect(ctx.llm.providerRetryPolicy('configured')).toBe(configured)
    expect(ctx.llm.providerRetryPolicy('defaulted')).toMatchObject({
      mode: 'normal',
      maxRetries: 5,
    })
    expect(() => ctx.llm.providerRetryPolicy('missing')).toThrow(
      expect.objectContaining({ code: 'NO_ADAPTER' }),
    )
  })

  it('keeps a prepared registration and retry policy after route replacement', async () => {
    /** 中文说明：变量 oldPolicy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oldPolicy = resolveRetryPolicy({ mode: 'always' }, 'old retryPolicy')
    /** 中文说明：变量 newPolicy 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const newPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'new retryPolicy')
    /** 中文说明：变量 oldFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const oldFailure = new LlmError('old route failed', 'AUTH')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 disposeOld 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeOld = ctx.llm.registerAdapter(['route'], new class extends ThrowingAdapter {
      override providerRetryPolicy(): typeof oldPolicy {
        return oldPolicy
      }
    }(oldFailure))
    /** 中文说明：变量 prepared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })

    disposeOld()
    ctx.llm.registerAdapter(['route'], new class extends ScriptedAdapter {
      override providerRetryPolicy(): typeof newPolicy {
        return newPolicy
      }
    }(SCRIPT))

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'old route failed', code: 'AUTH' },
      },
    })
    expect(prepared.retryPolicy).toBe(oldPolicy)
    expect(ctx.llm.providerRetryPolicy('route')).toBe(newPolicy)
  })

  it('normalizes an unregistered provider to a terminal failure', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'nope',
      model: 'any-model',
      messages: [],
    }))

    /** 中文说明：变量 finish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const finish = chunks.at(-1)
    expect(finish).toMatchObject({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { code: 'NO_ADAPTER' },
      },
    })
    if (finish?.type !== 'finish' || finish.reason.kind !== 'error') throw new Error('expected error finish')
    expect(finish.reason.failure.message).toContain('no adapter registered')
  })

  it.each(['done', 'value'] as const)('normalizes a throwing IteratorResult.%s getter', async (field) => {
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = new LlmError(`${field} getter failed`, 'RESULT_GETTER_FAILED')
    /** 中文说明：变量 result 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const result = field === 'done' ? {} : { done: false }
    Object.defineProperty(result, field, { get: () => { throw original } })
    /** 中文说明：变量 cleanupLookups 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let cleanupLookups = 0
    /** 中文说明：变量 iterator 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const iterator: AsyncIterator<StreamChunk> = {
      next: () => Promise.resolve(result as unknown as IteratorResult<StreamChunk>),
    }
    Object.defineProperty(iterator, 'return', {
      get: () => {
        cleanupLookups += 1
        throw new Error('return getter must not run after iteration fails')
      },
    })
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return { [Symbol.asyncIterator]: () => iterator }
      }
    }()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], adapter)

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: `${field} getter failed`, code: 'RESULT_GETTER_FAILED' },
      },
    })
    expect(cleanupLookups).toBe(0)
  })

  it.each(['dispatch', 'iterator'] as const)('normalizes synchronous adapter %s failures', async (boundary) => {
    /** 中文说明：变量 original 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const original = new LlmError(`${boundary} failed`, 'BOUNDARY_FAILED')
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        if (boundary === 'dispatch') throw original
        return { [Symbol.asyncIterator]: () => { throw original } }
      }
    }()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], adapter)

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: `${boundary} failed`, code: 'BOUNDARY_FAILED' },
      },
    })
  })

  it('preserves structured LlmError facts in the terminal failure', async () => {
    /** 中文说明：变量 failure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const failure = new LlmError('provider busy', 'RATE_LIMIT', {
      status: 429,
      providerRetryAfterMs: 1_500,
      requestId: ProviderRequestId('req-7'),
    })
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], new ThrowingAdapter(failure))

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'provider busy',
          code: 'RATE_LIMIT',
          status: 429,
          providerRetryAfterMs: 1_500,
          requestId: ProviderRequestId('req-7'),
        },
      },
    })
  })

  it('normalizes arbitrary adapter rejections without throwing them downstream', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return {
              // Third-party adapters can reject with arbitrary values.
              // oxlint-disable-next-line typescript/prefer-promise-reject-errors
              next: () => Promise.reject('plain provider failure'),
            }
          },
        }
      }
    }()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], adapter)

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))

    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'plain provider failure', code: 'UNKNOWN' },
      },
    })
  })

  it('maps adapter failure to aborted when the request signal is aborted', async () => {
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    controller.abort('cancelled')
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], new ThrowingAdapter(new Error('stopped')))

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks = await collect(ctx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
      signal: controller.signal,
    }))

    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'stopped' } },
    })
  })

  it('leaves middleware and consumer failures thrown', async () => {
    /** 中文说明：变量 middlewareFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const middlewareFailure = new Error('middleware failed')
    /** 中文说明：变量 middlewareCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const middlewareCtx = new Context()
    await middlewareCtx.plugin(LlmRuntime)
    middlewareCtx.llm.registerAdapter(['test'], new ScriptedAdapter(SCRIPT))
    middlewareCtx.on('llm/stream', () => (async function* () {
      throw middlewareFailure
    })())
    await expect(collect(middlewareCtx.llm.stream({
      provider: 'test',
      model: 'test',
      messages: [],
    }))).rejects.toBe(middlewareFailure)

    /** 中文说明：变量 consumerFailure 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const consumerFailure = new Error('consumer failed')
    /** 中文说明：变量 consumerCtx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const consumerCtx = new Context()
    await consumerCtx.plugin(LlmRuntime)
    consumerCtx.llm.registerAdapter(['test'], new ScriptedAdapter(SCRIPT))
    await expect((async () => {
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for await (const _chunk of consumerCtx.llm.stream({
        provider: 'test',
        model: 'test',
        messages: [],
      })) {
        throw consumerFailure
      }
    })()).rejects.toBe(consumerFailure)
  })

  it('awaits adapter cleanup on downstream close and leaves cleanup failure thrown', async () => {
    /** 中文说明：变量 cleanup 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cleanup = new Error('cleanup failed')
    /** 中文说明：变量 cleanupCalls 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let cleanupCalls = 0
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return {
              next: () => Promise.resolve({ done: false, value: SCRIPT[0]! }),
              return: () => {
                cleanupCalls += 1
                return Promise.reject(cleanup)
              },
            }
          },
        }
      }
    }()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], adapter)

    await expect((async () => {
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for await (const _chunk of ctx.llm.stream({
        provider: 'test',
        model: 'test',
        messages: [],
      })) break
    })()).rejects.toBe(cleanup)
    expect(cleanupCalls).toBe(1)
  })

  it('allows downstream close when an adapter iterator has no return method', async () => {
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends LlmAdapter {
      stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
            return { next: () => Promise.resolve({ done: false, value: SCRIPT[0]! }) }
          },
        }
      }
    }()
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test'], adapter)

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({ provider: 'test', model: 'test', messages: [] })) break
  })

  it('unregisters adapters when the owning fiber is disposed (HMR safety)', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：函数值 fiber 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.llm.registerAdapter(['scoped-model'], new ScriptedAdapter(SCRIPT))
    }, { inject: ['llm'] }))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'scoped-model', name: 'scoped-model' }])

    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('discovers detached provider and advisory model metadata', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 provider 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const provider = { id: 'catalog', name: 'Catalog Provider' }
    const model = {
      provider: 'catalog',
      id: 'fast',
      name: 'Fast',
      description: 'Low latency',
      inputModalities: ['text'] as const,
    }
    ctx.llm.registerAdapter(['catalog'], new CatalogAdapter(provider, [model]))

    /** 中文说明：变量 providers 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const providers = ctx.llm.listProviders()
    /** 中文说明：变量 models 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const models = await ctx.llm.listModels('catalog')
    expect(providers).toEqual([provider])
    expect(models).toEqual([model])
    expect(models[0]!.inputModalities).not.toBe(model.inputModalities)

    providers[0]!.name = 'mutated'
    models[0]!.name = 'mutated'
    provider.name = 'source mutated'
    model.name = 'source mutated'
    expect(ctx.llm.listProviders()).toEqual([{ id: 'catalog', name: 'Catalog Provider' }])
    await expect(ctx.llm.listModels('catalog')).resolves.toEqual([{
      provider: 'catalog', id: 'fast', name: 'source mutated', description: 'Low latency', inputModalities: ['text'],
    }])
  })

  it('defaults adapters to their route name and an empty advisory model list', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['plain'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'plain', name: 'plain' }])
    await expect(ctx.llm.listModels('plain')).resolves.toEqual([])
    await expect(ctx.llm.listModels('missing')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(ctx.llm.resolveModelInfo('plain', 'unlisted')).resolves.toEqual({
      provider: 'plain', id: 'unlisted', name: 'unlisted',
    })
    await expect(ctx.llm.resolveModelInfo('missing', 'm')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })

  it.each([
    [{ provider: 1, id: 'model', name: 'Model' }, 'non-string provider'],
    [{ provider: 'other', id: 'model', name: 'Model' }, 'mismatched provider'],
    [{ provider: 'route', id: 1, name: 'Model' }, 'non-string id'],
    [{ provider: 'route', id: 'other', name: 'Model' }, 'mismatched id'],
    [{ provider: 'route', id: 'model', name: 1 }, 'non-string name'],
    [{ provider: 'route', id: 'model', name: '' }, 'empty name'],
    [{ provider: 'route', id: 'model', name: 'Model', description: 1 }, 'non-string description'],
  ] as const)('rejects invalid exact model metadata (%s: %s)', async (metadata, _label) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> {
        return Promise.resolve(metadata as unknown as LlmResolvedModelInfo)
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    await expect(ctx.llm.resolveModelInfo('route', 'model'))
      .rejects.toMatchObject({ code: 'INVALID_MODEL_INFO' })
  })

  it('preserves modality metadata through exact model resolution', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({
          provider: 'route', id: 'model', name: 'Model',
          inputModalities: ['text', 'image'],
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    // Downstream preflights (image admission) act on this exact field; a
    // rebuild that drops it silently reads as "modalities unknown".
    await expect(ctx.llm.resolveModelInfo('route', 'model')).resolves.toEqual({
      provider: 'route', id: 'model', name: 'Model',
      inputModalities: ['text', 'image'],
    })
  })

  it('resolves detached model context independently of advisory catalog membership', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = { contextWindow: 32_000 }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      { unlisted: source },
    ))

    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = await ctx.llm.resolveModelInfo('route', 'unlisted')
    expect(resolved.context).toEqual({ contextWindow: 32_000 })
    source.contextWindow = 64_000
    expect(resolved.context).toEqual({ contextWindow: 32_000 })
    await expect(ctx.llm.resolveModelInfo('route', 'other')).resolves.toEqual({
      provider: 'route', id: 'other', name: 'other',
    })
  })

  it('resolves detached adapter-owned reasoning metadata and materializes its default', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = {
      efforts: [
        { id: ReasoningEffortId('standard'), name: 'Standard' },
        { id: ReasoningEffortId('ultra'), name: 'Ultra', description: 'Largest budget' },
      ],
      defaultEffort: ReasoningEffortId('standard'),
    }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {
        model: source,
        providerDefault: {
          efforts: [{ id: ReasoningEffortId('standard'), name: 'Standard' }],
        },
      },
    ))

    /** 中文说明：变量 resolved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolved = await ctx.llm.resolveModelInfo('route', 'model')
    expect(resolved.reasoning).toEqual(source)
    source.efforts[0]!.name = 'mutated'
    expect(resolved.reasoning?.efforts[0]?.name).toBe('Standard')
    await expect(ctx.llm.resolveCallConfig({ provider: 'route', model: 'model' })).resolves.toEqual({
      provider: 'route',
      model: 'model',
      reasoningEffort: ReasoningEffortId('standard'),
    })
    /** 中文说明：变量 explicit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const explicit = { provider: 'route', model: 'model', reasoningEffort: ReasoningEffortId('ultra') }
    await expect(ctx.llm.resolveCallConfig(explicit)).resolves.toBe(explicit)
    /** 中文说明：变量 providerDefault 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const providerDefault = { provider: 'route', model: 'providerDefault' }
    await expect(ctx.llm.resolveCallConfig(providerDefault)).resolves.toBe(providerDefault)
  })

  it('materializes an adapter-owned maxTokens default while preserving an explicit cap', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {},
      { model: 256_000 },
    ))

    await expect(ctx.llm.resolveModelInfo('route', 'model')).resolves.toMatchObject({
      defaultMaxTokens: 256_000,
    })
    await expect(ctx.llm.resolveCallConfig({ provider: 'route', model: 'model' })).resolves.toEqual({
      provider: 'route',
      model: 'model',
      maxTokens: 256_000,
    })
    /** 中文说明：变量 preparedDefault 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparedDefault = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    expect(preparedDefault.adapterDefaults).toEqual({ maxTokens: true })
    /** 中文说明：变量 explicit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const explicit = { provider: 'route', model: 'model', maxTokens: 8_192 }
    await expect(ctx.llm.resolveCallConfig(explicit)).resolves.toBe(explicit)
    /** 中文说明：变量 preparedExplicit 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const preparedExplicit = await ctx.llm.prepareCall(explicit)
    expect(preparedExplicit.adapterDefaults).toEqual({})
  })

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid adapter-owned default maxTokens %s',
    async (defaultMaxTokens) => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const adapter = new class extends ScriptedAdapter {
        override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
          return Promise.resolve({ provider, id: model, name: model, defaultMaxTokens })
        }
      }(SCRIPT)
      ctx.llm.registerAdapter(['route'], adapter)

      await expect(ctx.llm.resolveModelInfo('route', 'model'))
        .rejects.toMatchObject({ code: 'INVALID_MODEL_MAX_TOKENS' })
    },
  )

  it.each([
    [{ efforts: [] }, 'empty effort list'],
    [{ efforts: [{ id: '', name: 'Empty' }] }, 'empty id'],
    [{ efforts: [{ id: 'valid', name: '' }] }, 'empty name'],
    [{ efforts: [{ id: 'valid', name: 'Valid', description: 1 }] }, 'non-string description'],
    [{ efforts: [{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }] }, 'duplicate id'],
    [{ efforts: [{ id: 'valid', name: 'Valid' }], defaultEffort: 'other' }, 'unknown default'],
  ] as const)('rejects invalid model reasoning metadata (%s: %s)', async (metadata, _label) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      { model: metadata as unknown as LlmModelReasoningInfo },
    ))
    await expect(ctx.llm.resolveModelInfo('route', 'model'))
      .rejects.toMatchObject({ code: 'INVALID_MODEL_REASONING' })
  })

  it('rejects unsupported reasoning efforts without clamping', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      { model: { efforts: [{ id: ReasoningEffortId('ultra'), name: 'Ultra' }] } },
    ))

    await expect(ctx.llm.resolveCallConfig({
      provider: 'route',
      model: 'model',
      reasoningEffort: ReasoningEffortId('standard'),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
    await expect(ctx.llm.resolveCallConfig({
      provider: 'route',
      model: 'plain',
      reasoningEffort: ReasoningEffortId('standard'),
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('resolves reasoning defaults at the final adapter boundary after routing middleware', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends RecordingAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        /** 中文说明：变量 reasoning 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const reasoning: LlmModelReasoningInfo = {
          efforts: [{ id: ReasoningEffortId('standard'), name: 'Standard' }],
          defaultEffort: ReasoningEffortId('standard'),
        }
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          reasoning,
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['routed'], adapter)
    /** 中文说明：函数值 disposeRouting 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const disposeRouting = ctx.on('llm/stream', (options, next) => {
      options.provider = 'routed'
      return next()
    })

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({
      provider: 'initial',
      model: 'model',
      messages: [],
    })) { /* drain */ }

    expect(adapter.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('standard'))
    disposeRouting()

    /** 中文说明：变量 frozenRequest 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frozenRequest: GenerateOptions = Object.freeze({
      provider: 'routed',
      model: 'model',
      messages: [],
    })
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream(frozenRequest)) { /* drain */ }
    expect(adapter.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('standard'))
    expect(Object.isFrozen(adapter.lastOptions)).toBe(true)
  })

  it('pins one adapter registration across asynchronous exact-model resolution and dispatch', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 reasoning 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reasoning = Promise.withResolvers<LlmModelReasoningInfo>()
    /** 中文说明：变量 first 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const first = new class extends RecordingAdapter {
      override async resolveModel(
        provider: string,
        model: string,
        _signal?: AbortSignal,
      ): Promise<LlmResolvedModelInfo> {
        started.resolve(undefined)
        return {
          provider,
          id: model,
          name: model,
          reasoning: await reasoning.promise,
        }
      }
    }(SCRIPT)
    /** 中文说明：变量 disposeFirst 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeFirst = ctx.llm.registerAdapter(['route'], first)
    /** 中文说明：函数值 draining 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const draining = (async () => {
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for await (const _chunk of ctx.llm.stream({
        provider: 'route',
        model: 'model',
        messages: [],
      })) { /* drain */ }
    })()

    await started.promise
    disposeFirst()
    /** 中文说明：变量 second 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const second = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['route'], second)
    reasoning.resolve({
      efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
      defaultEffort: ReasoningEffortId('high'),
    })
    await draining

    expect(first.lastOptions?.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(second.lastOptions).toBeUndefined()
  })

  it('prepares a one-shot registration-bound call and rejects config drift', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [],
      {},
      {
        model: {
          efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
          defaultEffort: ReasoningEffortId('high'),
        },
      },
    )
    ctx.llm.registerAdapter(['route'], adapter)
    /** 中文说明：变量 prepared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    expect(Object.isFrozen(prepared.config)).toBe(true)
    expect(Object.isFrozen(prepared.adapterDefaults)).toBe(true)
    expect(prepared.adapterDefaults).toEqual({ reasoningEffort: true })
    expect(() => prepared.stream({
      ...prepared.config,
      model: 'other',
      messages: [],
    })).toThrow(expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }))
    await collect(prepared.stream({
      ...prepared.config,
      messages: [],
    }))
    expect(() => prepared.stream({
      ...prepared.config,
      messages: [],
    })).toThrow(expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }))

    /** 中文说明：变量 late 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const late = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    /** 中文说明：变量 lateOptions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lateOptions = { ...late.config, messages: [] }
    /** 中文说明：变量 lateStream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const lateStream = late.stream(lateOptions)
    lateOptions.model = 'other'
    expect(await collect(lateStream)).toContainEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'prepared LLM call config changed before adapter dispatch',
          code: 'INVALID_PREPARED_CALL',
        },
      },
    })
  })

  it('reuses one exact-model lookup for prepared config and context metadata', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 resolutions 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let resolutions = 0
    /** 中文说明：变量 source 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const source = { contextWindow: 128_000 }
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        resolutions += 1
        return Promise.resolve({
          provider,
          id: model,
          name: model,
          description: 'Resolved model',
          context: source,
          reasoning: model === 'no-default'
            ? { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] }
            : {
              efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
              defaultEffort: ReasoningEffortId('high'),
            },
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    /** 中文说明：变量 prepared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    source.contextWindow = 64_000
    expect(prepared.config.reasoningEffort).toBe(ReasoningEffortId('high'))
    expect(prepared.context).toEqual({ contextWindow: 128_000 })
    expect(Object.isFrozen(prepared.context)).toBe(true)
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of prepared.stream({
      ...prepared.config,
      messages: [],
    })) { /* drain */ }
    expect(resolutions).toBe(1)

    /** 中文说明：变量 noDefault 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const noDefault = await ctx.llm.prepareCall({ provider: 'route', model: 'no-default' })
    expect(noDefault.config).toEqual({ provider: 'route', model: 'no-default' })
    expect(noDefault.context).toEqual({ contextWindow: 64_000 })
    expect(resolutions).toBe(2)
  })

  it('binds adapter-owned capabilities and dispatch to one prepared generation', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 generation 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let generation = 'first'
    /** 中文说明：变量 dispatched 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let dispatched: string | undefined
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override prepareCall(provider: string, model: string) {
        /** 中文说明：变量 captured 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const captured = generation
        return Promise.resolve({
          model: { provider, id: model, name: model, inputModalities: ['text'] as const },
          stream: (options: GenerateOptions) => {
            dispatched = captured
            return super.stream(options)
          },
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)

    /** 中文说明：变量 prepared 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prepared = await ctx.llm.prepareCall({ provider: 'route', model: 'model' })
    generation = 'second'
    expect(prepared.inputModalities).toEqual(['text'])
    expect(Object.isFrozen(prepared.inputModalities)).toBe(true)
    await collect(prepared.stream({ ...prepared.config, messages: [] }))
    expect(dispatched).toBe('first')
  })

  it('projects historical images to stable text only after the loop-visible waterfall', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: GenerateOptions[] = []
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
      }

      override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        seen.push(options)
        yield * super.stream(options)
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    /** 中文说明：变量 attachment 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const attachment = {
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
      mediaType: 'image/png' as const,
      bytes: 3,
      width: 1,
      height: 1,
    }
    /** 中文说明：变量 waterfall 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const waterfall: GenerateOptions[] = []
    ctx.on('llm/stream', async function* (options, next) {
      waterfall.push(options)
      yield * next()
    })

    await collect(ctx.llm.stream({
      provider: 'route',
      model: 'text-only',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))

    expect(waterfall[0]?.messages[0]?.content).toEqual([{ type: 'image', attachment }])
    expect(seen[0]?.messages[0]?.content).toEqual([{
      type: 'text',
      text: '[image omitted because this model accepts text only; attachment sha256:aaaaaaaa]',
    }])

    /** 中文说明：变量 frozen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const frozen = Object.freeze({
      provider: 'route',
      model: 'text-only',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment }],
        source: { kind: 'plugin' as const, plugin: 'test' },
      })],
    })
    await collect(ctx.llm.stream(frozen))
    expect(Object.isFrozen(seen[1])).toBe(true)
    expect(Object.isFrozen(seen[1]?.messages)).toBe(true)
  })

  it('passes cancellation through exact-model resolution', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 started 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const started = Promise.withResolvers<undefined>()
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new class extends ScriptedAdapter {
      override resolveModel(
        _provider: string,
        _model: string,
        signal?: AbortSignal,
      ): Promise<LlmResolvedModelInfo> {
        started.resolve(undefined)
        return new Promise<LlmResolvedModelInfo>((_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error('missing reasoning signal'))
            return
          }
          if (signal.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error('reasoning aborted'))
            return
          }
          signal.addEventListener('abort', () => {
            reject(signal.reason instanceof Error ? signal.reason : new Error('reasoning aborted'))
          }, { once: true })
        })
      }
    }(SCRIPT)
    ctx.llm.registerAdapter(['route'], adapter)
    /** 中文说明：变量 controller 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const controller = new AbortController()
    /** 中文说明：变量 resolving 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const resolving = ctx.llm.resolveCallConfig(
      { provider: 'route', model: 'model' },
      controller.signal,
    )

    await started.promise
    /** 中文说明：变量 reason 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reason = new Error('cancel reasoning')
    controller.abort(reason)
    await expect(resolving).rejects.toBe(reason)
  })

  it.each([0, -1, 1.5, Number.NaN])(
    'rejects invalid adapter model context %s',
    async (contextWindow) => {
      /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      ctx.llm.registerAdapter(['route'], new CatalogAdapter(
        { id: 'route', name: 'Route' },
        [],
        { model: { contextWindow } },
      ))
      await expect(ctx.llm.resolveModelInfo('route', 'model'))
        .rejects.toMatchObject({ code: 'INVALID_MODEL_CONTEXT' })
    },
  )

  it.each([
    [{ id: 1, name: 'Name' }, 'non-string id'],
    [{ id: 'other', name: 'Name' }, 'mismatched id'],
    [{ id: 'route', name: 1 }, 'non-string name'],
    [{ id: 'route', name: '' }, 'empty name'],
  ] as const)('rejects invalid provider metadata atomically (%s: %s)', async (metadata, _label) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new CatalogAdapter(metadata as unknown as LlmProviderInfo, [])
    expect(() => ctx.llm.registerAdapter(['route'], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it.each([
    [{ provider: 1, id: 'm', name: 'M' }, 'non-string provider'],
    [{ provider: 'other', id: 'm', name: 'M' }, 'mismatched provider'],
    [{ provider: 'route', id: 1, name: 'M' }, 'non-string id'],
    [{ provider: 'route', id: '', name: 'M' }, 'empty id'],
    [{ provider: 'route', id: 'm', name: 1 }, 'non-string name'],
    [{ provider: 'route', id: 'm', name: '' }, 'empty name'],
    [{ provider: 'route', id: 'm', name: 'M', description: 1 }, 'non-string description'],
  ] as const)('rejects invalid model metadata (%s: %s)', async (metadata, _label) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['route'], new CatalogAdapter(
      { id: 'route', name: 'Route' },
      [metadata as unknown as LlmModelInfo],
    ))
    await expect(ctx.llm.listModels('route')).rejects.toMatchObject({ code: 'INVALID_CATALOG' })
  })

  it('rejects duplicate model ids in one provider catalog', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 model 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const model = { provider: 'route', id: 'same', name: 'Same' }
    ctx.llm.registerAdapter(['route'], new CatalogAdapter({ id: 'route', name: 'Route' }, [model, model]))
    await expect(ctx.llm.listModels('route')).rejects.toMatchObject({ code: 'INVALID_CATALOG' })
  })

  it('lets llm/stream waterfall listeners wrap the underlying stream', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test-model'], new ScriptedAdapter(SCRIPT))

    ctx.on('llm/stream', function (_options, next) {
      /** 中文说明：变量 inner 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const inner = next()
      return (async function * () {
        yield { type: 'block-start', index: 99, blockType: 'text' } satisfies StreamChunk
        yield { type: 'block-end', index: 99, block: { type: 'text', text: '' } } satisfies StreamChunk
        yield * inner
      })()
    })

    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: StreamChunk[] = []
    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const chunk of ctx.llm.stream({ provider: 'test-model', model: 'dynamic-model', messages: [] })) chunks.push(chunk)
    expect(chunks).toHaveLength(6)
    expect(chunks[0]).toMatchObject({ index: 99 })
  })

  it('resolves the provider after llm/stream listeners have had a chance to route it', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['routed'], adapter)
    ctx.on('llm/stream', (options, next) => {
      options.provider = 'routed'
      return next()
    })

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({ provider: 'initial', model: 'm', messages: [] })) { /* drain */ }
    expect(adapter.lastOptions?.provider).toBe('routed')
  })

  it('keeps replay state when historical and target providers belong to the same adapter instance', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['historical', 'target'], adapter)
    /** 中文说明：变量 replayState 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const replayState = { private: 'state' }

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({
      provider: 'target',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'old response' }],
        source: {
          kind: 'model',
          ...{ provider: 'historical', model: 'old-model', replayState },
        },
      })],
    })) { /* drain */ }

    expect(adapter.lastOptions?.messages[0]?.source).toEqual({
      kind: 'model', provider: 'historical', model: 'old-model', replayState,
    })
  })

  it('strips replay state but preserves provider and model when the target uses a different adapter instance', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['historical'], new RecordingAdapter(SCRIPT))
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['target'], target)

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream({
      provider: 'target',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'old response' }],
        source: {
          kind: 'model',
          ...{ provider: 'historical', model: 'old-model', replayState: { private: 'state' } },
        },
      })],
    })) { /* drain */ }

    expect(target.lastOptions?.messages[0]?.source).toEqual({
      kind: 'model',
      provider: 'historical',
      model: 'old-model',
    })
  })

  it('preserves immutability while stripping replay state from frozen requests', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['historical'], new RecordingAdapter(SCRIPT))
    /** 中文说明：变量 target 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const target = new RecordingAdapter(SCRIPT)
    ctx.llm.registerAdapter(['target'], target)
    /** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const options = Object.freeze({
      provider: 'target',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'old response' }],
        source: {
          kind: 'model',
          provider: 'historical',
          model: 'old-model',
          replayState: { private: 'state' },
        },
      })],
    })

    /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
    for await (const _chunk of ctx.llm.stream(options)) { /* drain */ }

    expect(target.lastOptions).not.toBe(options)
    expect(Object.isFrozen(target.lastOptions)).toBe(true)
    expect(target.lastOptions?.messages[0]?.source).toEqual({
      kind: 'model',
      provider: 'historical',
      model: 'old-model',
    })
  })

  it('creates LlmError with a code for programmatic handling', () => {
    /** 中文说明：变量 err 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const err = new LlmError('something went wrong', 'CUSTOM_CODE')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('LlmError')
    expect(err.message).toBe('something went wrong')
    expect(err.code).toBe('CUSTOM_CODE')
  })

  it('rejects non-serializable structured failure facts at construction', () => {
    expect(() => new LlmError('busy', 'RATE_LIMIT', { status: 42 })).toThrow(/status/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { providerRetryAfterMs: Number.NaN }))
      .toThrow(/providerRetryAfterMs/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { requestId: ProviderRequestId('') })).toThrow(/requestId/)
    expect(() => new LlmError(1 as never, 'RATE_LIMIT')).toThrow(/message/)
    expect(() => new LlmError('busy', 1 as never)).toThrow(/code/)
    expect(() => new LlmError('busy', 'RATE_LIMIT', { requestId: 1 as never })).toThrow(/requestId/)
  })

  it('LlmError extends the shared HarnessError base', async () => {
    const { HarnessError, isHarnessError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：变量 cause 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const cause = new Error('root cause')
    /** 中文说明：变量 err 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const err = new LlmError('boom', 'AUTH', { cause })
    expect(err).toBeInstanceOf(HarnessError)
    expect(isHarnessError(err)).toBe(true)
    expect(err.code).toBe('AUTH')
    expect(err.cause).toBe(cause)
  })

  it('HarnessError carries a code, names itself by subclass, and chains cause', async () => {
    const { HarnessError, isHarnessError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：变量 root 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const root = new Error('root cause')
    /** 中文说明：变量 err 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const err = new HarnessError('wrapper', 'UNKNOWN', { cause: root })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HarnessError')
    expect(err.code).toBe('UNKNOWN')
    expect(err.cause).toBe(root)
    expect(isHarnessError(err)).toBe(true)
    expect(isHarnessError(root)).toBe(false)
    expect(isHarnessError('nope')).toBe(false)
  })

  it('removes the adapter when the returned disposer is called', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
    dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('rejects duplicate adapter registration with DUPLICATE_ADAPTER code', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    try {
      ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
      expect.fail('expected error')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(LlmError)
      expect((error as LlmError).message).toContain('already registered')
      expect((error as LlmError).code).toBe('DUPLICATE_ADAPTER')
    }
  })

  it('rejects empty and internally duplicated provider registrations atomically', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 adapter 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const adapter = new ScriptedAdapter(SCRIPT)

    expect(() => ctx.llm.registerAdapter([], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(() => ctx.llm.registerAdapter([''], adapter)).toThrow(expect.objectContaining({ code: 'INVALID_ADAPTER' }))
    expect(() => ctx.llm.registerAdapter(['first', 'first'], adapter)).toThrow(expect.objectContaining({ code: 'DUPLICATE_ADAPTER' }))
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('re-registers a model after its prior registration is disposed', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
    dispose()
    expect(ctx.llm.listProviders()).toEqual([])

    // The duplicate check is not wedged: the same model registers cleanly again.
    /** 中文说明：变量 disposeAgain 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const disposeAgain = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm1', name: 'm1' }])
    disposeAgain()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('refuses to replace routes on a registration that was already released', async () => {
    // The leak this prevents: the effect's disposer has run, so a route added
    // afterwards would sit in the registry with nothing left to release it.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    handle()
    expect(() => { handle.replace(['leaked']) })
      .toThrow(/disposed adapter registration cannot replace its routes/)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('still allows an empty route set on a live registration', async () => {
    // `replace([])` is the settings-section-emptied case: legal, and it must
    // not be mistaken for disposal by the guard above.
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = ctx.llm.registerAdapter(['m1'], new ScriptedAdapter(SCRIPT))
    handle.replace([])
    expect(ctx.llm.listProviders()).toEqual([])
    handle.replace(['m2'])
    expect(ctx.llm.listProviders()).toEqual([{ id: 'm2', name: 'm2' }])
    handle()
    expect(ctx.llm.listProviders()).toEqual([])
  })
})
