/**
 * 文件职责：验证工具注册与执行的 tools.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, CallId, HarnessError, type ContentBlock  } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ToolRuntime, {
  defineContentToolFixture, defineTool, JsonSchemaError, parameterSchemaSpecToJsonSchema, validateArgs, ToolArgsError, ToolNotFoundError,
  TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH,
  /** 中文说明：类型或类 InferArgs 约束服务或测试数据职责。 */
  type InferArgs, type JsonValue, type ParameterSchemaSpec, type PreToolDecision, type PostToolDecision,
  /** 中文说明：类型或类 JsonSchemaNode 约束服务或测试数据职责。 */
  type JsonSchemaNode, type ToolDefinition, type ToolDispatchExecution, type ToolExecutionResult, type ToolExecutionToken,
} from '@deepseek-ai/dsh-tools'

/** 中文说明：测试局部值 testToolSignal，由紧邻初始化决定。 */
const testToolSignal = new AbortController().signal

/** 中文说明：函数 setup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function setup() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** 中文说明：测试局部值 echoTool，由紧邻初始化决定。 */
const echoTool = defineTool({
  name: 'echo',
  description: 'echo arguments back',
  parameters: { text: { type: 'string' } },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) {
    return args.text ?? ''
  },
})

describe('ToolRuntime', () => {
  it('registers tools, exposes schemas, and feeds the system-prompt assembly', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    expect(ctx.tools.schemas()).toEqual([{
      name: 'echo',
      description: 'echo arguments back',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
    }])
    // schemas() result must not leak execute — ToolSchema deliberately has no
    // 'execute' key, so widen through unknown to probe for the absent property
    expect((ctx.tools.schemas()[0] as unknown as Record<string, unknown>).execute).toBeUndefined()

    /** 中文说明：测试局部值 assembly，由紧邻初始化决定。 */
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(t => t.name)).toEqual(['echo'])
  })

  it('schemas() drops host callbacks — they must never reach the model', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    // Tool definitions contain output, finalization, execution, and presentation
    // callbacks. schemas() is an explicit allowlist so none can reach the model.
    ctx.tools.register(defineContentToolFixture({
      name: 'present',
      description: 'has presenters',
      parameters: { x: { type: 'string', required: true } },
      async execute() { return [] },
      finalizeContent: (_exec, result) => result.content,
      presentCall: args => ({ card: 'generic', title: args.x }),
      presentResult: (args, result) => ({ card: 'generic', title: args.x, content: result.content }),
    }))
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = ctx.tools.schemas()[0] as unknown as Record<string, unknown>
    expect(Object.keys(schema).sort()).toEqual(['description', 'name', 'parameters'])
    expect(schema.finalizeContent).toBeUndefined()
    expect(schema.presentCall).toBeUndefined()
    expect(schema.presentResult).toBeUndefined()
    expect(schema.execute).toBeUndefined()
  })

  it('schemas() excludes timeoutMs — the budget must never reach the model', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'budgeted', description: 'has a budget', parameters: {}, timeoutMs: 5_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = ctx.tools.schemas().find(s => s.name === 'budgeted')
    expect(schema).toBeDefined()
    expect('timeoutMs' in (schema as object)).toBe(false)
  })

  it('executes a tool and returns its content', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observed: ToolExecutionResult | undefined
    ctx.on('tools/result', (_exec, result) => { observed = result })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false, value: 'hi' })
    expect(observed).toEqual(result)
  })

  it('projects presentation metadata from the canonical value', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'meta-tool',
      output: {
        ...echoTool.output,
        presentationMeta: () => ({ diffs: [{ path: 'a', oldText: null, newText: 'x' }] }),
      },
      async execute() {
        return 'ok'
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'meta-tool', arguments: {} })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      meta: { diffs: [{ path: 'a', oldText: null, newText: 'x' }] },
      value: 'ok',
    })
  })

  it('omits meta when no presentation projector is declared', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'no-meta-tool',
      async execute() {
        return 'ok'
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'no-meta-tool', arguments: {} })
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false, value: 'ok' })
    expect('meta' in result).toBe(false)
  })

  it('normalizes a contract-violating non-cloneable result before final notification', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedError: boolean | undefined
    ctx.on('tools/result', (_exec, result) => { observedError = result.isError })
    ctx.tools.register({
      ...echoTool,
      name: 'bad-meta',
      output: {
        ...echoTool.output,
        presentationMeta: () => (() => undefined) as unknown as JsonValue,
      },
      async execute() {
        return 'ok'
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('bad-meta'), name: 'bad-meta', arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type === 'text' && result.content[0].text).toContain('Error:')
    expect(result.error).toMatchObject({ info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' } })
    expect(observedError).toBe(true)
  })

  it('finalizes errors discovered while snapshotting non-content result fields', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 finalizeCalls，由紧邻初始化决定。 */
    let finalizeCalls = 0
    ctx.tools.register({
      ...echoTool,
      name: 'throwing-meta',
      output: {
        ...echoTool.output,
        presentationMeta() {
          /** 中文说明：测试局部值 meta，由紧邻初始化决定。 */
          const meta = {}
          Object.defineProperty(meta, 'value', {
            enumerable: true,
            get() { throw new Error('snapshot failed: '.repeat(100)) },
          })
          return meta
        },
      },
      finalizeContent(_exec, result) {
        finalizeCalls += 1
        /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
        const block = result.content[0]
        if (block?.type !== 'text') return undefined
        return [{ type: 'text', text: block.text.slice(0, 32) }]
      },
      async execute() {
        return 'body'
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('throwing-meta'), name: 'throwing-meta', arguments: {},
    })

    expect(result.isError).toBe(true)
    /** 中文说明：测试局部值 block，由紧邻初始化决定。 */
    const block = result.content[0]
    expect(block?.type).toBe('text')
    expect(block?.type === 'text' ? block.text : '').toMatch(/^Error: tool "throwing-meta"/)
    expect(block?.type === 'text' ? block.text : '').toHaveLength(32)
    expect(finalizeCalls).toBe(1)
  })

  it('normalizes a throwing final content callback without invoking it again', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 finalizeCalls，由紧邻初始化决定。 */
    let finalizeCalls = 0
    ctx.tools.register({
      ...echoTool,
      name: 'throwing-finalizer',
      finalizeContent() {
        finalizeCalls += 1
        throw new Error('finalizer violated its total contract')
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('throwing-finalizer'), name: 'throwing-finalizer', arguments: {},
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: finalizer violated its total contract' }],
      isError: true,
      error: { message: 'finalizer violated its total contract' },
    })
    expect(finalizeCalls).toBe(1)
  })

  it('requires every raw registration to declare its canonical output', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 missingOutput，由紧邻初始化决定。 */
    const missingOutput = {
      name: 'legacy-content-tool',
      description: 'missing output',
      parameters: {},
      execute: async () => [{ type: 'text', text: 'legacy' }],
    } as unknown as ToolDefinition

    expect(() => ctx.tools.register(missingOutput))
      .toThrow('must declare output { schema, render, presentationMeta? }')
  })

  it('rejects lossy and schema-mismatched body values before post-execute', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'lossy-output',
      description: 'lossy',
      parameters: {},
      output: { schema: { type: 'json' }, render: () => [] },
      execute: async () => (() => undefined) as unknown as JsonValue,
    }))
    ctx.tools.register(defineTool({
      name: 'wrong-output',
      description: 'wrong schema',
      parameters: {},
      output: { schema: { type: 'string' }, render: () => [] },
      execute: async () => 42 as unknown as string,
    }))

    /** 中文说明：测试局部值 lossy，由紧邻初始化决定。 */
    const lossy = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('lossy'), name: 'lossy-output', arguments: {} })
    /** 中文说明：测试局部值 mismatch，由紧邻初始化决定。 */
    const mismatch = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('mismatch'), name: 'wrong-output', arguments: {} })
    expect(lossy.error).toMatchObject({ info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' } })
    expect(lossy.content[0]?.type === 'text' ? lossy.content[0].text : '').toContain('not lossless JSON')
    expect(mismatch.error).toMatchObject({ info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' } })
    expect(mismatch.content[0]?.type === 'text' ? mismatch.content[0].text : '').toContain('"value" must be a string')
  })

  it('classifies a throwing body snapshot as invalid tool output', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 hostile，由紧邻初始化决定。 */
    const hostile = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw new Error('body snapshot getter exploded') },
    })
    ctx.tools.register(defineTool({
      name: 'hostile-body',
      description: 'hostile body',
      parameters: {},
      output: { schema: { type: 'json' }, render: () => [] },
      execute: async () => hostile as JsonValue,
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('hostile-body'), name: 'hostile-body', arguments: {},
    })
    expect(result.error?.message).toContain('value snapshot failed: body snapshot getter exploded')
    expect(result.error?.info).toEqual({ name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' })
  })

  it.each(['render', 'presentationMeta'] as const)('contains a throwing output.%s projector as one failed call', async (projector) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: `throwing-${projector}`,
      description: projector,
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => {
          if (projector === 'render') throw new Error('renderer exploded')
          return [{ type: 'text', text: 'ok' }]
        },
        presentationMeta: () => {
          if (projector === 'presentationMeta') throw new Error('metadata exploded')
          return null
        },
      },
      execute: async () => 'ok',
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId(projector), name: `throwing-${projector}`, arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.error?.message)
      .toContain(projector === 'render' ? 'renderer exploded' : 'metadata exploded')
    expect(result.error?.info).toEqual({ name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' })
    expect('value' in result).toBe(false)
  })

  it.each(['render', 'presentationMeta'] as const)('contains a throwing output.%s snapshot as one failed call', async (projector) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 hostile，由紧邻初始化决定。 */
    const hostile = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw new Error('snapshot getter exploded') },
    })
    ctx.tools.register(defineTool({
      name: `hostile-${projector}`,
      description: projector,
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => projector === 'render'
          ? hostile as unknown as ContentBlock[]
          : [{ type: 'text', text: 'ok' }],
        presentationMeta: () => projector === 'presentationMeta'
          ? hostile as unknown as JsonValue
          : null,
      },
      execute: async () => 'ok',
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId(`hostile-${projector}`), name: `hostile-${projector}`, arguments: {},
    })
    expect(result.error?.message).toContain('snapshot getter exploded')
    expect(result.error?.info).toEqual({ name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' })
  })

  it('keeps value/meta through content replacement and recomputes both projections after value replacement', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'projected',
      description: 'projected',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: `render:${value.text}` }],
        presentationMeta: (_args, value) => ({ projected: value.text }),
      },
      execute: async () => ({ text: 'body' }),
    }))
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    let replacement: 'content' | 'value' = 'content'
    ctx.on('tools/post-execute', async () => {
      if (replacement === 'content') {
        return { kind: 'accept', content: [{ type: 'text', text: 'policy content' }] }
      }
      return {
        kind: 'accept',
        value: { text: 'policy value' },
        additionalContexts: [createUserMessage({
          content: [{ type: 'text', text: 'value context' }], source: { kind: 'plugin', plugin: 'test' },
        })],
      }
    })

    /** 中文说明：测试局部值 content，由紧邻初始化决定。 */
    const content = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('content'), name: 'projected', arguments: {} })
    replacement = 'value'
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('value'), name: 'projected', arguments: {} })

    expect(content).toEqual({
      isError: false,
      value: { text: 'body' },
      content: [{ type: 'text', text: 'policy content' }],
      meta: { projected: 'body' },
    })
    expect(value).toEqual({
      isError: false,
      value: { text: 'policy value' },
      content: [{ type: 'text', text: 'render:policy value' }],
      meta: { projected: 'policy value' },
      additionalContexts: [{
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'value context' }],
        source: { kind: 'plugin', plugin: 'test' },
      }],
    })
  })

  it('fails a post-execute decision that replaces both projections or supplies an invalid value', async () => {
    /** 中文说明：测试局部值 both，由紧邻初始化决定。 */
    const both = await setup()
    both.tools.register(echoTool)
    both.on('tools/post-execute', async () => ({
      kind: 'accept',
      value: 'replacement',
      content: [{ type: 'text', text: 'also replacement' }],
    } as unknown as PostToolDecision))
    /** 中文说明：测试局部值 bothResult，由紧邻初始化决定。 */
    const bothResult = await both.tools.execute({ signal: testToolSignal, callId: CallId('both'), name: 'echo', arguments: {} })
    expect(bothResult).toMatchObject({
      isError: true,
      error: { message: 'tools/post-execute accept decision cannot replace both value and content' },
    })

    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = await setup()
    invalid.tools.register(echoTool)
    invalid.on('tools/post-execute', async () => ({ kind: 'accept', value: 1 }))
    /** 中文说明：测试局部值 invalidResult，由紧邻初始化决定。 */
    const invalidResult = await invalid.tools.execute({ signal: testToolSignal, callId: CallId('invalid'), name: 'echo', arguments: {} })
    expect(invalidResult.error).toMatchObject({ info: { code: 'INVALID_TOOL_OUTPUT' } })
    expect('value' in invalidResult).toBe(false)
  })

  it('turns a post-execute block into a valueless failure', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => ({
      kind: 'block',
      feedback: [{ type: 'text', text: 'blocked by policy' }],
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('block'), name: 'echo', arguments: { text: 'secret' } })
    expect(result).toEqual({
      isError: true,
      error: { message: 'blocked by policy' },
      content: [{ type: 'text', text: 'blocked by policy' }],
    })
    expect('value' in result).toBe(false)
  })

  it('replaces a canonical value without manufacturing additional context', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: 'replacement' }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('replace-value'), name: 'echo', arguments: {} })
    expect(result).toEqual({
      isError: false,
      value: 'replacement',
      content: [{ type: 'text', text: 'replacement' }],
    })
  })

  it.each([
    [[], 'tool result blocked by post-execute policy'],
    [[{ type: 'reasoning', text: 'private rationale' }], '[reasoning content]'],
  ] as const)('derives a stable failure message from non-text or empty block feedback', async (feedback, message) => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [...feedback] }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('block-message'), name: 'echo', arguments: {} })
    expect(result.error?.message).toBe(message)
  })

  it('contains a non-JSON post-execute failure projection as a safe final error', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => ({
      kind: 'block',
      feedback: [{ type: 'text', text: 'blocked', invalid: () => undefined } as never],
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('invalid-block'), name: 'echo', arguments: {} })
    expect(result).toMatchObject({
      isError: true,
      error: { message: 'tool result must be losslessly JSON-serializable' },
    })
  })

  it('rejects value replacement on a failed dispatch', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'throw-before-replace',
      async execute() { throw new Error('body failed') },
    })
    ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: 'replacement' }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('failed-replace'), name: 'throw-before-replace', arguments: {},
    })
    expect(result.error?.message).toBe('tools/post-execute cannot replace the value of a failed result')
  })

  it('fails value replacement when the owning tool disappears before post-policy resolves', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => {
      dispose()
      return { kind: 'accept', value: 'replacement' }
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('post-disposed'), name: 'echo', arguments: {} })
    expect(result.error).toEqual({
      message: 'unknown tool "echo"',
      info: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' },
    })
  })

  it('normalizes wrapper-authored failure metadata and contexts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/execute', async () => ({
      isError: true,
      error: { message: 'wrapped failure' },
      content: [{ type: 'text', text: 'wrapper content' }],
      meta: { wrapped: true },
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'wrapper context' }], source: { kind: 'plugin', plugin: 'test' },
      })],
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('wrapper-failure'), name: 'echo', arguments: {} })
    expect(result).toEqual({
      isError: true,
      error: { message: 'wrapped failure' },
      content: [{ type: 'text', text: 'wrapper content' }],
      meta: { wrapped: true },
      additionalContexts: [{
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: 'wrapper context' }],
        source: { kind: 'plugin', plugin: 'test' },
      }],
    })
  })

  it('fails wrapper-authored success normalization when the owning tool disappears', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.tools.register(echoTool)
    ctx.on('tools/execute', async () => {
      dispose()
      return { isError: false, value: 'replacement', content: [] }
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('wrapper-disposed'), name: 'echo', arguments: {} })
    expect(result.error).toEqual({
      message: 'unknown tool "echo"',
      info: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' },
    })
  })

  it('suppresses presentation metadata only for nested composite dispatches', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'meta-suppression',
      output: { ...echoTool.output, presentationMeta: () => ({ card: true }) },
    })
    /** 中文说明：测试局部值 direct，由紧邻初始化决定。 */
    const direct = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('direct'), name: 'meta-suppression', arguments: {} })
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    const nested = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('nested'),
      name: 'meta-suppression',
      arguments: {},
      parent: Symbol('outer') as ToolExecutionToken,
    })
    expect(direct.meta).toEqual({ card: true })
    expect(nested.meta).toBeUndefined()
    expect(nested.isError ? undefined : nested.value).toBe('')
  })

  it('carries a nested conclusion on the nested result for its composite to forward', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'terminal-nested',
      async execute(_args, exec) {
        exec.concludeTurn()
        return 'terminal'
      },
    })
    // A composite that forwards the marker from the nested result — the Code
    // Mode dispatch shape. A recovering composite (nested failure swallowed)
    // has no marker to forward: ToolExecutionFailure types concludesTurn as
    // never, so only an authoritative nested success can conclude the run.
    /** 中文说明：测试局部值 call，由紧邻初始化决定。 */
    let call = 0
    ctx.tools.register({
      ...echoTool,
      name: 'composite',
      async execute(_args, exec) {
        call += 1
        /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
        const nested = await ctx.tools.execute({
          signal: exec.signal, callId: CallId(`nested-${call}`), name: 'terminal-nested', arguments: {}, parent: exec.token,
        })
        if (nested.concludesTurn) exec.concludeTurn()
        return nested.isError ? 'nested failed, composite recovered' : 'nested succeeded'
      },
    })

    // A policy converts the nested success into an error: the failed result
    // carries no marker, so the recovering composite does not conclude.
    /** 中文说明：测试局部值 veto，由紧邻初始化决定。 */
    const veto = ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
      if (exec.name !== 'terminal-nested') return next()
      return { kind: 'block', feedback: [{ type: 'text', text: 'nested success rejected' }] }
    })
    /** 中文说明：测试局部值 recovered，由紧邻初始化决定。 */
    const recovered = await ctx.tools.execute({
      signal: testToolSignal, callId: CallId('composite-vetoed'), name: 'composite', arguments: {},
    })
    expect(recovered.isError).toBe(false)
    expect(recovered.concludesTurn).toBeUndefined()
    veto()

    // The same nested call succeeding carries the marker; the composite
    // forwards it onto its own successful result.
    /** 中文说明：测试局部值 concluded，由紧邻初始化决定。 */
    const concluded = await ctx.tools.execute({
      signal: testToolSignal, callId: CallId('composite-ok'), name: 'composite', arguments: {},
    })
    expect(concluded.isError).toBe(false)
    expect(concluded.concludesTurn).toBe(true)
  })

  it('returns isError results for unknown tools and throwing tools', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'boom',
      async execute() {
        throw new Error('exploded')
      },
    })

    /** 中文说明：测试局部值 unknown，由紧邻初始化决定。 */
    const unknown = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'nope', arguments: {} })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0]).toMatchObject({ text: 'Error: unknown tool "nope"' })
    // An unknown tool is a routable failure class, same as a tool-thrown one.
    expect(unknown.error).toEqual({
      message: 'unknown tool "nope"',
      info: { name: 'ToolNotFoundError', code: 'UNKNOWN_TOOL' },
    })

    /** 中文说明：测试局部值 thrown，由紧邻初始化决定。 */
    const thrown = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c2'), name: 'boom', arguments: {} })
    expect(thrown.isError).toBe(true)
    expect(thrown.content[0]).toMatchObject({ text: 'Error: exploded' })
  })

  it('normalizes a hostile thrown value whose inspection and coercion both throw', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'hostile-throw',
      async execute() {
        throw new Proxy({}, {
          getPrototypeOf: () => { throw new Error('prototype trap') },
          has: () => { throw new Error('has trap') },
          get: () => { throw new Error('get trap') },
        })
      },
    })

    await expect(ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('hostile'), name: 'hostile-throw', arguments: {},
    })).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: <unprintable thrown value>' }],
    })
  })

  it('ToolNotFoundError carries a stable message and code', async () => {
    /** 中文说明：测试局部值 { HarnessError }，由紧邻初始化决定。 */
    const { HarnessError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 err，由紧邻初始化决定。 */
    const err = new ToolNotFoundError('ghost')
    expect(err).toBeInstanceOf(HarnessError)
    expect(err.name).toBe('ToolNotFoundError')
    expect(err.code).toBe('UNKNOWN_TOOL')
    expect(err.message).toBe('unknown tool "ghost"')
  })

  it('lets a tools/pre-execute listener deny a call (permission pattern)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    /** 中文说明：测试局部值 postSawFrozen，由紧邻初始化决定。 */
    let postSawFrozen = false

    ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.name === 'echo') return { kind: 'deny', reason: 'denied by policy' }
      return next()
    })
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      postSawFrozen = Object.isFrozen(result)
      expect(Reflect.set(result, 'content', [])).toBe(false)
      return next()
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: denied by policy' })
    expect(postSawFrozen).toBe(true)
  })

  it('an ask decision degrades to deny when no approval seam is mounted', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> =>
      ({ kind: 'ask', reason: 'needs approval' }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: needs approval' })
  })

  it('an ask decision with no reason degrades to deny with a default message', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: tool "echo" requires approval (not yet supported)' })
  })

  describe('ask routing through ctx.approval', () => {
    /**
     * A minimal Agent stand-in — the approval seam reaches
     * `agent.session.append` and folds `.events`; the seeded open turn
     * satisfies request()'s enclosure precondition.
     */
    /** 中文说明：函数 fakeAgent 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
    function fakeAgent(): Agent {
      return {
        session: { events: [{ type: 'turn/start' }], append: () => ({}) },
      } as unknown as Agent
    }

    /** 中文说明：函数 approvalSetup 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
    async function approvalSetup() {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await setup()
      await ctx.plugin(ApprovalService)
      ctx.tools.register(echoTool)
      return ctx
    }

    it('dispatches the tool when the answerer grants allowed-once, forwarding the ask fields', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      /** 中文说明：测试局部值 agent，由紧邻初始化决定。 */
      const agent = fakeAgent()
      /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
      const controller = new AbortController()
      /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
      const seen: ApprovalRequest[] = []
      ctx.on('approval/request', (req) => {
        seen.push(req)
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> =>
        ({ kind: 'ask', reason: 'hook wants a human' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({
        callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' }, agent, signal: controller.signal,
      })

      expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: 'hi' }] })
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ agent, toolName: 'echo', callId: 'c1', reason: 'hook wants a human' })
      expect(seen[0]?.signal).toBe(controller.signal)
    })

    it('denies with the user-rejection reason on rejected', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('rejected'))
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {}, agent: fakeAgent() })
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: the user rejected tool "echo"' })
    })

    it('denies with the cancellation reason on cancelled', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('cancelled'))
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {}, agent: fakeAgent() })
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: approval for tool "echo" was cancelled' })
    })

    it('returns ABORTED_BEFORE_DISPATCH when caller cancellation overtakes approval', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
      const entered = Promise.withResolvers<undefined>()
      /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
      const release = Promise.withResolvers<ApprovalOutcome>()
      /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
      let dispatched = 0
      ctx.tools.register({
        ...echoTool,
        name: 'approval-probe',
        async execute() { dispatched += 1; return [] },
      })
      ctx.on('approval/request', () => {
        entered.resolve(undefined)
        return release.promise
      })
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))
      /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
      const controller = new AbortController()
      /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
      const pending = ctx.tools.execute({
        callId: CallId('approval-cancelled'),
        name: 'approval-probe',
        arguments: {},
        agent: fakeAgent(),
        signal: controller.signal,
      })

      await entered.promise
      controller.abort('caller cancelled approval')
      release.resolve('allowed-once')

      await expect(pending).resolves.toMatchObject({
        isError: true,
        error: { info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
      })
      expect(dispatched).toBe(0)
    })

    it('denies with the no-channel reason when the seam is mounted but nobody answers', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {}, agent: fakeAgent() })
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: tool "echo" requires approval, but no approval channel is available' })
    })

    it('denies an agent-less execution without asking — nothing to route or audit through', async () => {
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await approvalSetup()
      /** 中文说明：测试局部值 asked，由紧邻初始化决定。 */
      let asked = false
      ctx.on('approval/request', () => {
        asked = true
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {} })
      expect(asked).toBe(false)
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: tool "echo" requires approval, but the call has no agent to route it through' })
    })

    it('turns a rogue outcome from a NON-conforming approval stand-in into an isError result', async () => {
      // ApprovalService normalizes rogue answers itself; this pins the
      // registry's own exhaustiveness backstop by shadowing the service with a
      // stand-in that violates the outcome contract.
      /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
      const ctx = await setup()
      ctx.tools.register(echoTool)
      ctx.provide('approval', { request: () => Promise.resolve('yolo') } as unknown as ApprovalService)
      ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'ask' }))

      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: {}, agent: fakeAgent() })
      expect(result.isError).toBe(true)
      /** 中文说明：测试局部值 text，由紧邻初始化决定。 */
      const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
      expect(text).toContain('unreachable')
    })
  })

  it('a tools/post-execute listener can replace the result content (accept) ', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/post-execute', async (_exec, _result, _next): Promise<PostToolDecision> =>
      ({ kind: 'accept', content: [{ type: 'text', text: 'rewritten' }] }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ text: 'rewritten' })
  })

  it('a tools/post-execute block turns the call into an isError with corrective feedback', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/post-execute', async (_exec, _result, _next): Promise<PostToolDecision> =>
      ({ kind: 'block', feedback: [{ type: 'text', text: 'output rejected: try again' }] }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'output rejected: try again' })
  })

  it('runs the snapshotted final content transform after outer pipeline normalization', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.tools.register(defineContentToolFixture({
      name: 'bounded',
      description: 'bounded result',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'body' }] },
      finalizeContent(exec, result) {
        expect(exec.name).toBe('bounded')
        expect(result.isError).toBe(true)
        return [{ type: 'text', text: 'bounded failure' }]
      },
    }))
    ctx.on('tools/pre-execute', async () => {
      dispose()
      throw new HarnessError('policy failed', 'POLICY_FAILED')
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('bounded'), name: 'bounded', arguments: {} })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'bounded failure' }],
      isError: true,
      error: {
        message: 'policy failed',
        info: { name: 'HarnessError', code: 'POLICY_FAILED' },
      },
    })
  })

  it('keeps the normalized content when the final content transform returns undefined', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 finalized，由紧邻初始化决定。 */
    let finalized = 0
    ctx.tools.register({
      ...echoTool,
      name: 'identity-finalizer',
      finalizeContent() {
        finalized += 1
        return undefined
      },
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('identity-finalizer'), name: 'identity-finalizer', arguments: {} })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: '' }])
    expect(finalized).toBe(1)
  })

  it('a block decision can ALSO attach additionalContexts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/post-execute', async (_exec, _result, _next): Promise<PostToolDecision> =>
      ({
        kind: 'block',
        feedback: [{ type: 'text', text: 'rejected' }],
        additionalContexts: [createUserMessage({
          content: [{ type: 'text', text: 'why it was rejected' }], source: { kind: 'plugin', plugin: 'test' },
        })],
      }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'rejected' })
    expect(result.additionalContexts).toMatchObject([{ content: [{ text: 'why it was rejected' }], source: { kind: 'plugin', plugin: 'test' } }])
  })

  it('post-execute additionalContexts ride on the result for the loop to buffer', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    ctx.on('tools/post-execute', async (_exec, _result, _next): Promise<PostToolDecision> =>
      ({ kind: 'accept', additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'fyi' }], source: { kind: 'plugin', plugin: 'test' },
      })] }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.additionalContexts).toMatchObject([{ content: [{ text: 'fyi' }], source: { kind: 'plugin', plugin: 'test' } }])
  })

  it('preserves tool-deferred, execute-wrapper, and post-execute contexts in order', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'composite',
      description: 'composite',
      parameters: {},
      async execute(_args, exec) {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'nested-1' }], source: { kind: 'plugin', plugin: 'nested-1' },
        }))
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'nested-2' }], source: { kind: 'plugin', plugin: 'nested-2' },
        }))
        return [{ type: 'text', text: 'done' }]
      },
    }))
    ctx.on('tools/execute', async (_exec, next) => {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await next()
      return {
        ...result,
        additionalContexts: [
          ...result.additionalContexts ?? [],
          createUserMessage({
            content: [{ type: 'text', text: 'wrapper' }], source: { kind: 'plugin', plugin: 'wrapper' },
          }),
        ],
      }
    })
    ctx.on('tools/post-execute', async (_exec, _result, next): Promise<PostToolDecision> => {
      /** 中文说明：测试局部值 downstream，由紧邻初始化决定。 */
      const downstream = await next()
      return {
        ...downstream,
        additionalContexts: [
          createUserMessage({
            content: [{ type: 'text', text: 'post' }], source: { kind: 'plugin', plugin: 'post' },
          }),
          ...downstream.additionalContexts ?? [],
        ],
      }
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('composite'), name: 'composite', arguments: {} })

    expect(result.additionalContexts?.map(context => context.source)).toEqual([
      { kind: 'plugin', plugin: 'nested-1' },
      { kind: 'plugin', plugin: 'nested-2' },
      { kind: 'plugin', plugin: 'wrapper' },
      { kind: 'plugin', plugin: 'post' },
    ])
  })

  it('keeps deferred contexts when a composite tool throws, but drops them when the outer call is blocked', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'failing-composite',
      description: 'failing composite',
      parameters: {},
      async execute(_args, exec) {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'nested' }], source: { kind: 'plugin', plugin: 'nested' },
        }))
        throw new Error('outer failure')
      },
    }))

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('failed'), name: 'failing-composite', arguments: {} })
    expect(failed.isError).toBe(true)
    expect(failed.additionalContexts?.map(context => context.source)).toEqual([{ kind: 'plugin', plugin: 'nested' }])

    ctx.on('tools/post-execute', async (): Promise<PostToolDecision> => ({
      kind: 'block',
      feedback: [{ type: 'text', text: 'blocked' }],
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'block-only' }], source: { kind: 'plugin', plugin: 'blocker' },
      })],
    }))
    /** 中文说明：测试局部值 blocked，由紧邻初始化决定。 */
    const blocked = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('blocked'), name: 'failing-composite', arguments: {} })
    expect(blocked.isError).toBe(true)
    expect(blocked.additionalContexts?.map(context => context.source)).toEqual([{ kind: 'plugin', plugin: 'blocker' }])
  })

  it('composes pre + post waterfalls around dispatch (sandbox-wrap pattern)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order: string[] = []
    ctx.on('tools/pre-execute', async (_exec, next) => {
      order.push('pre:before')
      /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
      const decision = await next()
      order.push('pre:after')
      return decision
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      order.push('post:before')
      /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
      const decision = await next()
      order.push('post:after')
      return decision
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'x' } })
    expect(result.isError).toBe(false)
    // pre runs fully (gate) before dispatch, then post runs over the result.
    expect(order).toEqual(['pre:before', 'pre:after', 'post:before', 'post:after'])
  })

  it('runs tools/execute after an allowed pre-execute, around dispatch, and before post-execute', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order: string[] = []
    ctx.tools.register(defineContentToolFixture({
      name: 'traced',
      description: 'echo',
      parameters: { text: { type: 'string' } },
      async execute(args) {
        order.push('dispatch')
        return [{ type: 'text' as const, text: args.text ?? '' }]
      },
    }))

    ctx.on('tools/pre-execute', async (_exec, next) => { order.push('pre'); return next() })
    ctx.on('tools/execute', async (_exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      order.push('execute:before')
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await next()
      order.push('execute:after')
      return result
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => { order.push('post'); return next() })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'traced', arguments: { text: 'hi' } })
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false, value: [{ type: 'text', text: 'hi' }] })
    // The around-dispatch extension point wraps dispatch; pre gates before it, post runs over its result.
    expect(order).toEqual(['pre', 'execute:before', 'dispatch', 'execute:after', 'post'])
  })

  it('skips dispatch when caller cancellation arrives while pre-execute awaits', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'must-not-run',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/pre-execute', async (_exec, next) => {
      entered.resolve(undefined)
      await release.promise
      return await next()
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-in-pre'), name: 'must-not-run', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('cancelled in policy')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
    })
    expect(dispatched).toBe(0)
  })

  it('preserves a pre-execute denial that settles after cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'denied-after-cancel',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/pre-execute', async () => {
      entered.resolve(undefined)
      await release.promise
      return { kind: 'deny', reason: 'policy denied the call' }
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('denied-after-cancel'), name: 'denied-after-cancel', arguments: {}, signal: controller.signal,
    })

    await entered.promise
    controller.abort('cancelled while policy decided')
    release.resolve(undefined)

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: policy denied the call' }],
      isError: true,
      error: { message: 'policy denied the call' },
    })
    expect(dispatched).toBe(0)
  })

  it('preserves an async pre-execute failure that settles after cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'must-not-run',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/pre-execute', async () => {
      entered.resolve(undefined)
      await release.promise
      throw new Error('gate interrupted')
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-pre-error'), name: 'must-not-run', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('cancelled in policy')
    release.resolve(undefined)

    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'Error: gate interrupted' }],
      isError: true,
      error: { message: 'gate interrupted' },
    })
    expect(dispatched).toBe(0)
  })

  it('rechecks caller cancellation after an async around-dispatch wrapper delegates', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'must-not-run',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = new AbortController()
    ctx.on('tools/execute', async (exec, next) => {
      /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
      const upstream = exec.signal
      exec.signal = replacement.signal
      try {
        entered.resolve(undefined)
        await release.promise
        return await next()
      } finally {
        exec.signal = upstream
      }
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-in-around'), name: 'must-not-run', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('cancelled in wrapper')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
    })
    expect(dispatched).toBe(0)
  })

  it('skips dispatch when an around wrapper supplies an already-aborted signal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'must-not-run',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = AbortSignal.abort('wrapper cancelled')
    ctx.on('tools/execute', async (exec, next) => {
      /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
      const upstream = exec.signal
      exec.signal = replacement
      try {
        return await next()
      } finally {
        exec.signal = upstream
      }
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      callId: CallId('cancelled-wrapper'), name: 'must-not-run', arguments: {}, signal: controller.signal,
    })

    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(dispatched).toBe(0)
  })

  it('uses ABORTED_BEFORE_DISPATCH when cancellation overtakes a wrapper short-circuit', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'short-circuited',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/execute', async () => {
      entered.resolve(undefined)
      await release.promise
      return {
        value: 'wrapper success',
        content: [{ type: 'text', text: 'wrapper success' }],
        isError: false,
        additionalContexts: [createUserMessage({
          content: [{ type: 'text', text: 'wrapper context' }],
          source: { kind: 'plugin', plugin: 'wrapper' },
        })],
      }
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-short-circuit'),
      name: 'short-circuited',
      arguments: {},
      signal: controller.signal,
    })

    await entered.promise
    controller.abort('cancelled while wrapper waited')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
      additionalContexts: [{ source: { kind: 'plugin', plugin: 'wrapper' } }],
    })
    expect(dispatched).toBe(0)
  })

  it('replaces a late wrapper success with ABORTED and preserves deferred contexts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'completed-before-wrapper',
      async execute(_args, exec) {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'completed child work' }],
          source: { kind: 'plugin', plugin: 'child' },
        }))
        return 'body complete'
      },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/execute', async (_exec, next) => {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await next()
      entered.resolve(undefined)
      await release.promise
      return result
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-after-body'), name: 'completed-before-wrapper', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('cancelled while wrapper settled')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED } },
      additionalContexts: [{ source: { kind: 'plugin', plugin: 'child' } }],
    })
  })

  it('replaces a late post-execute success with ABORTED and preserves contexts', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'completed-before-post',
      async execute(_args, exec) {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'completed child work' }],
          source: { kind: 'plugin', plugin: 'child' },
        }))
        return 'body complete'
      },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      /** 中文说明：测试局部值 decision，由紧邻初始化决定。 */
      const decision = await next()
      entered.resolve(undefined)
      await release.promise
      return {
        ...decision,
        additionalContexts: [createUserMessage({
          content: [{ type: 'text', text: 'post context' }],
          source: { kind: 'plugin', plugin: 'post' },
        })],
      }
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-in-post'), name: 'completed-before-post', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('cancelled while post policy waits')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED } },
      additionalContexts: [
        { source: { kind: 'plugin', plugin: 'child' } },
        { source: { kind: 'plugin', plugin: 'post' } },
      ],
    })
  })

  it('preserves an around-dispatch failure that settles after cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = 0
    ctx.tools.register({
      ...echoTool,
      name: 'wrapper-failure',
      async execute() { dispatched += 1; return [] },
    })
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/execute', async () => {
      entered.resolve(undefined)
      await release.promise
      throw new HarnessError('wrapper failed', 'WRAPPER_FAILURE')
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('wrapper-failure'), name: 'wrapper-failure', arguments: {}, signal: controller.signal,
    })

    await entered.promise
    controller.abort('cancelled while wrapper failed')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: wrapper failed' }],
      isError: true,
      error: { info: { name: 'HarnessError', code: 'WRAPPER_FAILURE' } },
    })
    expect(dispatched).toBe(0)
  })

  it('preserves a tool-owned failure after the body observes cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    ctx.tools.register({
      ...echoTool,
      name: 'tool-failure',
      execute(_args, exec) {
        entered.resolve(undefined)
        return new Promise<never>((_resolve, reject) => {
          exec.signal.addEventListener('abort', () => {
            reject(new HarnessError('tool failed', 'TOOL_FAILURE'))
          }, { once: true })
        })
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('tool-failure'), name: 'tool-failure', arguments: {}, signal: controller.signal,
    })

    await entered.promise
    controller.abort('cancelled running body')

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: tool failed' }],
      isError: true,
      error: { info: { name: 'HarnessError', code: 'TOOL_FAILURE' } },
    })
  })

  it('preserves a post-policy failure that settles after cancellation', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<undefined>()
    ctx.on('tools/post-execute', async () => {
      entered.resolve(undefined)
      await release.promise
      throw new HarnessError('post-policy failed', 'POST_FAILURE')
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('post-failure'), name: 'echo', arguments: {}, signal: controller.signal,
    })

    await entered.promise
    controller.abort('cancelled while post-policy failed')
    release.resolve(undefined)

    await expect(pending).resolves.toMatchObject({
      content: [{ type: 'text', text: 'Error: post-policy failed' }],
      isError: true,
      error: { info: { name: 'HarnessError', code: 'POST_FAILURE' } },
    })
  })

  it('fuses caller cancellation back into a wrapper replacement for the running body', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = new AbortController()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let bodySignal: AbortSignal | undefined
    ctx.tools.register({
      ...echoTool,
      name: 'cooperative',
      execute(_args, exec) {
        bodySignal = exec.signal
        entered.resolve(undefined)
        if (exec.signal.aborted) return Promise.resolve('stopped')
        return new Promise<string>((resolve) => {
          exec.signal.addEventListener('abort', () => { resolve('stopped') }, { once: true })
        })
      },
    })
    ctx.on('tools/execute', async (exec, next) => {
      /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
      const upstream = exec.signal
      exec.signal = replacement.signal
      try {
        return await next()
      } finally {
        exec.signal = upstream
      }
    })

    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('cancelled-body'), name: 'cooperative', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    expect(bodySignal).not.toBe(controller.signal)
    expect(bodySignal).not.toBe(replacement.signal)
    controller.abort('cancel running body')

    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED } },
    })
    expect(bodySignal?.aborted).toBe(true)
    expect(replacement.signal.aborted).toBe(false)
  })

  it('restores the required caller signal after around dispatch', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let postSignal: AbortSignal | undefined
    ctx.on('tools/execute', async (exec, next) => {
      /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
      const upstream = exec.signal
      exec.signal = new AbortController().signal
      try {
        return await next()
      } finally {
        exec.signal = upstream
      }
    })
    ctx.on('tools/post-execute', async (exec, _result, next) => {
      postSignal = exec.signal
      return next()
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()

    await ctx.tools.execute({
      callId: CallId('restored-signal'), name: 'echo', arguments: {}, signal: controller.signal,
    })

    expect(postSignal).toBe(controller.signal)
  })

  it('waits for an uncooperative started body before returning ABORTED', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    const entered = Promise.withResolvers<undefined>()
    /** 中文说明：测试局部值 release，由紧邻初始化决定。 */
    const release = Promise.withResolvers<string>()
    ctx.tools.register({
      ...echoTool,
      name: 'uncooperative',
      execute(_args, exec) {
        exec.deferContext(createUserMessage({
          content: [{ type: 'text', text: 'nested outcome' }],
          source: { kind: 'plugin', plugin: 'nested' },
        }))
        entered.resolve(undefined)
        return release.promise
      },
    })
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new AbortController()
    /** 中文说明：测试局部值 pending，由紧邻初始化决定。 */
    const pending = ctx.tools.execute({
      callId: CallId('drain-body'), name: 'uncooperative', arguments: {}, signal: controller.signal,
    })
    await entered.promise
    controller.abort('must still drain')

    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = await Promise.race([
      pending.then(() => 'settled' as const),
      Promise.resolve('pending' as const),
    ])
    expect(state).toBe('pending')
    release.resolve('settled')
    await expect(pending).resolves.toMatchObject({
      isError: true,
      error: { info: { name: 'AbortError', code: TOOL_ABORTED } },
      additionalContexts: [{ source: { kind: 'plugin', plugin: 'nested' } }],
    })
  })

  it('materializes a pre-aborted call and publishes one result without entering pipeline phases', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 phases，由紧邻初始化决定。 */
    const phases = { pre: 0, around: 0, body: 0, post: 0, result: 0 }
    /** 中文说明：测试局部值 callerArguments，由紧邻初始化决定。 */
    const callerArguments = { nested: { value: 1 } }
    /** 中文说明：测试局部值 callerSignal，由紧邻初始化决定。 */
    const callerSignal = AbortSignal.abort('already cancelled')
    /** 中文说明：测试局部值 argumentReads，由紧邻初始化决定。 */
    let argumentReads = 0
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedArguments: unknown
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedExecution: object | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedToken: symbol | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedSignal: AbortSignal | undefined
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let observedResult: ToolExecutionResult | undefined
    ctx.tools.register({
      ...echoTool,
      name: 'domain-abort',
      async execute() { phases.body += 1; return [] },
    })
    ctx.on('tools/pre-execute', async (_exec, next) => { phases.pre += 1; return next() })
    ctx.on('tools/execute', async (_exec, next) => { phases.around += 1; return next() })
    ctx.on('tools/post-execute', async (_exec, _result, next) => { phases.post += 1; return next() })
    ctx.on('tools/result', (exec, result) => {
      phases.result += 1
      observedExecution = exec
      observedArguments = exec.arguments
      observedToken = exec.token
      observedSignal = exec.signal
      observedResult = result
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      callId: CallId('pre-aborted'),
      name: 'domain-abort',
      get arguments() { argumentReads += 1; return callerArguments },
      signal: callerSignal,
    })

    expect(argumentReads).toBe(1)
    expect(phases).toEqual({ pre: 0, around: 0, body: 0, post: 0, result: 1 })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      isError: true,
      error: {
        message: 'tool call aborted before dispatch',
        info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
      },
    })
    expect(observedResult).toBe(result)
    expect(Object.isFrozen(observedExecution)).toBe(true)
    expect(typeof observedToken).toBe('symbol')
    expect(observedSignal).toBe(callerSignal)
    expect(Object.isFrozen(result)).toBe(true)
    expect(observedArguments).not.toBe(callerArguments)
    expect(Object.isFrozen(observedArguments)).toBe(true)
    expect(Object.isFrozen((observedArguments as { nested: object }).nested)).toBe(true)
  })

  it('lets argument materialization failure win over a pre-aborted signal', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 observed，由紧邻初始化决定。 */
    let observed = 0
    ctx.on('tools/result', () => { observed += 1 })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      callId: CallId('invalid-pre-aborted'),
      name: 'missing',
      arguments: { invalid: () => undefined },
      signal: AbortSignal.abort('already cancelled'),
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: tool execution arguments must be losslessly JSON-serializable' }],
      isError: true,
      error: { message: 'tool execution arguments must be losslessly JSON-serializable' },
    })
    expect(observed).toBe(1)
  })

  it('a pre-execute deny short-circuits before tools/execute (the seam never runs)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    /** 中文说明：测试局部值 entered，由紧邻初始化决定。 */
    let entered = false
    ctx.on('tools/pre-execute', async (_exec, _next): Promise<PreToolDecision> => ({ kind: 'deny', reason: 'nope' }))
    ctx.on('tools/execute', async (_exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      entered = true
      return next()
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: nope' })
    expect(entered).toBe(false) // A denied call never enters the around-dispatch extension point.
  })

  it('a thrown tool is normalized to an isError result BEFORE a tools/execute listener sees next()', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'boom',
      async execute() { throw new HarnessError('kaboom', 'BOOM') },
    })

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seen: { isError: boolean; error?: unknown } | undefined
    ctx.on('tools/execute', async (_exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await next()
      // The base next() IS dispatch-with-normalization: the wrapper sees the
      // normalized isError result, never a raw throw from the tool body.
      seen = { isError: result.isError, error: result.error }
      return result
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'boom', arguments: {} })
    expect(seen).toEqual({
      isError: true,
      error: { message: 'kaboom', info: { name: 'HarnessError', code: 'BOOM' } },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: kaboom' })
  })

  it('freezes core dispatch outcomes before around and post listeners can observe them', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    /** 中文说明：测试局部值 mutationAttempts，由紧邻初始化决定。 */
    const mutationAttempts: boolean[] = []
    ctx.on('tools/execute', async (_exec, next) => {
      /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
      const result = await next()
      mutationAttempts.push(Reflect.set(result, 'value', 'around mutation'))
      return result
    })
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      mutationAttempts.push(Reflect.set(result, 'value', 'post mutation'))
      return next()
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('frozen-canonical'), name: 'echo', arguments: { text: 'original' },
    })
    expect(mutationAttempts).toEqual([false, false])
    expect(result.isError ? undefined : result.value).toBe('original')
  })

  it('a thrown tool normalized inside tools/execute still reaches post-execute', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'boom',
      async execute() { throw new Error('exploded') },
    })

    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let postSaw: boolean | undefined
    ctx.on('tools/execute', async (_exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => next())
    ctx.on('tools/post-execute', async (_exec, result, next) => {
      postSaw = result.isError
      return next()
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'boom', arguments: {} })
    expect(postSaw).toBe(true) // the normalized isError still flows through post-execute
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: exploded' })
  })

  it('re-fuses the caller signal with an around-dispatch replacement for the body', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let seenSignal: AbortSignal | undefined
    ctx.tools.register({
      ...echoTool,
      name: 'signal-probe',
      async execute(_args, exec) {
        seenSignal = exec.signal
        return 'ok'
      },
    })

    /** 中文说明：测试局部值 upstream，由紧邻初始化决定。 */
    const upstream = new AbortController().signal
    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = new AbortController().signal
    ctx.on('tools/execute', async (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> => {
      expect(exec.signal).toBe(upstream)
      // Cordis next() ignores passed arguments, so a wrapper mutates exec in
      // place (the documented "mutate the shared object, then delegate" idiom).
      exec.signal = replacement
      return next()
    })

    await ctx.tools.execute({ callId: CallId('c1'), name: 'signal-probe', arguments: {}, signal: upstream })
    expect(seenSignal).toBeDefined()
    expect(seenSignal).not.toBe(upstream)
    expect(seenSignal).not.toBe(replacement)
  })

  it('a tools/execute listener can short-circuit dispatch by returning a result without next()', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 dispatched，由紧邻初始化决定。 */
    let dispatched = false
    ctx.tools.register({
      ...echoTool,
      name: 'never-runs',
      async execute() { dispatched = true; return 'unreachable' },
    })

    ctx.on('tools/execute', async (_exec: ToolDispatchExecution, _next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult> =>
      ({ content: [{ type: 'text', text: 'ignored authored content' }], isError: false, value: 'short-circuited' }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'never-runs', arguments: {} })
    expect(dispatched).toBe(false) // returning without next() skips core dispatch
    expect(result.content[0]).toMatchObject({ text: 'short-circuited' })
  })

  it('revalidates a cached canonical result returned from a different dispatch', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({ ...echoTool, name: 'string-output', async execute() { return 'cached' } })
    /** 中文说明：测试局部值 objectBodyRan，由紧邻初始化决定。 */
    let objectBodyRan = false
    ctx.tools.register(defineTool({
      name: 'object-output',
      description: 'Return one closed object.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean', required: true } },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
      },
      execute() {
        objectBodyRan = true
        return Promise.resolve({ ok: true })
      },
    }))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let cached: ToolExecutionResult | undefined
    ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'string-output') {
        cached = await next()
        return cached
      }
      if (exec.name === 'object-output') {
        if (cached === undefined) throw new Error('expected the first dispatch result')
        return cached
      }
      return next()
    })

    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = await ctx.tools.execute({
      signal: testToolSignal, callId: CallId('cached-first'), name: 'string-output', arguments: {},
    })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = await ctx.tools.execute({
      signal: testToolSignal, callId: CallId('cached-second'), name: 'object-output', arguments: {},
    })

    expect(first.isError ? undefined : first.value).toBe('cached')
    expect(objectBodyRan).toBe(false)
    expect(second).toMatchObject({
      isError: true,
      error: { info: { name: 'ToolOutputError', code: 'INVALID_TOOL_OUTPUT' } },
    })
  })

  it('preserves additionalContexts supplied by an around-dispatch result', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/execute', async () => ({
      content: [{ type: 'text', text: 'short-circuited with context' }],
      isError: false,
      value: 'short-circuited with context',
      additionalContexts: [createUserMessage({
        content: [{ type: 'text', text: 'from around dispatch' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('around-context'), name: 'echo', arguments: {},
    })
    expect(result.additionalContexts).toEqual([{
      id: expect.any(String) as unknown,
      role: 'user',
      content: [{ type: 'text', text: 'from around dispatch' }],
      source: { kind: 'plugin', plugin: 'test' },
    }])
  })

  it('returns an isError result when a tools/execute listener throws', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/execute', async () => { throw new Error('wrapper broke') })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: wrapper broke' }],
      error: { message: 'wrapper broke' },
      isError: true,
    })
  })

  it('returns an isError result when a tools/pre-execute listener throws', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/pre-execute', async () => {
      throw new Error('permission hook broke')
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: permission hook broke' }],
      error: { message: 'permission hook broke' },
      isError: true,
    })
  })

  it('returns an isError result when a tools/post-execute listener throws', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/post-execute', async () => {
      throw new Error('post hook broke')
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Error: post hook broke' }],
      error: { message: 'post hook broke' },
      isError: true,
    })
  })

  it('preserves structured error info when a tools/pre-execute listener throws HarnessError', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    ctx.on('tools/pre-execute', async () => {
      throw new HarnessError('denied', 'DENIED')
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'echo', arguments: { text: 'hi' } })

    expect(result).toMatchObject({
      isError: true,
      error: { message: 'denied', info: { name: 'HarnessError', code: 'DENIED' } },
    })
  })

  it('schemas() snapshots tool schemas instead of exposing registry objects', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = ctx.tools.schemas()
    /** 中文说明：测试局部值 firstParameters，由紧邻初始化决定。 */
    const firstParameters = first[0]!.parameters as { properties: Record<string, unknown> }
    firstParameters.properties['mutated'] = { type: 'string' }
    first[0]!.description = 'mutated'

    expect(ctx.tools.schemas()).toEqual([{
      name: 'echo',
      description: 'echo arguments back',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
    }])
  })

  it('schemas() snapshots deeply nested parameters without using structured-clone recursion', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 depth，由紧邻初始化决定。 */
    const depth = 5_000
    /** 中文说明：测试局部值 nested，由紧邻初始化决定。 */
    let nested: JsonSchemaNode = { type: 'string' }
    /** 中文说明：测试局部值 index，由紧邻初始化决定。 */
    for (let index = 0; index < depth; index++) nested = { oneOf: [nested, { type: 'null' }] }
    ctx.tools.register({
      ...echoTool,
      name: 'deep-schema',
      parameters: { type: 'object', properties: { nested } },
    })

    /** 中文说明：测试局部值 projected，由紧邻初始化决定。 */
    const projected = ctx.tools.schemas()[0]!.parameters as JsonSchemaNode

    /** 中文说明：测试局部值 cursor，由紧邻初始化决定。 */
    let cursor = projected.properties!.nested!
    /** 中文说明：测试局部值 layers，由紧邻初始化决定。 */
    let layers = 0
    while (cursor.oneOf !== undefined) {
      cursor = cursor.oneOf[0]!
      layers++
    }
    expect(layers).toBe(depth)
    expect(cursor).toEqual({ type: 'string' })
  })

  it('rejects schema projection when a raw registration is not lossless JSON', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'lossy-schema',
      parameters: { type: 'object', default: Number.NaN },
    })

    expect(() => ctx.tools.schemas())
      .toThrow('tool "lossy-schema" parameters must be lossless JSON before schema projection')
  })

  it('rejects a non-positive or non-finite registration timeout', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    expect(() => ctx.tools.register({ ...echoTool, name: 'zero-timeout', timeoutMs: 0 }))
      .toThrow('timeoutMs must be a positive finite number')
    expect(() => ctx.tools.register({ ...echoTool, name: 'infinite-timeout', timeoutMs: Number.POSITIVE_INFINITY }))
      .toThrow('timeoutMs must be a positive finite number')
  })

  it('rejects duplicate names and unregisters on fiber dispose (HMR safety)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    expect(() => ctx.tools.register(echoTool)).toThrow('already registered')

    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.tools.register({ ...echoTool, name: 'scoped' })
    }, { inject: ['tools'] }))
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['echo', 'scoped'])

    await fiber.dispose()
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['echo'])
  })

  it('returns a callable disposer from register() that unregisters the tool', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)

    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.tools.register({ ...echoTool, name: 'disposable' })
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['echo', 'disposable'])

    dispose()
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['echo'])
  })

  it('rolls back the tool entry when a tools/change listener throws (P1-1)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()

    /** 中文说明：测试局部值 threw，由紧邻初始化决定。 */
    let threw = false
    ctx.on('tools/change', () => {
      if (!threw) { threw = true; throw new Error('boom change listener') }
    })

    // The throwing emit must roll the entry back, not leak it.
    expect(() => ctx.tools.register(echoTool)).toThrow('boom change listener')
    expect(ctx.tools.get('echo')).toBeUndefined() // rolled back, not leaked
    expect(ctx.tools.schemas()).toHaveLength(0)

    // A subsequent listener-free register of the SAME name succeeds and is
    // exposed exactly once (the duplicate-name check is not wedged).
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = ctx.tools.register(echoTool)
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['echo'])
    dispose()
    expect(ctx.tools.get('echo')).toBeUndefined()
  })

  it('register() returns the EXACT effect disposer: a composite yield nests the teardown in order', async () => {
    // Registry methods return the exact Cordis effect disposer so a composite yield places
    // unregistration at its LIFO position. A wrapper would create a concurrent sibling; this async
    // probe yields during earlier teardown and would then observe the tool already removed.
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 order，由紧邻初始化决定。 */
    const order: string[] = []
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.effect(function* () {
        yield () => { order.push('disposed-last') }
        yield inner.tools.register({ ...echoTool, name: 'nested' })
        order.push('registered')
        yield async () => {
          await new Promise(resolve => setTimeout(resolve, 0))
          order.push(inner.tools.get('nested') ? 'first: still registered' : 'first: already gone')
        }
      })
    }, { inject: ['tools'] }))
    await fiber.dispose()
    expect(order).toEqual(['registered', 'first: still registered', 'disposed-last'])
    expect(ctx.tools.get('nested')).toBeUndefined()
  })
})

describe('defineTool / schema DSL', () => {
  it('converts ParameterSchemaSpec to standard JSON Schema with required array', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      path: { type: 'string', required: true, description: 'Absolute path' },
      offset: { type: 'number' },
      limit: { type: 'number', description: 'Max lines' },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path' },
        offset: { type: 'number' },
        limit: { type: 'number', description: 'Max lines' },
      },
      required: ['path'],
    })
  })

  it('handles empty spec (no properties, no required)', () => {
    expect(parameterSchemaSpecToJsonSchema({})).toEqual({
      type: 'object',
      properties: {},
    })
  })

  it('handles nested object spec', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      config: {
        type: 'object',
        additionalProperties: true,
        required: true,
        properties: {
          host: { type: 'string', required: true },
          port: { type: 'number' },
        },
      },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema).toEqual({
      type: 'object',
      properties: {
        config: {
          type: 'object',
          additionalProperties: true,
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
          },
          required: ['host'],
        },
      },
      required: ['config'],
    })
  })

  it('defineTool returns a valid ToolDefinition with typed execute', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineTool({
      name: 'typed-echo',
      description: 'A typed echo tool',
      parameters: {
        text: { type: 'string', required: true },
        uppercase: { type: 'boolean' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        // args is typed: { text: string; uppercase?: boolean }
        /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
        const result = args.uppercase ? args.text.toUpperCase() : args.text
        return result
      },
    })

    ctx.tools.register(tool)
    expect(ctx.tools.schemas()).toEqual([{
      name: 'typed-echo',
      description: 'A typed echo tool',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          uppercase: { type: 'boolean' },
        },
        required: ['text'],
      },
    }])

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('c1'),
      name: 'typed-echo',
      arguments: { text: 'hello', uppercase: true },
    })
    expect(result.isError).toBe(false)
    expect(result.isError ? undefined : result.value).toBe('HELLO')
    expect(result.content).toEqual([{ type: 'text', text: 'HELLO' }])
  })

  it('type-level: InferArgs maps required properties to non-optional', () => {
    // Compile-time check: if this compiles, InferArgs is correct.
    // args.a is string (required), args.b is number|undefined (optional).
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineTool({
      name: 'type-check',
      description: '',
      parameters: { a: { type: 'string' as const, required: true as const }, b: { type: 'number' as const } },
      output: { schema: { type: 'string' }, render: () => [] },
      async execute(args) {
        expect(typeof args.a).toBe('string')
        void args
        return args.a
      },
    })
    void tool
  })

  it('registry round-trips a defineTool definition (register→schemas→execute)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'roundtrip',
      description: 'Round-trip test',
      parameters: {
        req: { type: 'string', required: true },
        opt: { type: 'number', description: 'Optional number' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        return `${args.req}:${args.opt ?? 'none'}`
      },
    }))

    // Schema round-trip: schemas() returns standard JSON Schema
    /** 中文说明：测试局部值 schemas，由紧邻初始化决定。 */
    const schemas = ctx.tools.schemas()
    expect(schemas).toHaveLength(1)
    expect(schemas[0]!.parameters).toEqual({
      type: 'object',
      properties: {
        req: { type: 'string' },
        opt: { type: 'number', description: 'Optional number' },
      },
      required: ['req'],
    })

    // Execution round-trip
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('c1'),
      name: 'roundtrip',
      arguments: { req: 'hello' },
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'hello:none' }])
  })

  it('still accepts raw JSON-Schema ToolDefinition directly (MCP interop)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      name: 'raw-tool',
      description: 'Raw JSON Schema tool (like an MCP adapter would register)',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value as string }],
      },
      async execute(args: unknown) {
        /** 中文说明：测试局部值 p，由紧邻初始化决定。 */
        const p = args as { path: string }
        return p.path
      },
    })

    /** 中文说明：测试局部值 schemas，由紧邻初始化决定。 */
    const schemas = ctx.tools.schemas()
    expect(schemas[0]!.parameters).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    })

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('c1'),
      name: 'raw-tool',
      arguments: { path: '/tmp' },
    })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: '/tmp' }])
  })
})

describe('schema DSL edge cases', () => {
  it('emits enum values in JSON Schema property', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      color: { type: 'string', enum: ['red', 'green', 'blue'], description: 'Color choice' },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['color']).toMatchObject({
      type: 'string',
      enum: ['red', 'green', 'blue'],
      description: 'Color choice',
    })
  })

  it('emits default value in JSON Schema property', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      limit: { type: 'number', default: 25 },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['limit']).toMatchObject({
      type: 'number',
      default: 25,
    })
  })

  it('handles array items without nested properties (plain type array)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      tags: { type: 'array', items: { type: 'string' } },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['tags']).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('handles enum and default together in one property', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      level: { type: 'string', enum: ['low', 'high'], default: 'low' },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['level']).toMatchObject({
      type: 'string',
      enum: ['low', 'high'],
      default: 'low',
    })
  })

  it('omits description, enum, default keys when not specified', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      bare: { type: 'string' },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    /** 中文说明：测试局部值 prop，由紧邻初始化决定。 */
    const prop = jsonSchema.properties['bare'] as Record<string, unknown>
    expect(prop).toEqual({ type: 'string' })
    expect('description' in prop).toBe(false)
    expect('enum' in prop).toBe(false)
    expect('default' in prop).toBe(false)
  })

  it('handles array with no items (items omitted)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      raw: { type: 'array' },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['raw']).toEqual({
      type: 'array',
    })
  })

  it('handles nested object with all-optional properties (no required array)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      config: {
        type: 'object',
        additionalProperties: true,
        properties: {
          host: { type: 'string' },
          port: { type: 'number' },
        },
      },
    } satisfies ParameterSchemaSpec
    /** 中文说明：测试局部值 jsonSchema，由紧邻初始化决定。 */
    const jsonSchema = parameterSchemaSpecToJsonSchema(spec)
    expect(jsonSchema.properties['config']).toMatchObject({
      type: 'object',
      properties: {
        host: { type: 'string' },
        port: { type: 'number' },
      },
    })
    /** 中文说明：测试局部值 config，由紧邻初始化决定。 */
    const config = jsonSchema.properties['config'] as Record<string, unknown>
    expect('required' in config).toBe(false)
  })
})

describe('schema DSL optional and nested contracts', () => {
  it('InferArgs makes non-required keys genuinely optional (omittable)', () => {
    /** 中文说明：类型或类 Args 约束服务或测试数据职责。 */
    type Args = InferArgs<{
      path: { type: 'string'; required: true }
      limit: { type: 'number' }
    }>
    expectTypeOf<Args>().toEqualTypeOf<{ path: string; limit?: number }>()
    /** 中文说明：测试局部值 omitted，由紧邻初始化决定。 */
    const omitted: Args = { path: '/tmp' }
    expect(omitted.limit).toBeUndefined()
  })

  it('InferArgs recurses into array items, including arrays of objects', () => {
    /** 中文说明：类型或类 Args 约束服务或测试数据职责。 */
    type Args = InferArgs<{
      names: { type: 'array'; required: true; items: { type: 'string' } }
      servers: {
        type: 'array'
        items: {
          type: 'object'
          additionalProperties: true
          properties: {
            host: { type: 'string'; required: true }
            port: { type: 'number' }
          }
        }
      }
    }>
    expectTypeOf<Args>().toEqualTypeOf<{
      names: string[]
      servers?: ({ host: string; port?: number } & Record<string, JsonValue>)[]
    }>()
  })

  it('runtime JSON Schema matches the array-of-objects inference', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      servers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            host: { type: 'string', required: true },
            port: { type: 'number' },
          },
        },
      },
    } satisfies ParameterSchemaSpec
    expect(parameterSchemaSpecToJsonSchema(spec)).toEqual({
      type: 'object',
      properties: {
        servers: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              host: { type: 'string' },
              port: { type: 'number' },
            },
            required: ['host'],
          },
        },
      },
    })
  })

  it('reports messages from non-Error throws (throw { message })', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'object-thrower',
      async execute() {
        // testing non-Error throws on purpose
        throw { message: 'denied by object' }
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'object-thrower', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: denied by object' })
  })

  it('reports messages from throws of non-objects (throw "string")', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'string-thrower',
      async execute() {
        // testing primitive throws on purpose
        throw 'kaboom'
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'string-thrower', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Error: kaboom' })
  })

  it('reports messages from throws of objects without message property', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'object-no-message',
      async execute() {
        // testing object throw without .message
        throw { code: 500 }
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'object-no-message', arguments: {} })
    expect(result.isError).toBe(true)
    /** 中文说明：测试局部值 firstContent，由紧邻初始化决定。 */
    const firstContent = result.content[0]!
    expect(firstContent.type).toBe('text')
    if (firstContent.type === 'text') {
      expect(firstContent.text).toBe('Error: [object Object]')
    }
  })
})

describe('ToolRuntime.get', () => {
  it('get() returns the registered tool definition', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(echoTool)
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = ctx.tools.get('echo')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('echo')
  })

  it('get() returns undefined for unknown tool names', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    expect(ctx.tools.get('nope')).toBeUndefined()
  })
})

describe('validateArgs (the runtime-validation Agent Note, part 1)', () => {
  it('returns [] for valid args and is total over malformed input', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      path: { type: 'string', required: true },
      limit: { type: 'number' },
    } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { path: '/tmp' })).toEqual([])
    expect(validateArgs(spec, { path: '/tmp', limit: 5 })).toEqual([])
    // never throws regardless of shape
    expect(validateArgs(spec, null)).toHaveLength(1)
    expect(validateArgs(spec, 'nope')).toHaveLength(1)
    expect(validateArgs(spec, [])).toHaveLength(1)
  })

  it('flags a missing required key and a required key present as undefined', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { path: { type: 'string', required: true } } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, {})).toEqual(['missing required property "path"'])
    expect(validateArgs(spec, { path: undefined })).toEqual(['missing required property "path"'])
  })

  it('allows extra keys (no additionalProperties:false) and omitted optionals', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { path: { type: 'string', required: true } } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { path: '/tmp', extra: 1 })).toEqual([])
  })

  it('does not apply defaults (validation only)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { limit: { type: 'number', default: 25 } } satisfies ParameterSchemaSpec
    // absent optional is valid, and validation does not synthesize the default
    expect(validateArgs(spec, {})).toEqual([])
  })

  it('type-checks primitives', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      s: { type: 'string' },
      n: { type: 'number' },
      b: { type: 'boolean' },
    } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { s: 1 })).toEqual(['"s" must be a string'])
    expect(validateArgs(spec, { n: 'x' })).toEqual(['"n" must be a number'])
    expect(validateArgs(spec, { b: 'x' })).toEqual(['"b" must be a boolean'])
  })

  it('checks enum membership', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { color: { type: 'string', enum: ['red', 'green'] } } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { color: 'red' })).toEqual([])
    expect(validateArgs(spec, { color: 'blue' })).toEqual(['"color" must be one of ["red","green"]'])
  })

  it('enforces type-correct scalar enum declarations', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { n: { type: 'number', enum: [1, 2] } } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { n: 1 })).toEqual([])
    expect(validateArgs(spec, { n: 3 })).toEqual(['"n" must be one of [1,2]'])
    /** 中文说明：测试局部值 invalid，由紧邻初始化决定。 */
    const invalid = { n: { type: 'number', enum: ['1', '2'] } } as unknown as ParameterSchemaSpec
    expect(() => validateArgs(invalid, { n: 1 })).toThrow(JsonSchemaError)
  })

  it('rejects an unknown schema type at the author boundary', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = { x: { type: 'weird' } } as unknown as ParameterSchemaSpec
    expect(() => validateArgs(spec, { x: 1 })).toThrow(JsonSchemaError)
  })

  it('recurses into nested objects (and an object without properties only type-checks)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      config: {
        type: 'object',
        additionalProperties: true,
        required: true,
        properties: { host: { type: 'string', required: true }, port: { type: 'number' } },
      },
      bag: { type: 'object', additionalProperties: true },
    } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { config: { host: 'h' }, bag: { anything: true } })).toEqual([])
    expect(validateArgs(spec, { config: { port: 9 }, bag: 5 })).toEqual([
      'missing required property "config.host"',
      '"bag" must be an object',
    ])
  })

  it('recurses into array items (and an array without items only type-checks)', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      tags: { type: 'array', items: { type: 'string' } },
      raw: { type: 'array' },
    } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { tags: ['a', 'b'], raw: [1, {}, 'x'] })).toEqual([])
    expect(validateArgs(spec, { tags: ['a', 2] })).toEqual(['"tags[1]" must be a string'])
    // a non-array value for an array-typed prop
    expect(validateArgs(spec, { tags: 'nope' })).toEqual(['"tags" must be an array'])
  })

  it('validates arrays of objects element-wise', () => {
    /** 中文说明：测试局部值 spec，由紧邻初始化决定。 */
    const spec = {
      servers: {
        type: 'array',
        items: { type: 'object', additionalProperties: true, properties: { host: { type: 'string', required: true } } },
      },
    } satisfies ParameterSchemaSpec
    expect(validateArgs(spec, { servers: [{ host: 'a' }, {}] })).toEqual([
      'missing required property "servers[1].host"',
    ])
  })
})

describe('defineTool validation (the runtime-validation Agent Note, part 1)', () => {
  it('returns an isError result with the violations when the model sends bad args', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'reader',
      description: 'reads a path',
      parameters: { path: { type: 'string', required: true } },
      async execute(args) {
        return [{ type: 'text', text: args.path }]
      },
    }))

    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'reader', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({
      text: 'Error: invalid arguments: missing required property "path"',
    })
  })

  it('runs execute normally when args are valid', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'reader',
      description: 'reads a path',
      parameters: { path: { type: 'string', required: true } },
      async execute(args) {
        return [{ type: 'text', text: `read ${args.path}` }]
      },
    }))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'reader', arguments: { path: '/x' } })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'read /x' }],
      isError: false,
      value: [{ type: 'text', text: 'read /x' }],
    })
  })

  it('ToolArgsError carries a stable code and the violation list', () => {
    /** 中文说明：测试局部值 err，由紧邻初始化决定。 */
    const err = new ToolArgsError(['missing required property "a"', '"b" must be a number'])
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('ToolArgsError')
    expect(err.code).toBe('INVALID_ARGS')
    expect(err.violations).toEqual(['missing required property "a"', '"b" must be a number'])
    expect(err.message).toBe('invalid arguments: missing required property "a"; "b" must be a number')
  })

  it('a schema-invalid call surfaces the structured error on the result', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'reader',
      description: 'reads a path',
      parameters: { path: { type: 'string', required: true } },
      async execute(args) {
        return [{ type: 'text', text: args.path }]
      },
    }))
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'reader', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'invalid arguments: missing required property "path"',
      info: { name: 'ToolArgsError', code: 'INVALID_ARGS' },
    })
  })

  it('a tool throwing a HarnessError surfaces its name and code', async () => {
    /** 中文说明：测试局部值 { HarnessError }，由紧邻初始化决定。 */
    const { HarnessError } = await import('@deepseek-ai/dsh-llm')
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'coded',
      async execute() {
        throw new HarnessError('disk full', 'ENOSPC')
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'coded', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({ message: 'disk full', info: { name: 'HarnessError', code: 'ENOSPC' } })
    expect(result.content[0]).toMatchObject({ text: 'Error: disk full' })
  })

  it('a non-HarnessError throw retains only its message', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register({
      ...echoTool,
      name: 'plain',
      async execute() {
        throw new Error('just a message')
      },
    })
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'plain', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({ message: 'just a message' })
    expect(result.content[0]).toMatchObject({ text: 'Error: just a message' })
  })

  it('raw-registered tools are NOT validated by defineTool (MCP keeps its own)', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    // A raw ToolDefinition: no defineTool wrapping, so no validateArgs guard.
    ctx.tools.register({
      name: 'raw',
      description: 'raw tool',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value as string }],
      },
      async execute(args: unknown) {
        return typeof args
      },
    })
    // Missing the "required" path — but raw tools validate their own input, so
    // this reaches execute rather than being rejected by the harness.
    /** 中文说明：测试局部值 result，由紧邻初始化决定。 */
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: CallId('c1'), name: 'raw', arguments: {} })
    expect(result.isError).toBe(false)
  })

  it('attaches a positive-finite timeoutMs to the definition', () => {
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineContentToolFixture({
      name: 'x', description: 'd', parameters: {}, timeoutMs: 30_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    })
    expect(tool.timeoutMs).toBe(30_000)
  })

  it('omits timeoutMs when not declared', () => {
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineContentToolFixture({
      name: 'x', description: 'd', parameters: {},
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    })
    expect(tool.timeoutMs).toBeUndefined()
  })

  it('throws when timeoutMs is zero or negative', () => {
    /** 中文说明：测试局部值 make，由紧邻初始化决定。 */
    const make = (ms: number) => defineContentToolFixture({
      name: 'x', description: 'd', parameters: {}, timeoutMs: ms,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    })
    expect(() => make(0)).toThrow('timeoutMs must be a positive finite number')
    expect(() => make(-5)).toThrow('positive finite number')
  })

  it('throws when timeoutMs is non-finite', () => {
    expect(() => defineContentToolFixture({
      name: 'x', description: 'd', parameters: {}, timeoutMs: Infinity,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    })).toThrow('positive finite number')
  })
})

describe('defineTool presentation (presentCall / presentResult)', () => {
  it('preserves inline enum and const literals in inferred arguments', () => {
    defineTool({
      name: 'literal-args',
      description: 'literal arguments',
      parameters: {
        mode: { type: 'string', enum: ['read', 'write'], required: true },
        attempt: { type: 'integer', const: 1 },
      },
      output: {
        schema: { type: 'null' },
        render: () => [],
      },
      async execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ mode: 'read' | 'write'; attempt?: 1 }>()
        return null
      },
    })
  })

  it('threads presentCall/presentResult onto the ToolDefinition with typed args', () => {
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineContentToolFixture({
      name: 'demo',
      description: 'demo',
      parameters: { path: { type: 'string', required: true }, n: { type: 'number' } },
      async execute() { return [{ type: 'text', text: 'ok' }] },
      presentCall(args) {
        // args is typed { path: string; n?: number } — zero casts.
        expectTypeOf(args).toEqualTypeOf<{ path: string; n?: number }>()
        return { card: 'generic', title: `Open ${args.path}`, kind: 'read', rawInput: args.path }
      },
      presentResult(args, result) {
        return { card: 'generic', title: `Opened ${args.path}`, content: result.content }
      },
    })
    expect(tool.presentCall!({ path: '/a', n: 2 })).toEqual({ card: 'generic', title: 'Open /a', kind: 'read', rawInput: '/a' })
    expect(tool.presentResult!({ path: '/a' }, { content: [{ type: 'text', text: 'x' }], isError: false }))
      .toEqual({ card: 'generic', title: 'Opened /a', content: [{ type: 'text', text: 'x' }] })
  })

  it('a tool without presentCall/presentResult leaves them undefined (UI falls back generically)', () => {
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineContentToolFixture({
      name: 'plain',
      description: 'plain',
      parameters: { x: { type: 'string', required: true } },
      async execute() { return [] },
    })
    expect(typeof tool.presentCall).toBe('undefined')
    expect(typeof tool.presentResult).toBe('undefined')
  })

  it('presentCall/presentResult validate softly: malformed args return undefined, never throw (display runs on replay)', () => {
    /** 中文说明：测试局部值 tool，由紧邻初始化决定。 */
    const tool = defineContentToolFixture({
      name: 'demo',
      description: 'demo',
      parameters: { path: { type: 'string', required: true } },
      async execute() { return [] },
      presentCall: args => ({ card: 'generic', title: args.path }),
      presentResult: (args, result) => ({ card: 'generic', title: args.path, content: result.content }),
    })
    // Unlike execute (which throws ToolArgsError on a mismatch), the display
    // methods soft-validate and fall back to undefined so a UI never crashes
    // replaying an old/foreign log entry. The ToolDefinition methods take
    // `unknown`, so malformed shapes pass without a cast.
    expect(tool.presentCall?.({})).toBeUndefined()
    expect(tool.presentResult?.({ wrong: 1 }, { content: [], isError: false })).toBeUndefined()
  })
})
