/**
 * Property-based tests for the BlockAssembler (the property-testing Agent Note).
 *
 * The assembler is protocol-shaped: arbitrary interleavings of block-start,
 * deltas, block-end, usage, and finish — valid and malformed (duplicate
 * indices, stragglers after block-end, missing block-start, delta-only). The
 * invariants below are the contract the agent loop relies on.
 */
/*
 * 文件职责：验证 properties.spec.ts 覆盖的 LLM 配置、调用与事件处理行为。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件上下文和可控测试替身验证运行时协作。
 * 产品维度：保障模型接入在配置变化、认证、重试与异常场景下仍能给 Agent 稳定反馈。
 * 逻辑维度：准备上下文与测试数据，触发被测流程，再核对请求、事件、结果和清理行为。
 * 关键边界：测试替身必须保持确定性；敏感凭据不可写入日志；异步资源必须在用例结束时释放。
 * 新手阅读建议：先看测试数据和辅助函数，再按 describe/it 场景阅读，最后对照被测插件实现。
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

// A small pool of indices so collisions (duplicate-index bugs) are common.
/** 中文说明：变量 indexArb 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const indexArb = fc.integer({ min: 0, max: 4 })

/** 中文说明：函数值 blockEndArb 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const blockEndArb = (index: number): fc.Arbitrary<StreamChunk> => fc.oneof(
  fc.record({ text: fc.string() }).map((r): StreamChunk => (
    { type: 'block-end', index, block: { type: 'text', text: r.text } }
  )),
  fc.record({ text: fc.string() }).map((r): StreamChunk => (
    { type: 'block-end', index, block: { type: 'reasoning', text: r.text } }
  )),
  fc.record({ id: fc.string({ minLength: 1 }), name: fc.string(), args: fc.string() }).map((r): StreamChunk => (
    { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(r.id), name: r.name, arguments: r.args } }
  )),
)

/** One arbitrary chunk over the small index pool — valid and malformed mixes. */
/* 中文说明：函数值 chunkArb 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
const chunkArb: fc.Arbitrary<StreamChunk> = indexArb.chain(index => fc.oneof(
  fc.constant<StreamChunk>({ type: 'block-start', index, blockType: 'text' }),
  fc.constant<StreamChunk>({ type: 'block-start', index, blockType: 'reasoning' }),
  fc.constant<StreamChunk>({ type: 'block-start', index, blockType: 'tool-call' }),
  fc.string().map((text): StreamChunk => ({ type: 'text-delta', index, text })),
  fc.string().map((text): StreamChunk => ({ type: 'reasoning-delta', index, text })),
  fc.record({ id: fc.string({ minLength: 1 }), argumentsDelta: fc.string() })
    .map((r): StreamChunk => ({ type: 'tool-call-delta', index, id: ToolCallId(r.id), argumentsDelta: r.argumentsDelta })),
  blockEndArb(index),
  fc.constant<StreamChunk>({ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }),
  fc.constant<StreamChunk>({ type: 'finish', reason: { kind: 'stop' } }),
  fc.constant<StreamChunk>({ type: 'finish', reason: { kind: 'tool-calls' } }),
  fc.string({ minLength: 1 }).map((message): StreamChunk => ({
    type: 'finish',
    reason: { kind: 'error', failure: { message, code: 'UNKNOWN' } },
  })),
))

/** A stream is an arbitrary list of chunks (we do NOT force a terminal finish). */
/* 中文说明：变量 streamArb 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
const streamArb = fc.array(chunkArb, { maxLength: 30 })

/** Feed a fresh assembler, return it. */
/* 中文说明：函数 feed 承担本测试场景中的准备或验证工作；参数按签名传入，返回值供后续断言使用；示例见本文件调用。 */
function feed(chunks: StreamChunk[]): BlockAssembler {
  /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const a = new BlockAssembler()
  /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
  for (const chunk of chunks) a.push(chunk)
  return a
}

describe('BlockAssembler properties', () => {
  it('partials map size never exceeds the number of distinct indices seen', () => {
    fc.assert(fc.property(streamArb, (chunks) => {
      /** 中文说明：变量 distinct 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const distinct = new Set<number>()
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for (const chunk of chunks) {
        if ('index' in chunk) distinct.add(chunk.index)
      }
      /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const a = feed(chunks)
      // blocks() length equals the number of distinct indices that became
      // partials (block-bearing chunks). It can never exceed distinct indices.
      expect(a.blocks().length).toBeLessThanOrEqual(distinct.size)
    }))
  })

  it('re-assembly is idempotent: blocks() is stable across repeated calls', () => {
    fc.assert(fc.property(streamArb, (chunks) => {
      /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const a = feed(chunks)
      expect(a.blocks()).toEqual(a.blocks())
      // And message().content mirrors blocks().
      expect(a.message().content).toEqual(a.blocks())
    }))
  })

  it('blocks() never throws and yields only valid content-block tags', () => {
    fc.assert(fc.property(streamArb, (chunks) => {
      /** 中文说明：变量 blocks 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const blocks = feed(chunks).blocks()
      /** 中文说明：该循环依次处理场景数据；循环变量仅在当前循环中有效。 */
      for (const block of blocks) {
        expect(['text', 'reasoning', 'tool-call', 'tool-result']).toContain(block.type)
      }
    }))
  })

  it('finish reflects the last finish chunk, or defaults to stop when none arrives', () => {
    fc.assert(fc.property(streamArb, (chunks) => {
      /** 中文说明：变量 a 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
      const a = feed(chunks)
      /** 中文说明：函数值 finishes 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const finishes = chunks.filter(c => c.type === 'finish')
      if (finishes.length === 0) {
        expect(a.finish).toEqual({ kind: 'stop' })
      } else {
        // last-write-wins: the assembler keeps the most recent finish reason.
        /** 中文说明：变量 last 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
        const last = finishes[finishes.length - 1]
        if (last?.type === 'finish') expect(a.finish).toEqual(last.reason)
      }
    }))
  })
})
