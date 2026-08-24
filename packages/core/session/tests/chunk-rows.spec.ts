/**
 * Chunk-row codec tests: pack/expand round-trip losslessness (example-based and
 * property-based), run-boundary rules, whitelist fall-through, and decoder
 * validation failures.
 */
/**
 * 文件职责：验证Session 状态的 chunk-rows.spec.ts 行为与不变量。
 * 技术维度：Vitest、Cordis、会话事件、模型适配器和可控工具夹具。
 * 产品维度：防止Session 状态在取消、恢复、错误或并发场景中产生回归。
 * 逻辑维度：构造服务与事件，驱动执行流程，再断言日志、请求、状态和清理。
 * 关键边界：测试后台任务必须结束；模型可见输入必须可从日志重建；工具调用顺序不可破坏。
 * 新手阅读建议：先读 mock/辅助函数，再按成功、错误、恢复和生命周期场景阅读。
 */

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { decodeStorageRecord, packChunkRuns } from '@deepseek-ai/dsh-session'
import type { ChunkRow, SessionEvent, StorageRecord } from '@deepseek-ai/dsh-session'

/** Build an `assistant/chunk` event with the exact live-append shape. */
/** 中文说明：测试辅助函数 chunkEvent 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function chunkEvent(seq: number, time: number, chunk: StreamChunk, turn = 1, step = 1): SessionEvent {
  return { type: 'assistant/chunk', seq, time, data: { turn, step, chunk } }
}

/** Sequential delta events (contiguous seqs, fixed 10ms gaps) of one kind. */
/** 中文说明：测试辅助函数 deltaRun 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function deltaRun(kind: 'text-delta' | 'reasoning-delta', count: number, seq0 = 0, index = 0): SessionEvent[] {
  return Array.from({ length: count }, (_, k) =>
    chunkEvent(seq0 + k, 1000 + 10 * k, { type: kind, index, text: `t${k}` }))
}

/** Decode a packed record list back to a flat event list. */
/** 中文说明：测试辅助函数 decodeAll 的参数见签名，返回值用于驱动或断言场景；示例见下方用例。 */
function decodeAll(records: readonly StorageRecord[]): SessionEvent[] {
  return records.flatMap(record => decodeStorageRecord(JSON.parse(JSON.stringify(record))))
}

describe('packChunkRuns', () => {
  it('packs a text-delta run into one text-chunks row and round-trips it', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = deltaRun('text-delta', 5)
    /** 中文说明：测试局部值 packed，由紧邻初始化决定，仅在当前场景使用。 */
    const packed = packChunkRuns(events)
    expect(packed).toHaveLength(1)
    /** 中文说明：测试局部值 row，由紧邻初始化决定，仅在当前场景使用。 */
    const row = packed[0] as ChunkRow
    expect(row.type).toBe('text-chunks')
    expect(row.seq0).toBe(0)
    expect(row.time0).toBe(1000)
    expect(row.data).toMatchObject({ turn: 1, step: 1, index: 0, dt: [10, 10, 10, 10], texts: ['t0', 't1', 't2', 't3', 't4'] })
    expect(decodeAll(packed)).toStrictEqual(events)
  })

  it('packs reasoning and tool-call runs under their own tags', () => {
    /** 中文说明：测试局部值 reasoning，由紧邻初始化决定，仅在当前场景使用。 */
    const reasoning = deltaRun('reasoning-delta', 3)
    /** 中文说明：测试局部值 toolCall，由紧邻初始化决定，仅在当前场景使用。 */
    const toolCall = [4, 5, 6].map(seq =>
      chunkEvent(seq, 1000 + seq, { type: 'tool-call-delta', index: 1, id: CallId('c1'), name: 'write', argumentsDelta: `a${seq}` }))
    /** 中文说明：测试局部值 packed，由紧邻初始化决定，仅在当前场景使用。 */
    const packed = packChunkRuns([...reasoning, ...toolCall])
    expect(packed.map(r => (r as ChunkRow).type)).toStrictEqual(['reasoning-chunks', 'tool-call-chunks'])
    /** 中文说明：测试局部值 row，由紧邻初始化决定，仅在当前场景使用。 */
    const row = packed[1] as ChunkRow & { type: 'tool-call-chunks' }
    expect(row.data).toMatchObject({ id: 'c1', name: 'write', args: ['a4', 'a5', 'a6'] })
    expect(decodeAll(packed)).toStrictEqual([...reasoning, ...toolCall])
  })

  it('packs a name-less tool-call run and round-trips field absence', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [0, 1, 2].map(seq =>
      chunkEvent(seq, 1000, { type: 'tool-call-delta', index: 0, id: CallId('c1'), argumentsDelta: `a${seq}` }))
    /** 中文说明：测试局部值 packed，由紧邻初始化决定，仅在当前场景使用。 */
    const packed = packChunkRuns(events)
    expect(packed).toHaveLength(1)
    expect(Object.hasOwn((packed[0] as ChunkRow).data, 'name')).toBe(false)
    /** 中文说明：测试局部值 decoded，由紧邻初始化决定，仅在当前场景使用。 */
    const decoded = decodeAll(packed)
    expect(decoded).toStrictEqual(events)
    expect(decoded.every(e => !Object.hasOwn((e.data as { chunk: object }).chunk, 'name'))).toBe(true)
  })

  it('leaves runs shorter than three events verbatim', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = deltaRun('text-delta', 2)
    expect(packChunkRuns(events)).toStrictEqual(events)
  })

  it('leaves non-delta chunks and non-chunk events verbatim between runs', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events: SessionEvent[] = [
      chunkEvent(0, 1000, { type: 'block-start', index: 0, blockType: 'text' }),
      ...deltaRun('text-delta', 3, 1),
      chunkEvent(4, 1040, { type: 'block-end', index: 0, block: { type: 'text', text: 't0t1t2' } }),
      { type: 'step/end', seq: 5, time: 1050, data: { turn: 1, step: 1 } },
    ]
    /** 中文说明：测试局部值 packed，由紧邻初始化决定，仅在当前场景使用。 */
    const packed = packChunkRuns(events)
    expect(packed).toHaveLength(4)
    expect((packed[1] as ChunkRow).type).toBe('text-chunks')
    expect(decodeAll(packed)).toStrictEqual(events)
  })

  it.each([
    ['a seq gap', deltaRun('text-delta', 3).map((e, k) => ({ ...e, seq: k === 2 ? 9 : e.seq }))],
    ['a kind switch', [...deltaRun('text-delta', 2), ...deltaRun('reasoning-delta', 1, 2)]],
    ['a block-index switch', [...deltaRun('text-delta', 2), ...deltaRun('text-delta', 1, 2, 7)]],
    ['a step switch', deltaRun('text-delta', 3).map((e, k) => k === 2 ? chunkEvent(e.seq, e.time, (e.data as { chunk: StreamChunk }).chunk, 1, 2) : e)],
  ])('breaks a run on %s (both halves too short to pack)', (_label, events) => {
    expect(packChunkRuns(events)).toStrictEqual(events)
  })

  it('breaks a tool-call run on call-id or name change', () => {
    /** 中文说明：测试局部值 call，由紧邻初始化决定，仅在当前场景使用。 */
    const call = (seq: number, id: string, name?: string): SessionEvent =>
      chunkEvent(seq, 1000, { type: 'tool-call-delta', index: 0, id: CallId(id), ...name !== undefined ? { name } : {}, argumentsDelta: 'a' })
    /** 中文说明：测试局部值 idSwitch，由紧邻初始化决定，仅在当前场景使用。 */
    const idSwitch = [call(0, 'c1', 'w'), call(1, 'c1', 'w'), call(2, 'c2', 'w')]
    expect(packChunkRuns(idSwitch)).toStrictEqual(idSwitch)
    /** 中文说明：测试局部值 namePresence，由紧邻初始化决定，仅在当前场景使用。 */
    const namePresence = [call(0, 'c1', 'w'), call(1, 'c1', 'w'), call(2, 'c1')]
    expect(packChunkRuns(namePresence)).toStrictEqual(namePresence)
  })

  it('stores an off-whitelist delta verbatim (extra field, bad type, fractional time)', () => {
    /** 中文说明：测试局部值 extraField，由紧邻初始化决定，仅在当前场景使用。 */
    const extraField = { ...chunkEvent(0, 1000, { type: 'text-delta', index: 0, text: 'x' }), surfaceOp: 'append' }
    /** 中文说明：测试局部值 badText，由紧邻初始化决定，仅在当前场景使用。 */
    const badText = chunkEvent(1, 1001, { type: 'text-delta', index: 0, text: 7 as unknown as string })
    /** 中文说明：测试局部值 fractionalTime，由紧邻初始化决定，仅在当前场景使用。 */
    const fractionalTime = chunkEvent(2, 1001.5, { type: 'text-delta', index: 0, text: 'y' })
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [extraField, badText, fractionalTime] as SessionEvent[]
    expect(packChunkRuns(events)).toStrictEqual(events)
  })

  it('breaks a run on a time gap beyond safe-integer range (subtraction would round)', () => {
    // Both endpoints are safe integers, but their true difference (~2^54)
    // exceeds exact double range: b - a rounds, so a + (b - a) !== b and a
    // packed row would decode to a different timestamp.
    /** 中文说明：测试局部值 a，由紧邻初始化决定，仅在当前场景使用。 */
    const a = Number.MIN_SAFE_INTEGER
    /** 中文说明：测试局部值 b，由紧邻初始化决定，仅在当前场景使用。 */
    const b = Number.MAX_SAFE_INTEGER - 1
    expect(a + (b - a)).not.toBe(b) // the rounding this guard exists for
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [
      chunkEvent(0, a, { type: 'text-delta', index: 0, text: 'x' }),
      chunkEvent(1, b, { type: 'text-delta', index: 0, text: 'y' }),
      chunkEvent(2, b + 1, { type: 'text-delta', index: 0, text: 'z' }),
    ]
    expect(packChunkRuns(events)).toStrictEqual(events) // split at the gap; halves too short
    expect(decodeAll(packChunkRuns(events))).toStrictEqual(events)
  })

  it('stores a delta with an off-whitelist data envelope verbatim (parsed-fixture shapes)', () => {
    /** 中文说明：测试局部值 mk，由紧邻初始化决定，仅在当前场景使用。 */
    const mk = (seq: number, data: unknown): SessionEvent =>
      ({ type: 'assistant/chunk', seq, time: 1000, data } as SessionEvent)
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [
      mk(0, 'not-an-object'),
      mk(1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' }, extra: 1 }),
      mk(2, { turn: 'x', step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      mk(3, { turn: 1, step: 1, chunk: 'not-an-object' }),
      mk(4, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 'x', text: 'a' } }),
      mk(5, { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 7, argumentsDelta: 'a' } }),
      mk(6, { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 0, id: 'c', name: 7, argumentsDelta: 'a' } }),
    ]
    expect(packChunkRuns(events)).toStrictEqual(events)
  })
})

describe('decodeStorageRecord', () => {
  it('passes non-row values through as single events, unvalidated', () => {
    /** 中文说明：测试局部值 event，由紧邻初始化决定，仅在当前场景使用。 */
    const event = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }
    expect(decodeStorageRecord(event)).toStrictEqual([event])
    expect(decodeStorageRecord('junk')).toStrictEqual(['junk'])
    expect(decodeStorageRecord(null)).toStrictEqual([null])
  })

  it('reconstructs timestamps through negative dt gaps (clock stepped back)', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定，仅在当前场景使用。 */
    const events = [
      chunkEvent(0, 1000, { type: 'text-delta', index: 0, text: 'a' }),
      chunkEvent(1, 990, { type: 'text-delta', index: 0, text: 'b' }),
      chunkEvent(2, 995, { type: 'text-delta', index: 0, text: 'c' }),
    ]
    expect(decodeAll(packChunkRuns(events))).toStrictEqual(events)
  })

  it.each([
    ['a non-object data', { type: 'text-chunks', seq0: 0, time0: 1, data: 'x' }],
    ['an envelope with extra keys', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a'] }, extra: 1 }],
    ['a negative seq0', { type: 'text-chunks', seq0: -1, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a'] } }],
    ['a non-finite time0', { type: 'text-chunks', seq0: 0, time0: Infinity, data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a'] } }],
    ['a fractional time0', { type: 'text-chunks', seq0: 0, time0: 1.5, data: { turn: 1, step: 1, index: 0, dt: [], texts: ['a'] } }],
    ['a data shape mismatch', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], args: ['a'] } }],
    ['a non-string member', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], texts: [7] } }],
    ['an empty member list', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], texts: [] } }],
    ['a dt arity mismatch', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [1, 2], texts: ['a', 'b'] } }],
    ['a non-finite dt gap', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [NaN], texts: ['a', 'b'] } }],
    ['a fractional dt gap', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [0.5], texts: ['a', 'b'] } }],
    ['a member seq leaving safe range', { type: 'text-chunks', seq0: Number.MAX_SAFE_INTEGER, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [0, 0], texts: ['a', 'b', 'c'] } }],
    ['a member time leaving safe range', { type: 'text-chunks', seq0: 0, time0: Number.MAX_SAFE_INTEGER, data: { turn: 1, step: 1, index: 0, dt: [1], texts: ['a', 'b'] } }],
    ['a non-numeric turn', { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 'x', step: 1, index: 0, dt: [], texts: ['a'] } }],
    ['a tool-call row without id', { type: 'tool-call-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, dt: [], args: ['a'] } }],
    ['a tool-call row with non-string id', { type: 'tool-call-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, id: 7, dt: [], args: ['a'] } }],
    ['a tool-call row with non-string name', { type: 'tool-call-chunks', seq0: 0, time0: 1, data: { turn: 1, step: 1, index: 0, id: 'c', name: 7, dt: [], args: ['a'] } }],
  ])('throws on %s', (_label, row) => {
    expect(() => decodeStorageRecord(row)).toThrow(/malformed .* storage row/)
  })
})

// --- Property: pack∘decode is the identity over arbitrary event batches ---

/** 中文说明：测试局部值 deltaChunkArb，由紧邻初始化决定，仅在当前场景使用。 */
const deltaChunkArb: fc.Arbitrary<StreamChunk> = fc.oneof(
  fc.record({ type: fc.constant<'text-delta'>('text-delta'), index: fc.nat(2), text: fc.string() }),
  fc.record({ type: fc.constant<'reasoning-delta'>('reasoning-delta'), index: fc.nat(2), text: fc.string() }),
  fc.record({
    type: fc.constant<'tool-call-delta'>('tool-call-delta'),
    index: fc.nat(2),
    id: fc.constantFrom(CallId('c1'), CallId('c2')),
    argumentsDelta: fc.string(),
  }),
  fc.record({
    type: fc.constant<'tool-call-delta'>('tool-call-delta'),
    index: fc.nat(2),
    id: fc.constantFrom(CallId('c1'), CallId('c2')),
    name: fc.constantFrom('write', 'read'),
    argumentsDelta: fc.string(),
  }),
)

/** 中文说明：测试局部值 boundaryChunkArb，由紧邻初始化决定，仅在当前场景使用。 */
const boundaryChunkArb: fc.Arbitrary<StreamChunk> = fc.oneof(
  fc.record({ type: fc.constant<'block-start'>('block-start'), index: fc.nat(2), blockType: fc.constant<'text'>('text') }),
  fc.record({ type: fc.constant<'finish'>('finish'), reason: fc.constant({ kind: 'stop' as const }) }),
)

/**
 * Batches with contiguous seqs, arbitrary timestamps, mixed chunk kinds and
 * turn/step placement. Times draw from the FULL safe-integer range (not just
 * realistic clocks) so the property exercises the gap-overflow guard: two safe
 * endpoints can differ by more than a double subtracts exactly.
 */
/** 中文说明：测试局部值 batchArb，由紧邻初始化决定，仅在当前场景使用。 */
const batchArb: fc.Arbitrary<SessionEvent[]> = fc.array(
  fc.record({
    chunk: fc.oneof({ weight: 4, arbitrary: deltaChunkArb }, { weight: 1, arbitrary: boundaryChunkArb }),
    time: fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 995, max: 9000 }) },
      { weight: 1, arbitrary: fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }) },
    ),
    turn: fc.nat(1),
    step: fc.nat(1),
  }),
  { maxLength: 40 },
  // JSON round-trip normalizes fast-check's null-prototype records into the
  // plain objects real log events are (the log is JSON), so equality compares
  // values, not prototypes.
).map(entries => JSON.parse(JSON.stringify(
  entries.map((entry, k) => chunkEvent(k, entry.time, entry.chunk, entry.turn, entry.step)),
)) as SessionEvent[])

describe('chunk-row codec properties', () => {
  it('JSON-serialized pack∘decode reproduces every batch exactly', () => {
    fc.assert(fc.property(batchArb, (events) => {
      expect(decodeAll(packChunkRuns(events))).toStrictEqual(events)
    }))
  })
})
