/**
 * 文件职责：验证上下文压缩的 tool-pairing.spec.ts 行为。
 * 技术维度：Vitest、会话事件、模型请求夹具和 Cordis 组装。
 * 产品维度：防止上下文压缩改变模型可见内容或生命周期语义。
 * 逻辑维度：构造日志与配置，运行插件并断言事件、请求和清理。
 * 关键边界：模型可见内容必须可重建；工具调用和结果必须保持配对。
 * 新手阅读建议：先读事件夹具，再按正常、边界和失败场景阅读。
 */
import { describe, expect, it } from 'vitest'
import { createUserMessage, ToolCallId , createMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { toolPairingBalancedAfter, toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 中文说明：测试局部值 SURFACE，由紧邻初始化决定。 */
const SURFACE = { surfaceOp: 'append' as const }

/** 中文说明：函数 seqOf 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function seqOf(session: Session, type: SessionEvent['type'], nth = 0): number {
  return session.events.filter(event => event.type === type)[nth]!.seq
}

/** 中文说明：函数 surfaceSeq 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function surfaceSeq(session: Session, seq: number): number {
  /** 中文说明：测试局部值 current，由紧邻初始化决定。 */
  const current = session.surface.nodes.find(candidate => candidate === seq)
  if (current === undefined) throw new Error(`seq ${seq} is not on the surface`)
  return current
}

/** 中文说明：函数 before 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function before(session: Session, type: SessionEvent['type'], nth = 0): boolean {
  return toolPairingBalancedBefore(session, surfaceSeq(session, seqOf(session, type, nth)))
}

/** 中文说明：函数 after 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function after(session: Session, type: SessionEvent['type'], nth = 0): boolean {
  return toolPairingBalancedAfter(session, surfaceSeq(session, seqOf(session, type, nth)))
}

/** 中文说明：函数 closedToolStep 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function closedToolStep(): Session {
  /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
  const session = Session.create(SessionId('closed-tool-step'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'go' }],
    source: { kind: 'user' },
  }), SURFACE)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' }],
      source: {
        kind: 'model',
        ...{ provider: 'mock', model: 'mock' },
      },
    }),
  }, SURFACE)
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: ToolCallId('c1'),
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    }),
  }, SURFACE)
  return session
}

describe('tool-pairing boundaries', () => {
  it('classifies closed and open single-call steps', () => {
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = closedToolStep()
    expect(before(closed, 'user/message')).toBe(true)
    expect(after(closed, 'user/message')).toBe(true)
    expect(before(closed, 'assistant/message')).toBe(true)
    expect(after(closed, 'assistant/message')).toBe(false)
    expect(before(closed, 'tool/result')).toBe(false)
    expect(after(closed, 'tool/result')).toBe(true)

    /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
    const open = Session.create(SessionId('open-tool-step'))
    open.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: ToolCallId('open'), name: 'bash', arguments: '{}' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, SURFACE)
    expect(toolPairingBalancedAfter(open, open.surface.nodes[0]!)).toBe(false)
  })

  it('requires every result from a multiple-call assistant message', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('multiple-calls'))
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: ToolCallId('c1'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: ToolCallId('c2'), name: 'two', arguments: '{}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, SURFACE)
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('c1'),
        content: [],
        isError: false,
      }),
    }, SURFACE)
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('c2'),
        content: [],
        isError: false,
      }),
    }, SURFACE)

    expect(after(session, 'tool/result', 0)).toBe(false)
    expect(after(session, 'tool/result', 1)).toBe(true)
  })

  it('keeps neutral nodes inside an open pair unbalanced and free nodes balanced', () => {
    /** 中文说明：测试局部值 midStep，由紧邻初始化决定。 */
    const midStep = Session.create(SessionId('neutral-mid-step'))
    midStep.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{}' }],
        source: {
          kind: 'model',
          ...{ provider: 'mock', model: 'mock' },
        },
      }),
    }, SURFACE)
    midStep.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'background update' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), SURFACE)
    midStep.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('c1'),
        content: [],
        isError: false,
      }),
    }, SURFACE)
    expect(before(midStep, 'user/message')).toBe(false)
    expect(after(midStep, 'user/message')).toBe(false)

    /** 中文说明：测试局部值 free，由紧邻初始化决定。 */
    const free = Session.create(SessionId('neutral-free'))
    free.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'idle injection' }],
      source: { kind: 'user' },
    }), SURFACE)
    expect(before(free, 'user/message')).toBe(true)
    expect(after(free, 'user/message')).toBe(true)
  })
})

describe('tool-pairing surface identity', () => {
  it('rebuilds after replace and rejects sequences removed from current membership', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = closedToolStep()
    /** 中文说明：测试局部值 staleTail，由紧邻初始化决定。 */
    const staleTail = surfaceSeq(session, seqOf(session, 'tool/result'))
    expect(toolPairingBalancedAfter(session, staleTail)).toBe(true)

    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes = session.surface.nodes
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'checkpoint' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: nodes[0]!, end: nodes.at(-1)! },
      sourceEventSeqs: [...nodes],
    })

    /** 中文说明：测试局部值 checkpoint，由紧邻初始化决定。 */
    const checkpoint = session.surface.nodes[0]!
    expect(toolPairingBalancedBefore(session, checkpoint)).toBe(true)
    expect(toolPairingBalancedAfter(session, checkpoint)).toBe(true)
    expect(() => toolPairingBalancedBefore(session, staleTail)).toThrow(/surface seq .* not found/)
    expect(() => toolPairingBalancedAfter(session, staleTail)).toThrow(/surface seq .* not found/)
  })

  it('answers repeated queries from cached balances', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = closedToolStep()
    /** 中文说明：测试局部值 assistant，由紧邻初始化决定。 */
    const assistant = surfaceSeq(session, seqOf(session, 'assistant/message'))
    expect(toolPairingBalancedAfter(session, assistant)).toBe(false)
    expect(toolPairingBalancedAfter(session, assistant)).toBe(false)
  })

  it('rejects missing seqs before and after, including an empty surface', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('missing-membership'))
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = 999
    expect(() => toolPairingBalancedBefore(session, missing)).toThrow(/surface seq 999 not found/)
    expect(() => toolPairingBalancedAfter(session, missing)).toThrow(/surface seq 999 not found/)

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first node after empty cache' }],
      source: { kind: 'user' },
    }), SURFACE)
    expect(toolPairingBalancedAfter(session, session.surface.nodes[0]!)).toBe(true)
  })
})

describe('tool-pairing cache refresh', () => {
  it('does no event reads for unchanged or log-only growth, folds only appended nodes, and rebuilds on replace', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events: SessionEvent[] = [
      {
        type: 'user/message', seq: 0, time: 0,
        data: createUserMessage({
          content: [{ type: 'text', text: 'user' }], source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'assistant/message', seq: 1, time: 1,
        data: {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'tool-call', id: ToolCallId('c1'), name: 'one', arguments: '{}' }],
            source: {
              kind: 'model',
              ...{ provider: 'mock', model: 'mock' },
            },
          }),
        },
        surfaceOp: 'append',
      },
      {
        type: 'tool/result', seq: 2, time: 2,
        data: {
          turn: 1, step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('c1'),
            content: [],
            isError: false,
          }),
        },
        surfaceOp: 'append',
      },
    ]
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: number[] = [0, 1, 2]
    /** 中文说明：测试局部值 generation，由紧邻初始化决定。 */
    let generation = 0
    /** 中文说明：测试局部值 eventCollectionReads，由紧邻初始化决定。 */
    let eventCollectionReads = 0
    /** 中文说明：测试局部值 eventIndexReads，由紧邻初始化决定。 */
    let eventIndexReads = 0
    /** 中文说明：测试局部值 trackedEvents，由紧邻初始化决定。 */
    const trackedEvents = new Proxy(events, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) eventIndexReads += 1
        return Reflect.get(target, property, receiver) as unknown
      },
    })
    /** 中文说明：测试局部值 surface，由紧邻初始化决定。 */
    const surface = {
      get nodes() { return nodes },
      get replaceGeneration() { return generation },
    }
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = {
      surface,
      get events() {
        eventCollectionReads += 1
        return trackedEvents
      },
    } as unknown as Session

    expect(toolPairingBalancedAfter(session, nodes[2]!)).toBe(true)
    expect(eventCollectionReads).toBe(1)
    expect(eventIndexReads).toBe(3)

    expect(toolPairingBalancedBefore(session, nodes[0]!)).toBe(true)
    expect(toolPairingBalancedAfter(session, nodes[1]!)).toBe(false)
    expect(eventCollectionReads).toBe(1)
    expect(eventIndexReads).toBe(3)

    events.push({
      type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(toolPairingBalancedAfter(session, nodes[2]!)).toBe(true)
    expect(eventCollectionReads).toBe(1)
    expect(eventIndexReads).toBe(3)

    events.push({
      type: 'user/message', seq: 4, time: 4,
      data: createUserMessage({
        content: [{ type: 'text', text: 'tail' }], source: { kind: 'user' },
      }),
      surfaceOp: 'append',
    })
    nodes.push(4)
    expect(toolPairingBalancedAfter(session, nodes[3]!)).toBe(true)
    expect(eventCollectionReads).toBe(2)
    expect(eventIndexReads).toBe(4)

    events.push(
      {
        type: 'assistant/message', seq: 5, time: 5,
        data: {
          turn: 2,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'tool-call', id: ToolCallId('c2'), name: 'two', arguments: '{}' }],
            source: {
              kind: 'model',
              ...{ provider: 'mock', model: 'mock' },
            },
          }),
        },
        surfaceOp: 'append',
      },
      {
        type: 'tool/result', seq: 6, time: 6,
        data: {
          turn: 2, step: 1,
          message: createToolResultMessage({
            callId: ToolCallId('c2'),
            content: [],
            isError: false,
          }),
        },
        surfaceOp: 'append',
      },
    )
    nodes.push(5, 6)
    expect(toolPairingBalancedAfter(session, nodes[5]!)).toBe(true)
    expect(eventCollectionReads).toBe(3)
    expect(eventIndexReads).toBe(6)

    events.push({
      type: 'user/message', seq: 7, time: 7,
      data: createUserMessage({
        content: [{ type: 'text', text: 'replacement' }], source: { kind: 'user' },
      }),
      surfaceOp: { op: 'replace', start: 0, end: 6 },
    })
    nodes.splice(0, nodes.length, 7)
    generation += 1
    expect(toolPairingBalancedAfter(session, nodes[0]!)).toBe(true)
    expect(eventCollectionReads).toBe(4)
    expect(eventIndexReads).toBe(7)
  })

  it('rebuilds defensively when a same-generation surface entry count regresses', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events: SessionEvent[] = [
      {
        type: 'user/message', seq: 0, time: 0,
        data: createUserMessage({
          content: [], source: { kind: 'user' },
        }), surfaceOp: 'append',
      },
      {
        type: 'user/message', seq: 1, time: 1,
        data: createUserMessage({
          content: [], source: { kind: 'user' },
        }), surfaceOp: 'append',
      },
    ]
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    const nodes: number[] = [0, 1]
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = {
      events,
      surface: { nodes, replaceGeneration: 0 },
    } as unknown as Session
    expect(toolPairingBalancedAfter(session, nodes[1]!)).toBe(true)
    nodes.pop()
    expect(toolPairingBalancedAfter(session, nodes[0]!)).toBe(true)
  })
})

describe('tool-pairing corrupt surfaces', () => {
  it('throws for an orphan result during a rebuild', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('orphan-rebuild'))
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('orphan'),
        content: [],
        isError: false,
      }),
    }, SURFACE)
    expect(() => toolPairingBalancedAfter(session, session.surface.nodes[0]!)).toThrow(/no matching tool-call/)
  })

  it('retries an orphan result in an appended tail without committing partial cache state', () => {
    /** 中文说明：测试局部值 session，由紧邻初始化决定。 */
    const session = Session.create(SessionId('orphan-tail'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'safe head' }], source: { kind: 'user' },
    }), SURFACE)
    expect(toolPairingBalancedAfter(session, session.surface.nodes[0]!)).toBe(true)
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: ToolCallId('orphan'),
        content: [],
        isError: false,
      }),
    }, SURFACE)
    expect(() => toolPairingBalancedAfter(session, session.surface.nodes[1]!)).toThrow(/no matching tool-call/)
    expect(() => toolPairingBalancedAfter(session, session.surface.nodes[1]!)).toThrow(/no matching tool-call/)
  })

  it('throws when a current surface seq has no matching event or indexes the wrong event', () => {
    /** 中文说明：测试局部值 missingSeq，由紧邻初始化决定。 */
    const missingSeq = 1
    /** 中文说明：测试局部值 missing，由紧邻初始化决定。 */
    const missing = {
      events: [{
        type: 'user/message', seq: 0, time: 0,
        data: createUserMessage({
          content: [], source: { kind: 'user' },
        }), surfaceOp: 'append',
      } satisfies SessionEvent],
      surface: { nodes: [missingSeq], replaceGeneration: 0 },
    } as unknown as Session
    expect(() => toolPairingBalancedBefore(missing, missingSeq)).toThrow(/no matching session event/)

    /** 中文说明：测试局部值 mismatchedSeq，由紧邻初始化决定。 */
    const mismatchedSeq = 0
    /** 中文说明：测试局部值 mismatched，由紧邻初始化决定。 */
    const mismatched = {
      events: [{
        type: 'user/message', seq: 99, time: 0,
        data: createUserMessage({
          content: [], source: { kind: 'user' },
        }), surfaceOp: 'append',
      } satisfies SessionEvent],
      surface: { nodes: [mismatchedSeq], replaceGeneration: 0 },
    } as unknown as Session
    expect(() => toolPairingBalancedBefore(mismatched, mismatchedSeq)).toThrow(/no matching session event/)
  })
})
