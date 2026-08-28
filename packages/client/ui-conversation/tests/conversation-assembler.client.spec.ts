/**
 * 文件职责：全面验证会话事件到可渲染对话快照的投影规则和异常边界。
 * 技术维度：Vitest、类型化 SessionEvent、事件脚本、快照对象和判别联合。
 * 产品维度：保证聊天消息、思考、工具调用、审批、队列和错误在界面中准确呈现。
 * 逻辑维度：按产品场景构造事件序列，逐个送入组装器，再检查消息、状态和索引。
 * 关键边界：事件顺序和关联编号必须有效；未知必需事件、重复结束和缺失起始需按契约处理。
 * 新手阅读建议：先读事件构造辅助函数，再按消息、工具、审批、错误和边缘情况分组阅读。
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  SessionEventLike, SessionEventLikeEntry, SessionLiveEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChunkRowEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationMatch, ConversationNodeContext,
  ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 中文说明：类型 `ScopeProbeStepData` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface ScopeProbeStepData {
  readonly value: number
}

/** 中文说明：类型 `ScopeProbeTurnData` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface ScopeProbeTurnData {
  readonly valueSeenFromStep: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    'scope-probe': ScopeProbeStepData
  }

  /** 中文说明：类型 `ConversationTurnDataMap` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
  interface ConversationTurnDataMap {
    'scope-probe': ScopeProbeTurnData
  }
}

/** 中文说明：类型 `TestSnapshot` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
interface TestSnapshot {
  readonly order: readonly string[]
  readonly nodes: ReadonlyMap<string, ConversationViewNode>
}

/** 中文说明：类 `TestEventDefinitions` 负责提供可控测试场景，实例由调用方创建并按生命周期释放。 */
class TestEventDefinitions {
  /** 中文说明：类成员 `definitions` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly definitions: readonly ConversationNodeDefinition[]
  /** 中文说明：类成员 `fallback` 保存可编排行为或观测状态；取值范围由声明类型限定，并随实例生命周期使用。 */
  readonly fallback: ConversationNodeDefinition | undefined

  /** 中文说明：测试类方法 `constructor`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  constructor(
    definitions: readonly ConversationNodeDefinition[],
    fallback?: ConversationNodeDefinition,
  ) {
    this.definitions = definitions
    this.fallback = fallback
  }

  /** 中文说明：测试类方法 `entries`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  entries(): readonly ConversationNodeDefinition[] {
    return this.definitions
  }

  /** 中文说明：测试类方法 `fallbackEntry`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  fallbackEntry(): ConversationNodeDefinition | undefined {
    return this.fallback
  }
}

/** 中文说明：类 `TestViewDefinitions` 负责提供可控测试场景，实例由调用方创建并按生命周期释放。 */
class TestViewDefinitions {
  /** 中文说明：测试类方法 `constructor`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  constructor(readonly definitions: readonly ConversationViewDefinition[]) {}

  /** 中文说明：测试类方法 `entries`；参数含义见签名，返回值用于驱动或观察场景；例如由本类公开流程或下方用例调用。 */
  entries(): readonly ConversationViewDefinition[] {
    return this.definitions
  }
}

/** 中文说明：测试辅助函数 `testView`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function testView(
  apply = vi.fn(),
): ConversationViewDefinition<ConversationViewNode, TestSnapshot> {
  return {
    target: 'test',
    create: () => {
      /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `current` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
      let current: TestSnapshot = { order: [], nodes: new Map() }
      return {
        empty: current,
        replace: ({ nodes }) => {
          current = { order: nodes.map(node => node.key), nodes: new Map(nodes.map(node => [node.key, node])) }
          return current
        },
        apply: ({ upserts }) => {
          apply(upserts)
          /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `nodes` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const nodes = new Map(current.nodes)
          /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `order` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          const order = [...current.order]
          /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `node` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
          for (const node of upserts) {
            if (!nodes.has(node.key)) order.push(node.key)
            nodes.set(node.key, node)
          }
          current = { order, nodes }
          return current
        },
      }
    },
  }
}

/** 中文说明：测试辅助函数 `at`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function at(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: 1_700_000_000_000 + seq, type, data } as SessionEvent
}

function input(event: SessionEvent): SessionLiveEventEntry {
  return { type: 'event', event }
}

function chunkInput(row: ChunkRow): SessionEventLikeEntry {
  const event = {
    type: `chunkrow/${row.type}`,
    seq: row.seq0,
    time: row.time0,
    data: row.data,
  } as ChunkRowEvent
  return { type: 'chunks', event }
}

function testSnapshot(assembler: ConversationNodeAssembler): TestSnapshot | undefined {
  return assembler.snapshot('test') as TestSnapshot | undefined
}

/** 中文说明：测试辅助函数 `node`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function node(
  context: Parameters<NonNullable<ConversationNodeDefinition['buildViewNode']>>[0],
  data: unknown,
): ConversationViewNode {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'test',
    data,
  }
}

/** 中文说明：测试辅助函数 `fallbackDefinition`；参数含义见签名，返回值用于驱动或断言场景；例如按本文件中的调用位置使用。 */
function fallbackDefinition(start: () => string): ConversationNodeDefinition<string> {
  return {
    kind: 'fallback',
    target: 'test',
    match: event => ({ id: String(event.seq), role: 'start' }),
    start,
    update: context => context.state,
    buildViewNode: context => node(context, context.state),
  }
}

describe('ConversationNodeAssembler', () => {
  it('appends through an exact business-id Context without replaying unrelated Contexts', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `starts` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const starts = vi.fn((
      _context: ConversationNodeContext<{ callSeq: number; results: number }>,
      match: ConversationMatch,
    ) => ({ callSeq: match.event.seq, results: 0 }))
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `updates` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const updates = vi.fn((context: { state: { callSeq: number; results: number } }) => ({
      ...context.state,
      results: context.state.results + 1,
    }))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<{ callSeq: number; results: number }> = {
      kind: 'tool',
      match: (event) => {
        if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
        if (event.type === 'tool/result') return { id: String(event.data.message.source.callId), role: 'update' }
        return null
      },
      start: starts,
      update: updates,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'x', arguments: '{}' })),
      input(at(2, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'x', arguments: '{}' })),
    ], false)
    assembler.flush()
    starts.mockClear()

    assembler.append(input(at(3, 'tool/result', {
      turn: 1,
      step: 1,
      message: { source: { type: 'tool-result', callId: 'a' }, content: [], isError: false },
    })))
    assembler.flush()

    expect(starts).not.toHaveBeenCalled()
    expect(updates).toHaveBeenCalledOnce()
    const snapshot = testSnapshot(assembler)
    expect([...snapshot?.nodes.values() ?? []].map(value => value.data)).toEqual([
      { callSeq: 1, results: 1 },
      { callSeq: 2, results: 0 },
    ])
  })

  it('keeps one Match collection while a long Context appends without replay', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `starts` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const starts = vi.fn(() => 0)
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `updates` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const updates = vi.fn((context: ConversationNodeContext<number> & { readonly state: number }) => (
      context.state + 1
    ))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `matchCollections` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const matchCollections = new Set<readonly ConversationMatch[]>()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<number> = {
      kind: 'append-linear',
      match: (event) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `type` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const type: string = event.type
        if (type === 'linear/start') return { id: 'one', role: 'start' }
        if (type === 'linear/update') return { id: 'one', role: 'update' }
        return null
      },
      start: (context) => {
        matchCollections.add(context.matches)
        return starts()
      },
      update: (context) => {
        matchCollections.add(context.matches)
        return updates(context)
      },
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(1, 'linear/start', {}))], false)
    starts.mockClear()

    /** 中文说明：标识对象、顺序或版本的标量值；变量 `seq` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    for (let seq = 2; seq <= 1_001; seq++) {
      assembler.append(input(at(seq, 'linear/update', {})))
    }
    assembler.flush()

    expect(starts).not.toHaveBeenCalled()
    expect(updates).toHaveBeenCalledTimes(1_000)
    expect(matchCollections.size).toBe(1)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(1_000)
  })

  it('keeps one packed Match through replace, Location replay, and Registry rebuild', () => {
    interface State {
      readonly updates: readonly string[]
      readonly packedStatus: string | undefined
    }

    const matches = vi.fn((event: SessionEventLike) => {
      if (event.type === 'step/start') return { id: '2:3', role: 'start' as const }
      if ((event.type as string) === 'probe/update'
        || event.type === 'chunkrow/text-chunks') {
        return { id: '2:3', role: 'update' as const }
      }
      return null
    })
    const passiveMatches = vi.fn(() => null)
    const updates = vi.fn((
      context: ConversationNodeContext<State> & { readonly state: State },
      match: ConversationMatch,
    ): State => {
      if (match.event.type === 'chunkrow/text-chunks') {
        return {
          ...context.state,
          updates: [
            ...context.state.updates,
            `packed:${String(match.event.seq)}-${String(match.event.seq + match.event.data.texts.length - 1)}`,
          ],
          packedStatus: match.location.kind === 'step'
            ? match.location.step.status
            : match.location.kind,
        }
      }
      return {
        ...context.state,
        updates: [...context.state.updates, `event:${String(match.event.seq)}`],
      }
    })
    const definition: ConversationNodeDefinition<State> = {
      kind: 'packed-probe',
      match: matches,
      start: () => ({ updates: [], packedStatus: undefined }),
      update: updates,
      target: 'test',
      buildViewNode: context => context.state === undefined
        ? null
        : node(context, {
          ...context.state,
          matches: context.matches.map(match => ({
            type: match.event.type,
            seq: match.event.seq,
          })),
        }),
    }
    const passive: ConversationNodeDefinition<null> = {
      kind: 'packed-passive',
      match: passiveMatches,
      start: () => null,
      update: context => context.state,
    }
    const run = chunkInput({
      type: 'text-chunks',
      seq0: 12,
      time0: 1_700_000_000_012,
      data: { turn: 2, step: 3, index: 0, dt: [1, 1], texts: ['a', 'b', 'c'] },
    })
    const inputs: SessionEventLikeEntry[] = [
      input(at(10, 'step/start', { turn: 2, step: 3 })),
      input(at(11, 'probe/update', { turn: 2, step: 3 })),
      run,
      input(at(15, 'probe/update', { turn: 2, step: 3 })),
    ]
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition, passive]),
      new TestViewDefinitions([testView()]),
    )

    assembler.replaceWindow(inputs, false)
    assembler.flush()

    expect(matches).toHaveBeenCalledTimes(4)
    expect(passiveMatches).toHaveBeenCalledTimes(4)
    expect(updates).toHaveBeenCalledTimes(3)
    expect(updates.mock.calls.filter(([, match]) => (
      match.event.type === 'chunkrow/text-chunks'
    ))).toHaveLength(1)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toEqual({
      updates: ['event:11', 'packed:12-14', 'event:15'],
      packedStatus: 'open',
      matches: [
        { type: 'step/start', seq: 10 },
        { type: 'probe/update', seq: 11 },
        { type: 'chunkrow/text-chunks', seq: 12 },
        { type: 'probe/update', seq: 15 },
      ],
    })

    assembler.append(input(at(16, 'step/end', { turn: 2, step: 3 })))
    assembler.flush()

    expect(updates.mock.calls.filter(([, match]) => (
      match.event.type === 'chunkrow/text-chunks'
    ))).toHaveLength(2)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toMatchObject({
      updates: ['event:11', 'packed:12-14', 'event:15'],
      packedStatus: 'closed',
    })

    matches.mockClear()
    passiveMatches.mockClear()
    updates.mockClear()
    assembler.rebuildRegistry()
    assembler.flush()

    expect(matches).toHaveBeenCalledTimes(5)
    expect(passiveMatches).toHaveBeenCalledTimes(5)
    expect(updates).toHaveBeenCalledTimes(3)
    expect(updates.mock.calls.filter(([, match]) => (
      match.event.type === 'chunkrow/text-chunks'
    ))).toHaveLength(1)
  })

  it('replays one pending packed Match after prepend supplies its scalar start', () => {
    const starts = vi.fn(() => ({ batches: 0, status: 'unresolved' }))
    const updates = vi.fn((
      context: ConversationNodeContext<{ batches: number; status: string }> & {
        readonly state: { batches: number; status: string }
      },
      match: ConversationMatch,
    ) => ({
      batches: context.state.batches + 1,
      status: match.location.kind === 'step' ? match.location.step.status : match.location.kind,
    }))
    const definition: ConversationNodeDefinition<{ batches: number; status: string }> = {
      kind: 'packed-pending',
      match: (event) => {
        if (event.type === 'step/start') {
          return { id: `${String(event.data.turn)}:${String(event.data.step)}`, role: 'start' }
        }
        if (event.type === 'chunkrow/reasoning-chunks') {
          return { id: `${String(event.data.turn)}:${String(event.data.step)}`, role: 'update' }
        }
        return null
      },
      start: starts,
      update: updates,
      target: 'test',
      buildViewNode: context => context.state === undefined
        ? null
        : node(context, {
          ...context.state,
          matches: context.matches.map(match => [match.event.type, match.event.seq]),
        }),
    }
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    const run = chunkInput({
      type: 'reasoning-chunks',
      seq0: 21,
      time0: 1_700_000_000_021,
      data: { turn: 4, step: 5, index: 0, dt: [0, -1], texts: ['', ' ', 'x'] },
    })

    assembler.replaceWindow([run], true)
    assembler.flush()

    expect(starts).not.toHaveBeenCalled()
    expect(updates).not.toHaveBeenCalled()
    expect(testSnapshot(assembler)?.order).toEqual([])

    assembler.prepend([
      input(at(20, 'step/start', { turn: 4, step: 5 })),
    ], false)
    assembler.flush()

    expect(starts).toHaveBeenCalledOnce()
    expect(updates).toHaveBeenCalledOnce()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toEqual({
      batches: 1,
      status: 'open',
      matches: [['step/start', 20], ['chunkrow/reasoning-chunks', 21]],
    })
  })

  it('rejects a packed event classified as a Context start', () => {
    const definition: ConversationNodeDefinition<null> = {
      kind: 'invalid-packed-start',
      match: event => event.type === 'chunkrow/text-chunks'
        ? { id: 'one', role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
    }
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    const run = chunkInput({
      type: 'text-chunks',
      seq0: 1,
      time0: 1_700_000_000_001,
      data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ['a', 'b', 'c'] },
    })

    expect(() => assembler.replaceWindow([run], false)).toThrow(
      'conversation Context 20:invalid-packed-startone received a packed start Match',
    )
  })

  it('merges an older page and replays its affected Context once', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `starts` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const starts = vi.fn(() => 0)
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `updates` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const updates = vi.fn((context: ConversationNodeContext<number> & { readonly state: number }) => (
      context.state + 1
    ))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<number> = {
      kind: 'prepend-linear',
      match: (event) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `type` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const type: string = event.type
        if (type === 'linear/start') return { id: 'one', role: 'start' }
        if (type === 'linear/update') return { id: 'one', role: 'update' }
        return null
      },
      start: starts,
      update: updates,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `current` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const current = Array.from({ length: 100 }, (_, index) => (
      input(at(index + 102, 'linear/update', {}))
    ))
    assembler.replaceWindow(current, true)
    assembler.flush()
    expect(starts).not.toHaveBeenCalled()
    expect(updates).not.toHaveBeenCalled()

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `older` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const older = [
      input(at(1, 'linear/start', {})),
      ...Array.from({ length: 100 }, (_, index) => (
        input(at(index + 2, 'linear/update', {}))
      )),
    ]
    assembler.prepend(older, false)
    assembler.flush()

    expect(starts).toHaveBeenCalledOnce()
    expect(updates).toHaveBeenCalledTimes(200)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(200)
  })

  it('collects an update before its start and replays it once prepend supplies the start', () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `updates` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const updates = vi.fn((context: { state: { settled: boolean } }) => ({ ...context.state, settled: true }))
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<{ settled: boolean }> = {
      kind: 'tool',
      match: (event) => {
        if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
        if (event.type === 'tool/result') return { id: String(event.data.message.source.callId), role: 'update' }
        return null
      },
      start: () => ({ settled: false }),
      update: updates,
      target: 'test',
      buildViewNode: context => node(context, context.state ?? { pendingStart: true }),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(10, 'tool/result', {
      turn: 1,
      step: 1,
      message: { source: { type: 'tool-result', callId: 'a' }, content: [], isError: false },
    }))], true)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data)
      .toEqual({ pendingStart: true })

    assembler.prepend([input(at(5, 'tool/call', {
      turn: 1, step: 1, callId: 'a', name: 'x', arguments: '{}',
    }))], false)
    assembler.flush()

    expect(updates).toHaveBeenCalledOnce()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data)
      .toEqual({ settled: true })
  })

  it('rejects a Definition whose declared start follows an update in log order', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'invalid-lifecycle',
      match: event => event.type === 'turn/end'
        ? { id: 'one', role: 'start' }
        : event.type === 'turn/start' ? { id: 'one', role: 'update' } : null,
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )

    expect(() => assembler.replaceWindow([
      input(at(1, 'turn/start', { turn: 1 })),
      input(at(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } })),
    ], false)).toThrow('received an update before its start Match')
  })

  it('replays a window-gap reader when prepend supplies a nearer predecessor', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `source` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const source: ConversationNodeDefinition<number> = {
      kind: 'source',
      match: event => event.type === 'user/message'
        ? { id: String(event.data.id), role: 'start' }
        : null,
      start: (_context, match) => Number((match.event.data as { value?: unknown }).value ?? 0),
      update: context => context.state,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumerStart` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumerStart = vi.fn((
      _context: Parameters<ConversationNodeDefinition<number>['start']>[0],
      _match: Parameters<ConversationNodeDefinition<number>['start']>[1],
      reader: Parameters<ConversationNodeDefinition<number>['start']>[2],
    ) => reader.previous<number>('source')?.state ?? -1)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumer: ConversationNodeDefinition<number> = {
      kind: 'consumer',
      match: event => event.type === 'assistant/message'
        ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        : null,
      start: consumerStart,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([source, consumer]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(10, 'assistant/message', {
      turn: 2, step: 1, message: { role: 'assistant', content: [] },
    }))], true)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(-1)

    assembler.prepend([input(at(5, 'user/message', {
      id: 'm1', value: 7, content: [], source: { kind: 'user' },
    }))], false)
    assembler.flush()

    expect(consumerStart).toHaveBeenCalledTimes(2)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(7)
  })

  it('keeps the predecessor index ordered across prepend and append', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `source` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const source: ConversationNodeDefinition<number> = {
      kind: 'source',
      match: event => event.type === 'user/message'
        ? { id: String(event.data.id), role: 'start' }
        : null,
      start: (_context, match) => match.event.seq,
      update: context => context.state,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumer: ConversationNodeDefinition<number> = {
      kind: 'consumer',
      match: event => event.type === 'assistant/message'
        ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        : null,
      start: (_context, _match, reader) => reader.previous<number>('source')?.state ?? -1,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([source, consumer]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(40, 'user/message', { id: 'm40', content: [], source: { kind: 'user' } })),
      input(at(50, 'assistant/message', {
        turn: 1, step: 1, message: { role: 'assistant', content: [] },
      })),
    ], true)
    assembler.flush()

    assembler.prepend([
      input(at(10, 'user/message', { id: 'm10', content: [], source: { kind: 'user' } })),
      input(at(30, 'user/message', { id: 'm30', content: [], source: { kind: 'user' } })),
    ], false)
    assembler.flush()
    assembler.append(input(at(60, 'user/message', {
      id: 'm60', content: [], source: { kind: 'user' },
    })))
    assembler.append(input(at(70, 'assistant/message', {
      turn: 2, step: 1, message: { role: 'assistant', content: [] },
    })))
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []].map(value => value.data))
      .toEqual([40, 60])
  })

  it('replays a window-gap reader when an empty prepend closes the unknown prefix', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumerStart` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumerStart = vi.fn((
      _context: Parameters<ConversationNodeDefinition<number>['start']>[0],
      _match: Parameters<ConversationNodeDefinition<number>['start']>[1],
      reader: Parameters<ConversationNodeDefinition<number>['start']>[2],
    ) => reader.previous<number>('source')?.state ?? -1)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumer: ConversationNodeDefinition<number> = {
      kind: 'consumer',
      match: event => event.type === 'assistant/message'
        ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        : null,
      start: consumerStart,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([consumer]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(10, 'assistant/message', {
      turn: 2, step: 1, message: { role: 'assistant', content: [] },
    }))], true)
    assembler.flush()

    expect(assembler.prepend([], false)).toBe('immediate')
    assembler.flush()

    expect(consumerStart).toHaveBeenCalledTimes(2)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(-1)
  })

  it('replays direct dependents when an append revises their predecessor Context', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `source` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const source: ConversationNodeDefinition<number> = {
      kind: 'source',
      match: (event) => {
        if (event.type === 'user/message') return { id: 'one', role: 'start' }
        if ((event.type as string) === 'source/update') return { id: 'one', role: 'update' }
        return null
      },
      start: () => 1,
      update: (_context, match) => (match.event.data as unknown as { value: number }).value,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumerStart` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumerStart = vi.fn((
      _context: Parameters<ConversationNodeDefinition<number>['start']>[0],
      _match: Parameters<ConversationNodeDefinition<number>['start']>[1],
      reader: Parameters<ConversationNodeDefinition<number>['start']>[2],
    ) => reader.previous<number>('source')?.state ?? -1)
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumer: ConversationNodeDefinition<number> = {
      kind: 'consumer',
      match: event => event.type === 'assistant/message'
        ? { id: 'one', role: 'start' }
        : null,
      start: consumerStart,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([source, consumer]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'user/message', { id: 'source', content: [], source: { kind: 'user' } })),
      input(at(2, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] } })),
    ], false)
    assembler.flush()

    expect(assembler.append(input(at(3, 'source/update', { value: 2 })))).toBe('immediate')
    assembler.flush()

    expect(consumerStart).toHaveBeenCalledTimes(2)
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(2)
  })

  it('replays a transitive dependency closure in start order', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `sourceA` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sourceA: ConversationNodeDefinition<number> = {
      kind: 'diamond-a',
      match: (event) => {
        if (event.type === 'user/message') return { id: 'one', role: 'start' }
        if ((event.type as string) === 'diamond/a') return { id: 'one', role: 'update' }
        return null
      },
      start: () => 1,
      update: (_context, match) => (match.event.data as unknown as { value: number }).value,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `sourceX` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const sourceX: ConversationNodeDefinition<number> = {
      kind: 'diamond-x',
      match: (event) => {
        if (event.type === 'turn/start') return { id: 'one', role: 'start' }
        if ((event.type as string) === 'diamond/x') return { id: 'one', role: 'update' }
        return null
      },
      start: () => 10,
      update: (_context, match) => (match.event.data as unknown as { value: number }).value,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：标识对象、顺序或版本的标量值；变量 `middle` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const middle: ConversationNodeDefinition<number> = {
      kind: 'diamond-b',
      match: event => event.type === 'assistant/message'
        ? { id: 'one', role: 'start' }
        : null,
      start: (_context, _match, reader) => (
        (reader.previous<number>('diamond-a')?.state ?? 0)
        + (reader.previous<number>('diamond-x')?.state ?? 0)
      ),
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `consumer` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const consumer: ConversationNodeDefinition<number> = {
      kind: 'diamond-c',
      match: event => event.type === 'tool/call'
        ? { id: 'one', role: 'start' }
        : null,
      start: (_context, _match, reader) => (
        (reader.previous<number>('diamond-a')?.state ?? 0) * 100
        + (reader.previous<number>('diamond-b')?.state ?? 0)
      ),
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([sourceA, sourceX, middle, consumer]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'user/message', { id: 'source', content: [], source: { kind: 'user' } })),
      input(at(2, 'turn/start', { turn: 1 })),
      input(at(3, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] } })),
      input(at(4, 'tool/call', { turn: 1, step: 1, callId: 'call', name: 'x', arguments: '{}' })),
    ], false)

    assembler.append(input(at(5, 'diamond/x', { value: 20 })))
    assembler.append(input(at(6, 'diamond/a', { value: 2 })))
    assembler.flush()

    const value = [...testSnapshot(assembler)?.nodes.values() ?? []]
      .find(candidate => candidate.kind === 'diamond-c')
    expect(value?.data).toBe(222)
  })

  it('replays Location-derived State and rebuilds only owned Nodes when a step closes', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `apply` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const apply = vi.fn()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `starts` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const starts = vi.fn((
      _context: Parameters<ConversationNodeDefinition<string>['start']>[0],
      match: Parameters<ConversationNodeDefinition<string>['start']>[1],
    ) => match.location.kind === 'step' ? match.location.step.status : 'missing')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<string> = {
      kind: 'step',
      match: event => event.type === 'step/start'
        ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        : null,
      start: starts,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView(apply)]),
    )
    assembler.replaceWindow([
      input(at(1, 'turn/start', { turn: 1 })),
      input(at(2, 'step/start', { turn: 1, step: 1 })),
    ], false)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe('open')

    assembler.append(input(at(3, 'step/end', { turn: 1, step: 1 })))
    assembler.flush()

    expect(starts).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenCalledOnce()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe('closed')
  })

  it('lets one Context publish Step and Turn data in phase order', () => {
    /** 中文说明：类型 `State` 约束本文件使用的数据字段和取值范围，避免调用方传入不完整状态。 */
    interface State {
      readonly turn: number
      readonly step: number
      readonly value: number
    }

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<State> = {
      kind: 'scope-probe',
      match: (event) => {
        if (event.type === 'step/start') {
          return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        }
        if ((event.type as string) === 'scope-probe/update') {
          return { id: '1:1', role: 'update' }
        }
        return null
      },
      start: (_context, match) => {
        if (match.event.type !== 'step/start') throw new Error('scope probe requires step/start')
        return { turn: match.event.data.turn, step: match.event.data.step, value: 1 }
      },
      update: (_context, match) => ({
        turn: 1,
        step: 1,
        value: (match.event.data as unknown as { value: number }).value,
      }),
      buildLocationData: (context, scope) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `state` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const state = context.state
        if (state === undefined) return null
        if (scope === 'step') {
          return {
            kind: 'step',
            turn: state.turn,
            step: state.step,
            key: 'scope-probe',
            value: { value: state.value },
          }
        }
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `location` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const location = context.start?.location
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `stepValue` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const stepValue = location?.kind === 'step'
          ? location.step.data.get('scope-probe')?.value
          : undefined
        return {
          kind: 'turn',
          turn: state.turn,
          key: 'scope-probe',
          value: { valueSeenFromStep: stepValue ?? -1 },
        }
      },
      target: 'test',
      buildViewNode: (context) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `location` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const location = context.start?.location
        if (location?.kind !== 'step') return null
        return node(context, {
          step: location.step.data.get('scope-probe')?.value,
          turn: location.turn.data.get('scope-probe')?.valueSeenFromStep,
        })
      },
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'turn/start', { turn: 1 })),
      input(at(2, 'step/start', { turn: 1, step: 1 })),
    ], false)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data)
      .toEqual({ step: 1, turn: 1 })

    assembler.append(input(at(3, 'scope-probe/update', { turn: 1, step: 1, value: 2 })))
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data)
      .toEqual({ step: 2, turn: 2 })
  })

  it('updates existing turn Locations when their Step membership changes', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `apply` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const apply = vi.fn()
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'turn-probe',
      match: event => event.type === 'turn/start'
        ? { id: String(event.data.turn), role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.start?.location.kind === 'turn'
        ? context.start.location.turn.steps.length
        : -1),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView(apply)]),
    )
    assembler.replaceWindow([input(at(1, 'turn/start', { turn: 1 }))], false)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(0)

    assembler.append(input(at(2, 'step/start', { turn: 1, step: 1 })))
    assembler.flush()

    expect(apply).toHaveBeenCalledOnce()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(1)
  })

  it('publishes a changed timeline even when no business Definition claims the boundary', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `apply` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const apply = vi.fn()
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([]),
      new TestViewDefinitions([testView(apply)]),
    )
    assembler.replaceWindow([], false)
    assembler.flush()

    assembler.append(input(at(1, 'turn/start', { turn: 1 })))
    assembler.flush()

    expect(apply).toHaveBeenCalledOnce()
    expect(testSnapshot(assembler)?.order).toEqual([])
  })

  it('clears the prior Step at a new Turn and honors explicit session ownership', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'location-probe',
      match: (event) => {
        if ((event.type as string) === 'command/run') {
          return {
            id: (event.data as unknown as { commandId: string }).commandId,
            role: 'start',
          }
        }
        if ((event.type as string) === 'compaction/start') {
          return {
            id: (event.data as unknown as { compactionId: string }).compactionId,
            role: 'start',
          }
        }
        return null
      },
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: (context) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `location` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const location = context.start?.location
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `data` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const data = location?.kind === 'step'
          ? `step:${location.turn.turn}:${location.step.step}`
          : location?.kind === 'turn' ? `turn:${location.turn.turn}` : location?.kind
        return node(context, data)
      },
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'turn/start', { turn: 1 })),
      input(at(2, 'step/start', { turn: 1, step: 1 })),
      input(at(3, 'turn/start', { turn: 2 })),
      input(at(4, 'command/run', { commandId: 'command', name: 'x' })),
      input(at(5, 'compaction/start', { compactionId: 'compact', turn: null })),
    ], false)
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []].map(value => value.data))
      .toEqual(['turn:2', 'session'])
  })

  it('assigns turn boundaries to the Turn even when a Step remains open', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'turn-boundary-probe',
      match: event => event.type === 'turn/end'
        ? { id: String(event.data.turn), role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.start?.location.kind),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'turn/start', { turn: 1 })),
      input(at(2, 'step/start', { turn: 1, step: 1 })),
    ], false)
    assembler.flush()

    assembler.append(input(at(3, 'turn/end', { turn: 1, reason: { kind: 'aborted' } })))
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe('turn')
  })

  it('carries explicit coordinates across coordinate-free events in a partial window and live tail', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'location-probe',
      match: event => (event.type as string) === 'tool/code-dispatch-start'
        ? { id: String(event.seq), role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: (context) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `location` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const location = context.start?.location
        return node(context, location?.kind === 'step'
          ? `${location.turn.turn}:${location.step.step}`
          : location?.kind)
      },
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(10, 'tool/call', { turn: 2, step: 3, callId: 'root', name: 'x', arguments: '{}' })),
      input(at(11, 'tool/code-dispatch-start', { rootCallId: 'root', subCallId: 'a' })),
    ], true)
    assembler.flush()

    assembler.append(input(at(12, 'tool/code-dispatch-start', { rootCallId: 'root', subCallId: 'b' })))
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []].map(value => value.data))
      .toEqual(['2:3', '2:3'])
  })

  it('treats loaded end boundaries as closed when their starts precede the window', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<null> = {
      kind: 'location-probe',
      match: event => event.type === 'tool/call'
        ? { id: String(event.data.callId), role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
      target: 'test',
      buildViewNode: (context) => {
        /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `location` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
        const location = context.start?.location
        return node(context, location?.kind === 'step'
          ? `${location.turn.status}:${location.step.status}`
          : location?.kind)
      },
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(10, 'tool/call', { turn: 2, step: 3, callId: 'root', name: 'x', arguments: '{}' })),
      input(at(11, 'step/end', { turn: 2, step: 3 })),
      input(at(12, 'turn/end', { turn: 2, reason: { kind: 'completed' } })),
    ], true)
    assembler.flush()

    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data)
      .toBe('closed:closed')
  })

  it('restarts State creation from undefined when Location changes replay a Context', () => {
    /** 中文说明：保存索引、集合或按顺序观测值的数据结构；变量 `seen` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const seen = vi.fn((context: Parameters<ConversationNodeDefinition<number>['start']>[0]) => {
      expect(context.state).toBeUndefined()
      return 1
    })
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<number> = {
      kind: 'replay-probe',
      match: event => event.type === 'step/start'
        ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
        : null,
      start: seen,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(1, 'step/start', { turn: 1, step: 1 }))], false)
    assembler.flush()

    assembler.append(input(at(2, 'step/end', { turn: 1, step: 1 })))
    assembler.flush()

    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('invokes the fallback when only a State-only Definition claims an event', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fallbackStart` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const fallbackStart = vi.fn(() => 'fallback')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `claimed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const claimed: ConversationNodeDefinition<null> = {
      kind: 'claimed-state',
      match: event => (event.type as string) === 'command/run'
        ? { id: 'claimed', role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([claimed], fallbackDefinition(fallbackStart)),
      new TestViewDefinitions([testView()]),
    )

    assembler.replaceWindow([input(at(1, 'command/run', { commandId: 'one', name: 'x' }))], false)
    assembler.flush()

    expect(fallbackStart).toHaveBeenCalledOnce()
    expect(testSnapshot(assembler)?.order).toHaveLength(1)
  })

  it('invokes the fallback when only another target claims an event', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fallbackStart` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const fallbackStart = vi.fn(() => 'fallback')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `claimed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const claimed: ConversationNodeDefinition<null> = {
      kind: 'claimed-trajectory',
      target: 'trajectory',
      match: event => (event.type as string) === 'command/run'
        ? { id: 'claimed', role: 'start' }
        : null,
      start: () => null,
      update: context => context.state,
      buildViewNode: () => null,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([claimed], fallbackDefinition(fallbackStart)),
      new TestViewDefinitions([testView()]),
    )

    assembler.replaceWindow([input(at(1, 'command/run', { commandId: 'one', name: 'x' }))], false)
    assembler.flush()

    expect(fallbackStart).toHaveBeenCalledOnce()
    expect(testSnapshot(assembler)?.order).toHaveLength(1)
  })

  it('suppresses the fallback when the same target claims an event', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `fallbackStart` 是可调用函数，其参数与返回值见类型签名；例如由相邻流程调用。 */
    const fallbackStart = vi.fn(() => 'fallback')
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `claimed` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const claimed: ConversationNodeDefinition<null> = {
      kind: 'claimed',
      target: 'test',
      match: event => (event.type as string) === 'command/run' ? { id: 'claimed', role: 'start' } : null,
      start: () => null,
      update: context => context.state,
      buildViewNode: () => null,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([claimed], fallbackDefinition(fallbackStart)),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(1, 'command/run', { commandId: 'one', name: 'x' }))], false)
    assembler.flush()

    expect(fallbackStart).not.toHaveBeenCalled()
    expect(testSnapshot(assembler)?.order).toEqual([])
  })

  it('rejects withdrawing a previously materialized Node during an incremental update', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<boolean> = {
      kind: 'toggle',
      match: (event) => {
        if ((event.type as string) === 'command/run') return { id: 'one', role: 'start' }
        if ((event.type as string) === 'toggle/hide') return { id: 'one', role: 'update' }
        return null
      },
      start: () => true,
      update: () => false,
      target: 'test',
      buildViewNode: context => context.state === true ? node(context, true) : null,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([input(at(1, 'command/run', { commandId: 'one', name: 'x' }))], false)
    assembler.flush()
    expect(testSnapshot(assembler)?.order).toHaveLength(1)

    assembler.append(input(at(2, 'toggle/hide', {})))
    expect(() => assembler.flush()).toThrow(/withdrew materialized target "test"/)

    expect(testSnapshot(assembler)?.order).toHaveLength(1)
  })

  it('fails loud when a Definition returns undefined State', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `startUndefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const startUndefined: ConversationNodeDefinition = {
      kind: 'undefined-start',
      match: event => (event.type as string) === 'command/run' ? { id: 'one', role: 'start' } : null,
      start: () => undefined,
      update: context => context.state,
      target: 'test',
      buildViewNode: () => null,
    }
    /** 中文说明：当前会话或对话投影对象；变量 `startAssembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const startAssembler = new ConversationNodeAssembler(
      new TestEventDefinitions([startUndefined]),
      new TestViewDefinitions([testView()]),
    )
    expect(() => startAssembler.replaceWindow([
      input(at(1, 'command/run', { commandId: 'one', name: 'x' })),
    ], false)).toThrow(/Definition "undefined-start" returned undefined from start/)

    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `updateUndefined` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const updateUndefined: ConversationNodeDefinition<boolean> = {
      kind: 'undefined-update',
      match: (event) => {
        if ((event.type as string) === 'command/run') return { id: 'one', role: 'start' }
        if ((event.type as string) === 'command/done') return { id: 'one', role: 'update' }
        return null
      },
      start: () => true,
      update: () => undefined as never,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `updateAssembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const updateAssembler = new ConversationNodeAssembler(
      new TestEventDefinitions([updateUndefined]),
      new TestViewDefinitions([testView()]),
    )
    updateAssembler.replaceWindow([
      input(at(1, 'command/run', { commandId: 'one', name: 'x' })),
    ], false)
    expect(() => updateAssembler.append(
      input(at(2, 'command/done', { commandId: 'one', kind: 'success' })),
    )).toThrow(/Definition "undefined-update" returned undefined from update/)
  })

  it('rejects a duplicate start before mutating the existing Context', () => {
    /** 中文说明：当前测试场景使用的局部状态或中间值；变量 `definition` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const definition: ConversationNodeDefinition<number> = {
      kind: 'single-start',
      match: event => (event.type as string) === 'command/run' ? { id: 'one', role: 'start' } : null,
      start: (_context, match) => match.event.seq,
      update: context => context.state,
      target: 'test',
      buildViewNode: context => node(context, context.state),
    }
    /** 中文说明：当前会话或对话投影对象；变量 `assembler` 的取值由紧邻初始化或循环输入决定，仅在当前作用域使用。 */
    const assembler = new ConversationNodeAssembler(
      new TestEventDefinitions([definition]),
      new TestViewDefinitions([testView()]),
    )
    assembler.replaceWindow([
      input(at(1, 'command/run', { commandId: 'one', name: 'x' })),
    ], false)
    assembler.flush()

    expect(() => assembler.append(
      input(at(2, 'command/run', { commandId: 'two', name: 'x' })),
    )).toThrow(/received more than one start Match/)
    assembler.flush()
    expect([...testSnapshot(assembler)?.nodes.values() ?? []][0]?.data).toBe(1)
  })
})
