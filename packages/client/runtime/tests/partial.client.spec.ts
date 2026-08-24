/**
 * PartialAccumulator: six-variant chunk folding, sparse-index compaction, and
 * the block/snapshot reference discipline (a delta swaps only that block).
 */
/**
 * 文件职责：验证客户端会话运行时的 partial 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */

import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-api-remotes/client'
import { PartialAccumulator } from '../src/client/sessions/partial.ts'

/** 中文说明：测试场景的局部值 chunk，取值由紧邻初始化决定，仅在当前作用域使用。 */
const chunk = (c: Record<string, unknown>): StreamChunk => c as unknown as StreamChunk

describe('PartialAccumulator', () => {
  it('builds empty blocks per block-start type, unknown type falls to other', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'block-start', index: 0, blockType: 'text' }))
    acc.push(chunk({ type: 'block-start', index: 1, blockType: 'reasoning' }))
    acc.push(chunk({ type: 'block-start', index: 2, blockType: 'tool-call' }))
    acc.push(chunk({ type: 'block-start', index: 3, blockType: 'no-such' }))
    expect(acc.toPartial().blocks).toEqual([
      { kind: 'text', text: '' },
      { kind: 'reasoning', text: '' },
      { kind: 'tool-call', callId: '', name: '', argsRaw: '' },
      { kind: 'other', block: null },
    ])
  })

  it('accumulates text deltas, starting from empty when prev is missing or another kind', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'text-delta', index: 0, text: '无 start ' })) // prev missing
    acc.push(chunk({ type: 'text-delta', index: 0, text: '也累积' }))
    expect(acc.toPartial().blocks).toEqual([{ kind: 'text', text: '无 start 也累积' }])
    acc.push(chunk({ type: 'reasoning-delta', index: 0, text: '换型重起' })) // prev is text → restart
    expect(acc.toPartial().blocks).toEqual([{ kind: 'reasoning', text: '换型重起' }])
  })

  it('accumulates reasoning deltas on the reasoning lane', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'block-start', index: 0, blockType: 'reasoning' }))
    acc.push(chunk({ type: 'reasoning-delta', index: 0, text: '思' }))
    acc.push(chunk({ type: 'reasoning-delta', index: 0, text: '考' }))
    expect(acc.toPartial().blocks).toEqual([{ kind: 'reasoning', text: '思考' }])
  })

  it('continues from a materialized history prefix', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0, [{ kind: 'text', text: '已有' }])
    acc.push(chunk({ type: 'text-delta', index: 0, text: '增量' }))
    expect(acc.toPartial().blocks).toEqual([{ kind: 'text', text: '已有增量' }])
  })

  it('folds tool-call deltas: first id pins callId, late name overrides, argsRaw concatenates', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '{"a"' }))
    acc.push(chunk({ type: 'tool-call-delta', index: 0, id: 'c2-late', name: 'echo', argumentsDelta: ':1}' }))
    expect(acc.toPartial().blocks).toEqual([
      { kind: 'tool-call', callId: 'c1', name: 'echo', argsRaw: '{"a":1}' },
    ])
  })

  it('replaces the accumulated block wholesale on block-end', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'text-delta', index: 0, text: '中间态' }))
    acc.push(chunk({ type: 'block-end', index: 0, block: { type: 'text', text: '定稿全文' } }))
    expect(acc.toPartial().blocks).toEqual([{ kind: 'text', text: '定稿全文' }])
  })

  it('returns false (no notification) for usage/finish/unknown variants and keeps blocks', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'text-delta', index: 0, text: 'x' }))
    /** 中文说明：测试场景的局部值 before，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const before = acc.toPartial()
    expect(acc.push(chunk({ type: 'usage', usage: {} }))).toBe(false)
    expect(acc.push(chunk({ type: 'finish', reason: 'stop' }))).toBe(false)
    expect(acc.push(chunk({ type: 'future-variant' }))).toBe(false)
    expect(acc.toPartial()).toBe(before) // unchanged: same snapshot reference
  })

  it('compacts sparse indexes into a dense render-order array', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(1, 0)
    acc.push(chunk({ type: 'block-start', index: 2, blockType: 'text' }))
    acc.push(chunk({ type: 'text-delta', index: 2, text: '先到的高位' }))
    acc.push(chunk({ type: 'block-start', index: 0, blockType: 'reasoning' }))
    /** 中文说明：测试场景的局部值 { blocks }，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const { blocks } = acc.toPartial()
    expect(blocks).toHaveLength(2) // no undefined holes
    expect(blocks[0]).toEqual({ kind: 'reasoning', text: '' })
    expect(blocks[1]).toEqual({ kind: 'text', text: '先到的高位' })
  })

  it('keeps the snapshot reference stable without changes and swaps it once per mutation', () => {
    /** 中文说明：测试场景的局部值 acc，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const acc = new PartialAccumulator(3, 1)
    /** 中文说明：测试场景的局部值 first，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const first = acc.toPartial()
    expect(first).toMatchObject({ turn: 3, step: 1, blocks: [] })
    expect(acc.toPartial()).toBe(first)
    acc.push(chunk({ type: 'text-delta', index: 0, text: 'a' }))
    /** 中文说明：测试场景的局部值 second，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const second = acc.toPartial()
    expect(second).not.toBe(first)
    expect(acc.toPartial()).toBe(second)
  })
})
