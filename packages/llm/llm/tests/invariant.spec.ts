/**
 * 文件职责：验证 invariant.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmInvariant from '@deepseek-ai/dsh-llm/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

/** 中文说明：函数 setup 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function setup(): Promise<Context> {
  /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(LlmInvariant)
  return ctx
}

/** 中文说明：变量 options 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const options: GenerateOptions = { provider: 'mock', model: 'mock', messages: [] }

async function* source(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  yield* chunks
}

/** 中文说明：函数 consume 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
async function consume(ctx: Context, chunks: readonly StreamChunk[]): Promise<StreamChunk[]> {
  /** 中文说明：函数值 stream 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const stream = ctx.waterfall(ctx as never, 'llm/stream', options, () => source(chunks))
  /** 中文说明：变量 consumed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const consumed: StreamChunk[] = []
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for await (const chunk of stream) consumed.push(chunk)
  return consumed
}

/** 中文说明：变量 finish 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

describe('LLM stream invariants', () => {
  it('accepts a complete interleaved stream grammar', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 chunks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'a' },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'b' },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'b' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'a' } },
      { type: 'block-start', index: 2, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 2, id: CallId('c1'), name: 'echo', argumentsDelta: '{}' },
      { type: 'block-end', index: 2, block: { type: 'tool-call', id: CallId('c1'), name: 'echo', arguments: '{}' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      finish,
    ]
    await expect(consume(ctx, chunks)).resolves.toEqual(chunks)
  })

  it.each([
    [[{ type: 'block-start', index: -1, blockType: 'text' }, finish], /non-negative safe integer/],
    [[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 0, blockType: 'text' },
    ], /repeated block-start/],
    [[{ type: 'text-delta', index: 0, text: 'x' }], /requires an open text block/],
    [[
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'text-delta', index: 0, text: 'x' },
    ], /got reasoning/],
    [[{ type: 'block-end', index: 0, block: { type: 'text', text: '' } }], /has no open block/],
    [[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: '' } },
    ], /closes reasoning, expected text/],
    [[
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    ], /usage more than once/],
    [[{ type: 'block-start', index: 0, blockType: 'text' }, finish], /finished with 1 open block/],
    [[finish, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }], /usage after terminal finish/],
    [[], /ended without a terminal finish/],
  ] as Array<[StreamChunk[], RegExp]>)('rejects malformed stream %#', async (chunks, message) => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    await expect(consume(ctx, chunks)).rejects.toThrow(message)
  })

  it('preserves provider exceptions without inventing a missing-finish failure', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    /** 中文说明：变量 stream 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const stream = ctx.waterfall(ctx as never, 'llm/stream', options, async function* () {
      throw new Error('provider failed')
    })
    await expect((async () => {
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for await (const _chunk of stream) { /* consume */ }
    })()).rejects.toThrow('provider failed')
  })
})

describe('adapters-updated invariants', () => {
  /** 中文说明：class NoopAdapter 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
  class NoopAdapter extends LlmAdapter {

    async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      throw new Error('not exercised')
    }
  }

  it('accepts a coherent registry at every topology notification', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    await ctx.plugin(LlmRuntime)
    /** 中文说明：变量 dispose 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const dispose = ctx.llm.registerAdapter(['coherent'], new NoopAdapter())
    ctx.llm.registerConfigurableProviders([
      { provider: 'dormant', displayName: 'Dormant', settingsNs: 'ns', settingsPath: [] },
    ])
    dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('skips the check when the service store has no llm entry', async () => {
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    expect(() => { ctx.emit('llm/adapters-updated') }).not.toThrow()
  })

  it('reports a notification whose registry cannot be re-read', async () => {
    /** 中文说明：class BrokenLlm 定义本测试所需的数据或行为，用于表达模型调用相关场景。 */
    class BrokenLlm extends LlmRuntime {
      override providerRetryPolicy(_provider: string): never {
        throw new Error('registration vanished')
      }
    }
    /** 中文说明：变量 ctx 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ctx = await setup()
    await ctx.plugin(BrokenLlm)
    expect(() => ctx.llm.registerAdapter(['ghost'], new NoopAdapter()))
      .toThrow(/no readable registration/)
  })
})
