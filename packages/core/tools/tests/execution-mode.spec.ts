/** Covers fail-closed per-call classification and model-schema isolation. */
/**
 * 文件职责：验证工具注册与执行的 execution-mode.spec.ts 行为与边界。
 * 技术维度：TypeScript、Cordis、Vitest、会话事件、JSON 模式和服务作用域。
 * 产品维度：保证工具注册与执行在配置、错误、恢复和生命周期场景中可靠。
 * 逻辑维度：构造输入并驱动服务，再断言输出、日志和清理。
 * 关键边界：持久与凭据数据属于不可信边界；工具和提示词必须保持模型可见内容可重建。
 * 新手阅读建议：先读类型和夹具，再按正常、非法输入、作用域和清理场景阅读。
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineContentToolFixture,
  /** 中文说明：类型或类 ToolDefinition 约束服务或测试数据职责。 */
  type ToolDefinition,
  /** 中文说明：类型或类 ToolExecutionInput 约束服务或测试数据职责。 */
  type ToolExecutionInput,
  /** 中文说明：类型或类 ToolExecutionMode 约束服务或测试数据职责。 */
  type ToolExecutionMode,
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

/** 中文说明：函数 exec 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function exec(name: string, args: unknown): ToolExecutionInput {
  return { signal: testToolSignal, callId: CallId('c1'), name, arguments: args }
}

describe('ToolRuntime.executionMode', () => {
  it('returns parallel only for an explicit true classifier', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'safe',
      description: 'parallel-safe',
      parameters: {},
      isConcurrencySafe: () => true,
      async execute() { return [] },
    }))
    expect(ctx.tools.executionMode(exec('safe', {}))).toEqual({ kind: 'parallel' })
  })

  it('defaults to exclusive for a tool with no isConcurrencySafe declaration', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'plain',
      description: 'no declaration',
      parameters: {},
      async execute() { return [] },
    }))
    expect(ctx.tools.executionMode(exec('plain', {}))).toEqual({ kind: 'exclusive' })
  })

  it('returns exclusive for an unknown tool', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    expect(ctx.tools.executionMode(exec('nonexistent', {}))).toEqual({ kind: 'exclusive' })
  })

  it('returns exclusive when the classifier returns false for these args', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'rw',
      description: 'read or write',
      parameters: { mode: { type: 'string', required: true } },
      isConcurrencySafe: args => args.mode === 'read',
      async execute() { return [] },
    }))
    expect(ctx.tools.executionMode(exec('rw', { mode: 'read' }))).toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode(exec('rw', { mode: 'write' }))).toEqual({ kind: 'exclusive' })
  })

  it('classifies invalid defineContentToolFixture arguments as exclusive without throwing', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'needs-mode',
      description: 'requires mode',
      parameters: { mode: { type: 'string', required: true } },
      isConcurrencySafe: () => true,
      async execute() { return [] },
    }))
    expect(ctx.tools.executionMode(exec('needs-mode', {}))).toEqual({ kind: 'exclusive' })
  })

  it('treats a throwing raw classifier as exclusive', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 raw，由紧邻初始化决定。 */
    const raw: ToolDefinition = {
      name: 'thrower',
      description: 'classifier throws',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'null' }, render: () => [] },
      isConcurrencySafe() { throw new Error('boom') },
      async execute() { return null },
    }
    ctx.tools.register(raw)
    expect(ctx.tools.executionMode(exec('thrower', {}))).toEqual({ kind: 'exclusive' })
  })

  it('treats a truthy non-boolean raw result as exclusive', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 raw，由紧邻初始化决定。 */
    const raw = {
      name: 'truthy',
      description: 'classifier returns a truthy string',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'null' }, render: () => [] },
      isConcurrencySafe() { return 'yes' },
      async execute() { return null },
    } as unknown as ToolDefinition
    ctx.tools.register(raw)
    expect(ctx.tools.executionMode(exec('truthy', {}))).toEqual({ kind: 'exclusive' })
  })

  it('passes parsed arguments directly to a raw definition', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    /** 中文说明：测试局部值 seen: unknown，由紧邻初始化决定。 */
    let seen: unknown
    ctx.tools.register({
      name: 'raw-safe',
      description: 'raw',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'null' }, render: () => [] },
      isConcurrencySafe(args) { seen = args; return true },
      async execute() { return null },
    })
    expect(ctx.tools.executionMode(exec('raw-safe', { anything: 1 }))).toEqual({ kind: 'parallel' })
    expect(seen).toEqual({ anything: 1 })
  })

  it('isConcurrencySafe never reaches the model-facing schemas() projection', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = await setup()
    ctx.tools.register(defineContentToolFixture({
      name: 'safe',
      description: 'parallel-safe',
      parameters: { x: { type: 'string', required: true } },
      isConcurrencySafe: () => true,
      async execute() { return [] },
    }))
    /** 中文说明：测试局部值 schema，由紧邻初始化决定。 */
    const schema = ctx.tools.schemas()[0] as unknown as Record<string, unknown>
    expect(Object.keys(schema).sort()).toEqual(['description', 'name', 'parameters'])
    expect(schema.isConcurrencySafe).toBeUndefined()
  })

  it('ToolExecutionMode is the object-tagged union', () => {
    expectTypeOf<ToolExecutionMode>().toEqualTypeOf<{ kind: 'parallel' } | { kind: 'exclusive' }>()
  })
})
