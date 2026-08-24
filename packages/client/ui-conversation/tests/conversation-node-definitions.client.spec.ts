/**
 * 文件职责：验证会话界面的 conversation-node-definitions.client.spec.ts 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */
import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition, nextTurnInboxDefinition } from '../src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { retryDefinition } from '../src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../src/client/conversation-nodes/turn-max-tokens.ts'
import { turnTailDefinition } from '../src/client/conversation-nodes/turn-tail.ts'
import type {
  AssistantChatData, ManualCompactionChatData, RetryChatData, ToolChatData, TurnTailChatData,
} from '../src/client/contract/chat-nodes.ts'

/** 中文说明：测试局部值 DEFINITIONS，取值由紧邻初始化决定。 */
const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  nextTurnInboxDefinition,
  nextStepInboxDefinition,
  messageDefinition,
  assistantDefinition,
  toolDefinition,
  commandDefinition,
  compactionDefinition,
  retryDefinition,
  turnErrorDefinition,
  turnMaxTokensDefinition,
  turnTailDefinition,
]

/** 中文说明：类型或类 TestEventDefinitions 约束本文件的数据或组件职责。 */
class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

/** 中文说明：类型或类 TestViewDefinitions 约束本文件的数据或组件职责。 */
class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

/** 中文说明：函数 at 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

/** 中文说明：函数 assembler 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function assembler(entries: readonly ConversationEventInput[] = [], hasMore = false): ConversationNodeAssembler {
  /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

/** 中文说明：函数 snapshot 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function snapshot(value: ConversationNodeAssembler): ChatSnapshot {
  /** 中文说明：测试局部值 current，取值由紧邻初始化决定。 */
  const current = value.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

/** 中文说明：函数 node 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function node(value: ChatSnapshot, kind: string): ChatConversationViewNode | undefined {
  return value.nodes.values().find(candidate => candidate.kind === kind)
}

/** 中文说明：函数 textMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function textMessage(id: string, text: string) {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/** 中文说明：函数 assistantMessage 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function assistantMessage(id: string, text: string) {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    source: { kind: 'model', provider: 'fake', model: 'fake' },
  }
}

/** 中文说明：函数 toolResult 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function toolResult(callId: string, text: string) {
  return {
    id: `result-${callId}`,
    role: 'user',
    source: { kind: 'tool', callId },
    content: [{
      type: 'tool-result',
      toolCallId: callId,
      content: [{ type: 'text', text }],
      isError: false,
    }],
  }
}

describe('built-in conversation node Definitions', () => {
  it('keeps one keyed Assistant node while streaming settles and materializes interruption from Location', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'streaming' },
      }),
    ])
    /** 中文说明：状态快照 runningSnapshot，取值由紧邻初始化决定。 */
    const runningSnapshot = snapshot(value)
    /** 中文说明：测试局部值 running，取值由紧邻初始化决定。 */
    const running = node(runningSnapshot, 'assistant-step')
    expect(running?.data).toMatchObject({ status: 'running', blocks: [{ kind: 'text', text: 'streaming' }] })
    /** 中文说明：测试局部值 order，取值由紧邻初始化决定。 */
    const order = runningSnapshot.order

    value.append(at(4, 'assistant/message', {
      turn: 1,
      step: 1,
      message: assistantMessage('assistant-1', 'settled'),
    }, { surfaceOp: 'append' }))
    value.flush()

    /** 中文说明：状态快照 settledSnapshot，取值由紧邻初始化决定。 */
    const settledSnapshot = snapshot(value)
    /** 中文说明：测试局部值 settled，取值由紧邻初始化决定。 */
    const settled = node(settledSnapshot, 'assistant-step')
    expect(settled?.key).toBe(running?.key)
    expect(settledSnapshot.order).toBe(order)
    expect(settled?.data).toMatchObject({ status: 'settled', blocks: [{ kind: 'text', text: 'settled' }] })

    /** 中文说明：测试局部值 interruptedValue，取值由紧邻初始化决定。 */
    const interruptedValue = assembler([
      at(10, 'turn/start', { turn: 2 }),
      at(11, 'step/start', { turn: 2, step: 1 }),
      at(12, 'assistant/chunk', {
        turn: 2,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'partial' },
      }),
      at(13, 'step/end', { turn: 2, step: 1 }),
    ])
    /** 中文说明：测试局部值 interrupted，取值由紧邻初始化决定。 */
    const interrupted = node(snapshot(interruptedValue), 'assistant-step')
    expect(interrupted?.data).toMatchObject({ status: 'interrupted' })
    expect((interrupted?.data as AssistantChatData).finalNode?.interrupted).toBe(true)

    /** 中文说明：测试局部值 markedValue，取值由紧邻初始化决定。 */
    const markedValue = assembler([
      at(20, 'turn/start', { turn: 3 }),
      at(21, 'step/start', { turn: 3, step: 1 }),
      at(22, 'assistant/message', {
        turn: 3,
        step: 1,
        message: assistantMessage('assistant-3', 'cut short'),
        interrupted: true,
      }, { surfaceOp: 'append' }),
    ])
    /** 中文说明：测试局部值 marked，取值由紧邻初始化决定。 */
    const marked = node(snapshot(markedValue), 'assistant-step')
    expect(marked?.data).toMatchObject({ status: 'interrupted', blocks: [{ kind: 'text', text: 'cut short' }] })
    expect((marked?.data as AssistantChatData).finalNode?.interrupted).toBe(true)

    /** 中文说明：测试局部值 hiddenValue，取值由紧邻初始化决定。 */
    const hiddenValue = assembler([
      at(20, 'turn/start', { turn: 3 }),
      at(21, 'step/start', { turn: 3, step: 1 }),
      at(22, 'llm/retry', {
        retryId: 'retry-hidden',
        turn: 3,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 1,
        maxRetries: 2,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'temporary' },
      }),
    ])
    expect(node(snapshot(hiddenValue), 'assistant-step')).toBeUndefined()

    /** 中文说明：测试局部值 toolOnlyValue，取值由紧邻初始化决定。 */
    const toolOnlyValue = assembler([
      at(30, 'turn/start', { turn: 4 }),
      at(31, 'step/start', { turn: 4, step: 1 }),
      at(32, 'assistant/chunk', {
        turn: 4,
        step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'read', argumentsDelta: '' },
      }),
      at(33, 'assistant/message', {
        turn: 4,
        step: 1,
        message: {
          ...assistantMessage('assistant-tool-only', ''),
          content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }],
        },
      }, { surfaceOp: 'append' }),
    ])
    /** 中文说明：状态快照 toolOnlySnapshot，取值由紧邻初始化决定。 */
    const toolOnlySnapshot = snapshot(toolOnlyValue)
    expect(toolOnlySnapshot.order).toEqual([])
    expect(node(toolOnlySnapshot, 'assistant-step')?.visibility).toBe('hidden')
    expect(toolOnlySnapshot.legacy.nodes).toMatchObject([{
      kind: 'assistant',
      seq: 33,
      timing: { firstTokenTime: 1_700_000_000_032 },
    }])

    /** 中文说明：测试局部值 interruptedToolOnlyValue，取值由紧邻初始化决定。 */
    const interruptedToolOnlyValue = assembler([
      at(35, 'turn/start', { turn: 5 }),
      at(36, 'step/start', { turn: 5, step: 1 }),
      at(37, 'assistant/chunk', {
        turn: 5,
        step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call-2', name: 'read', argumentsDelta: '' },
      }),
      at(38, 'step/end', { turn: 5, step: 1 }),
    ])
    /** 中文说明：测试局部值 interruptedToolOnly，取值由紧邻初始化决定。 */
    const interruptedToolOnly = node(snapshot(interruptedToolOnlyValue), 'assistant-step')
    expect(interruptedToolOnly?.visibility).toBe('visible')
    expect(interruptedToolOnly?.data).toMatchObject({ status: 'interrupted' })

    /** 中文说明：测试局部值 retryTimingValue，取值由紧邻初始化决定。 */
    const retryTimingValue = assembler([
      at(50, 'turn/start', { turn: 6 }),
      at(51, 'step/start', { turn: 6, step: 1 }),
      at(52, 'assistant/chunk', {
        turn: 6,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'first attempt' },
      }),
      at(53, 'llm/retry', {
        retryId: 'retry-timing', turn: 6, step: 1, provider: 'fake', mode: 'normal',
        policyKey: 'fake-normal', retry: 1, maxRetries: 2, delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'temporary' },
      }),
      at(54, 'assistant/chunk', {
        turn: 6,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'second attempt' },
      }),
      at(55, 'assistant/message', {
        turn: 6,
        step: 1,
        message: assistantMessage('assistant-retried', 'done'),
      }, { surfaceOp: 'append' }),
    ])
    /** 中文说明：测试局部值 retryTiming，取值由紧邻初始化决定。 */
    const retryTiming = (node(snapshot(retryTimingValue), 'assistant-step')?.data as AssistantChatData).finalNode
    expect(retryTiming?.timing?.firstTokenTime).toBe(1_700_000_000_052)

    /** 中文说明：测试局部值 partialWindow，取值由紧邻初始化决定。 */
    const partialWindow = assembler([
      at(40, 'assistant/chunk', {
        turn: 5,
        step: 2,
        chunk: { type: 'text-delta', index: 0, text: 'loaded partial' },
      }),
      at(41, 'step/end', { turn: 5, step: 2 }),
    ], true)
    /** 中文说明：测试局部值 recovered，取值由紧邻初始化决定。 */
    const recovered = node(snapshot(partialWindow), 'assistant-step')
    expect(recovered?.data).toMatchObject({
      status: 'interrupted',
      blocks: [{ kind: 'text', text: 'loaded partial' }],
    })
  })

  it('keeps one keyed Tool node from running through settlement and replays nested dispatch after prepend', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool/call', { turn: 1, step: 1, callId: 'root', name: 'code', arguments: '{}' }),
    ])
    /** 中文说明：状态快照 runningSnapshot，取值由紧邻初始化决定。 */
    const runningSnapshot = snapshot(value)
    /** 中文说明：测试局部值 running，取值由紧邻初始化决定。 */
    const running = node(runningSnapshot, 'tool-call')
    expect((running?.data as ToolChatData).root).toMatchObject({ callId: 'root', name: 'code' })
    /** 中文说明：测试局部值 order，取值由紧邻初始化决定。 */
    const order = runningSnapshot.order

    value.append(at(4, 'tool/result', {
      turn: 1,
      step: 1,
      message: toolResult('root', 'done'),
    }, { surfaceOp: 'append' }))
    value.flush()

    /** 中文说明：状态快照 settledSnapshot，取值由紧邻初始化决定。 */
    const settledSnapshot = snapshot(value)
    /** 中文说明：测试局部值 settled，取值由紧邻初始化决定。 */
    const settled = node(settledSnapshot, 'tool-call')
    expect(settled?.key).toBe(running?.key)
    expect(settledSnapshot.order).toBe(order)
    expect((settled?.data as ToolChatData).root).toMatchObject({ kind: 'tool-result', callId: 'root' })

    /** 中文说明：测试局部值 history，取值由紧邻初始化决定。 */
    const history = assembler([
      at(14, 'tool/code-dispatch-start', {
        rootCallId: 'history-root',
        parentCallId: 'history-root',
        subCallId: 'child',
        name: 'read',
        arguments: { path: 'README.md' },
      }),
      at(15, 'tool/code-dispatch', {
        rootCallId: 'history-root',
        parentCallId: 'history-root',
        subCallId: 'child',
        name: 'read',
        arguments: { path: 'README.md' },
        isError: false,
        content: [{ type: 'text', text: 'contents' }],
      }),
      at(16, 'tool/result', {
        turn: 2,
        step: 1,
        message: toolResult('history-root', 'root done'),
      }, { surfaceOp: 'append' }),
    ], true)
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = node(snapshot(history), 'tool-call')
    expect((before?.data as ToolChatData).root.subCalls).toMatchObject([
      { kind: 'tool-result', callId: 'child', call: { name: 'read' } },
    ])

    history.prepend([
      at(10, 'turn/start', { turn: 2 }),
      at(11, 'step/start', { turn: 2, step: 1 }),
      at(13, 'tool/call', {
        turn: 2,
        step: 1,
        callId: 'history-root',
        name: 'code',
        arguments: '{}',
      }),
    ], false)
    history.flush()

    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = node(snapshot(history), 'tool-call')
    expect(after?.key).toBe(before?.key)
    expect((after?.data as ToolChatData).root.subCalls).toMatchObject([
      { kind: 'tool-result', callId: 'child', call: { name: 'read' } },
    ])

    /** 中文说明：测试局部值 firstChild，取值由紧邻初始化决定。 */
    const firstChild = (after?.data as ToolChatData).root.subCalls[0]
    history.append(at(17, 'tool/code-dispatch-start', {
      rootCallId: 'history-root',
      parentCallId: 'history-root',
      subCallId: 'second-child',
      name: 'write',
      arguments: { path: 'out.txt' },
    }))
    history.flush()
    /** 中文说明：测试局部值 withSecondChild，取值由紧邻初始化决定。 */
    const withSecondChild = node(snapshot(history), 'tool-call')
    expect((withSecondChild?.data as ToolChatData).root.subCalls[0]).toBe(firstChild)
  })

  it('prepends an older turn without replacing already materialized nodes', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(20, 'turn/start', { turn: 2 }),
      at(21, 'user/message', textMessage('newer-user', 'newer'), { surfaceOp: 'append' }),
      at(22, 'step/start', { turn: 2, step: 1 }),
      at(23, 'assistant/message', {
        turn: 2,
        step: 1,
        message: assistantMessage('newer-assistant', 'newer answer'),
      }, { surfaceOp: 'append' }),
      at(24, 'step/end', { turn: 2, step: 1 }),
      at(25, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ], true)
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = snapshot(value)
    /** 中文说明：测试局部值 existing，取值由紧邻初始化决定。 */
    const existing = before.nodes.get(before.order.find(key => before.nodes.get(key)?.kind === 'assistant-step') ?? '')
    /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
    const store = before.nodes

    value.prepend([
      at(10, 'turn/start', { turn: 1 }),
      at(11, 'user/message', textMessage('older-user', 'older'), { surfaceOp: 'append' }),
      at(12, 'step/start', { turn: 1, step: 1 }),
      at(13, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('older-assistant', 'older answer'),
      }, { surfaceOp: 'append' }),
      at(14, 'step/end', { turn: 1, step: 1 }),
      at(15, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ], false)
    value.flush()

    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = snapshot(value)
    expect(after.nodes).toBe(store)
    expect(after.nodes.get(existing?.key ?? '')).toBe(existing)
    expect(after.order).toHaveLength(before.order.length + 3)
    expect(after.order.map(key => after.nodes.get(key)?.kind)).toEqual([
      'user', 'assistant-step', 'turn-tail',
      'user', 'assistant-step', 'turn-tail',
    ])
  })

  it('appends a later turn without replacing nodes from the completed turn', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'user/message', textMessage('first-user', 'first'), { surfaceOp: 'append' }),
      at(3, 'step/start', { turn: 1, step: 1 }),
      at(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('first-assistant', 'first answer'),
      }, { surfaceOp: 'append' }),
      at(5, 'step/end', { turn: 1, step: 1 }),
      at(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = snapshot(value)
    /** 中文说明：测试局部值 oldOrder，取值由紧邻初始化决定。 */
    const oldOrder = before.order
    /** 中文说明：有序集合 oldNodes，取值由紧邻初始化决定。 */
    const oldNodes = oldOrder.map(key => before.nodes.get(key))

    value.append(at(7, 'turn/start', { turn: 2 }))
    value.append(at(8, 'user/message', textMessage('second-user', 'second'), { surfaceOp: 'append' }))
    value.flush()

    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = snapshot(value)
    expect(after.nodes).toBe(before.nodes)
    expect(after.order.slice(0, oldOrder.length)).toEqual(oldOrder)
    expect(oldOrder.map(key => after.nodes.get(key))).toEqual(oldNodes)
    expect(after.order.map(key => after.nodes.get(key)?.kind)).toEqual([
      'user', 'assistant-step', 'turn-tail', 'user',
    ])
  })

  it('keeps branching unavailable when a tool result follows the closing Assistant', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-before-tool', 'running a tool'),
      }, { surfaceOp: 'append' }),
      at(4, 'tool/call', { turn: 1, step: 1, callId: 'late-tool', name: 'read', arguments: '{}' }),
      at(5, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('late-tool', 'done'),
      }, { surfaceOp: 'append' }),
      at(6, 'step/end', { turn: 1, step: 1 }),
      at(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    /** 中文说明：测试局部值 tail，取值由紧邻初始化决定。 */
    const tail = node(snapshot(value), 'turn-tail')?.data as TurnTailChatData
    expect(tail.closing?.finalNode.seq).toBe(3)
    expect(tail.branchUnavailable).toBe(true)
  })

  it('replays inbox predecessors after prepend and reclassifies the dependent message as steering', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(3, 'user/message', textMessage('steer-1', 'change direction'), { surfaceOp: 'append' }),
    ], true)
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = node(snapshot(value), 'user')
    expect(before).toBeDefined()

    value.prepend([
      at(1, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        inserted: [textMessage('steer-1', 'change direction')],
      }),
      at(2, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        removedCount: 1,
        inserted: [],
      }),
    ], false)
    value.flush()

    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = node(snapshot(value), 'steering')
    expect(after?.key).toBe(before?.key)
    expect(after?.data).toMatchObject({ kind: 'steering', messageId: 'steer-1' })
    expect(node(snapshot(value), 'user')).toBeUndefined()
  })

  it('orders claimed steering after the finalized Turn tail', () => {
    /** 中文说明：测试局部值 steering，取值由紧邻初始化决定。 */
    const steering = textMessage('steer-after-answer', 'change direction')
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('assistant-before-steering', 'initial answer'),
      }, { surfaceOp: 'append' }),
      at(4, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        inserted: [steering],
      }),
      at(5, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        removedCount: 1,
        inserted: [],
      }),
      at(6, 'user/message', steering, { surfaceOp: 'append' }),
      at(7, 'step/end', { turn: 1, step: 1 }),
      at(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    /** 中文说明：测试局部值 current，取值由紧邻初始化决定。 */
    const current = snapshot(value)
    /** 中文说明：测试局部值 steeringNode，取值由紧邻初始化决定。 */
    const steeringNode = node(current, 'steering')
    expect(steeringNode).toBeDefined()
    expect(current.locations.getTurn(1).at(-1)).toBe(steeringNode?.key)
  })

  it('classifies appended producer context from durable source metadata', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'user/message', {
        ...textMessage('skill-context', 'follow these instructions'),
        source: { kind: 'skill-invocation', name: 'demo-skill', form: 'instructions' },
      }, { surfaceOp: 'append' }),
    ])

    expect(node(snapshot(value), 'context')?.data).toMatchObject({
      kind: 'context',
      provenance: { role: 'inject', label: 'demo-skill' },
      form: 'instructions',
    })
  })

  it('associates each direct message with its immediately following session recall', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'user/message', textMessage('citing-research', '@Research notes what changed?'), { surfaceOp: 'append' }),
      at(2, 'user/message', {
        ...textMessage('research-context', 'snapshot'),
        source: {
          kind: 'session-reference',
          form: 'recall',
          version: 1,
          references: [{ sessionId: 'source-a', label: 'Research notes' }],
        },
      }, { surfaceOp: 'append' }),
      at(3, 'user/message', textMessage('citing-review', '@Review next'), { surfaceOp: 'append' }),
      at(4, 'user/message', {
        ...textMessage('review-context', 'snapshot'),
        source: {
          kind: 'session-reference',
          form: 'recall',
          version: 1,
          references: [{ sessionId: 'source-b', label: 'Review' }],
        },
      }, { surfaceOp: 'append' }),
      at(6, 'user/message', textMessage('later-user', 'unrelated'), { surfaceOp: 'append' }),
    ])

    /** 中文说明：测试局部值 current，取值由紧邻初始化决定。 */
    const current = snapshot(value)
    /** 中文说明：当前数据 messages，取值由紧邻初始化决定。 */
    const messages = [...current.nodes.values()]
      .filter(candidate => candidate.kind === 'user' || candidate.kind === 'context')
    /** 中文说明：测试局部值 users，取值由紧邻初始化决定。 */
    const users = [...current.nodes.values()].filter(candidate => candidate.kind === 'user')
    expect(messages.map(candidate => candidate.kind)).toEqual(['user', 'context', 'user', 'context', 'user'])
    expect(users[0]?.data).toMatchObject({ referenceLabels: ['Research notes'] })
    expect(users[1]?.data).toMatchObject({ referenceLabels: ['Review'] })
    expect(users[2]?.data).not.toHaveProperty('referenceLabels')
  })

  it('updates an already published direct node when its following recall arrives', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'user/message', textMessage('citing-user', '@Research notes what changed?'), { surfaceOp: 'append' }),
    ])
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = node(snapshot(value), 'user')
    expect(before?.data).not.toHaveProperty('referenceLabels')

    value.append(at(2, 'user/message', {
      ...textMessage('reference-context', 'snapshot'),
      source: {
        kind: 'session-reference',
        form: 'recall',
        version: 1,
        references: [{ sessionId: 'source-a', label: 'Research notes' }],
      },
    }, { surfaceOp: 'append' }))
    value.flush()

    /** 中文说明：测试局部值 current，取值由紧邻初始化决定。 */
    const current = snapshot(value)
    /** 中文说明：有序集合 nodes，取值由紧邻初始化决定。 */
    const nodes = [...current.nodes.values()]
      .filter(candidate => candidate.kind === 'user' || candidate.kind === 'context')
    expect(nodes.map(candidate => candidate.kind)).toEqual(['user', 'context'])
    expect(nodes[0]?.key).toBe(before?.key)
    expect(nodes[0]?.data).toMatchObject({ referenceLabels: ['Research notes'] })
    expect(current.legacy.nodes[0]).toMatchObject({ referenceLabels: ['Research notes'] })
  })

  it('associates a claimed steering message with its following recall', () => {
    /** 中文说明：测试局部值 steering，取值由紧邻初始化决定。 */
    const steering = textMessage('steering-reference', '@Research notes continue')
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        inserted: [steering],
      }),
      at(2, 'agent/inbox/spliced', {
        target: 'next-step',
        start: 0,
        removedCount: 1,
        inserted: [],
      }),
      at(3, 'user/message', steering, { surfaceOp: 'append' }),
      at(4, 'user/message', {
        ...textMessage('steering-reference-context', 'snapshot'),
        source: {
          kind: 'session-reference',
          form: 'recall',
          version: 1,
          references: [{ sessionId: 'source-a', label: 'Research notes' }],
        },
      }, { surfaceOp: 'append' }),
    ])

    expect(node(snapshot(value), 'steering')?.data).toMatchObject({
      messageId: 'steering-reference',
      referenceLabels: ['Research notes'],
    })
  })

  it('keeps replacement copies out of Chat business nodes', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'user/message', {
        ...textMessage('replacement-user', 'model-only context'),
        source: { kind: 'plugin', plugin: 'foreign' },
      }, { surfaceOp: { op: 'replace', start: 1, end: 1 } }),
      at(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: assistantMessage('replacement-assistant', 'rewritten answer'),
      }, { surfaceOp: { op: 'replace', start: 2, end: 2 } }),
      at(5, 'tool/call', { turn: 1, step: 1, callId: 'root', name: 'read', arguments: '{}' }),
      at(6, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('root', 'pruned result'),
      }, { surfaceOp: { op: 'replace', start: 3, end: 3 } }),
    ])

    /** 中文说明：测试局部值 current，取值由紧邻初始化决定。 */
    const current = snapshot(value)
    expect(node(current, 'user')).toBeUndefined()
    expect(node(current, 'context')).toBeUndefined()
    expect(node(current, 'assistant-step')).toBeUndefined()
    expect((node(current, 'tool-call')?.data as ToolChatData).root).not.toHaveProperty('kind')
  })

  it('assembles retry chains and keeps manual and automatic compaction ownership separate', () => {
    /** 中文说明：测试局部值 retry，取值由紧邻初始化决定。 */
    const retry = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'llm/retry', {
        retryId: 'retry-1',
        turn: 1,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 1,
        maxRetries: 2,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'first' },
      }),
      at(4, 'llm/retry-started', { retryId: 'retry-1', turn: 1, step: 1, retry: 1 }),
      at(5, 'llm/retry', {
        retryId: 'retry-1',
        turn: 1,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 2,
        maxRetries: 2,
        delayMs: 20,
        failure: { code: 'TRANSPORT', message: 'second' },
      }),
      at(6, 'step/end', { turn: 1, step: 1 }),
      at(7, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'failed' } },
      }),
    ])
    /** 中文说明：测试局部值 retryNode，取值由紧邻初始化决定。 */
    const retryNode = node(snapshot(retry), 'model-retry')
    /** 中文说明：测试局部值 retryData，取值由紧邻初始化决定。 */
    const retryData = retryNode?.data as RetryChatData
    expect(retryData.attempts.map(attempt => attempt.retryState)).toEqual(['started', 'cancelled'])
    expect(node(snapshot(retry), 'turn-error')?.data).toMatchObject({
      kind: 'turn-error',
      turn: 1,
      message: 'failed',
      code: 'TRANSPORT',
    })

    /** 中文说明：测试局部值 compactions，取值由紧邻初始化决定。 */
    const compactions = assembler([
      at(10, 'command/run', {
        commandId: 'command-1',
        name: 'compact',
        source: { kind: 'user' },
      }),
      at(11, 'compaction/start', {
        compactionId: 'manual-1',
        sourceCommandId: 'command-1',
        turn: null,
      }),
      at(12, 'compaction/summary', {
        compactionId: 'manual-1',
        sourceCommandId: 'command-1',
        summary: [{ type: 'text', text: 'manual summary' }],
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 100,
      }),
      at(13, 'user/message', {
        ...textMessage('manual-checkpoint', 'checkpoint'),
        source: {
          kind: 'plugin',
          plugin: 'compact',
          compactionId: 'manual-1',
          sourceCommandId: 'command-1',
        },
      }, { surfaceOp: { op: 'replace', start: 1, end: 2 } }),
      at(14, 'compaction/end', {
        compactionId: 'manual-1',
        sourceCommandId: 'command-1',
        turn: null,
      }),
      at(15, 'command/done', {
        commandId: 'command-1',
        kind: 'success',
        sourceEventSeq: 12,
      }),
      at(20, 'compaction/start', { compactionId: 'automatic-1', turn: null }),
      at(21, 'compaction/summary', {
        compactionId: 'automatic-1',
        summary: [{ type: 'text', text: 'automatic summary' }],
        shadowedSeqs: [3, 4],
        shadowedTokenCount: 200,
      }),
      at(22, 'user/message', {
        ...textMessage('automatic-checkpoint', 'checkpoint'),
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'automatic-1' },
      }, { surfaceOp: { op: 'replace', start: 3, end: 4 } }),
      at(23, 'compaction/end', { compactionId: 'automatic-1', turn: null }),
    ])

    /** 中文说明：测试局部值 manual，取值由紧邻初始化决定。 */
    const manual = node(snapshot(compactions), 'manual-compaction')
    expect((manual?.data as ManualCompactionChatData).compaction).toMatchObject({
      summary: 'manual summary',
      summaryEventSeq: 12,
    })
    /** 中文说明：测试局部值 automatic，取值由紧邻初始化决定。 */
    const automatic = node(snapshot(compactions), 'compaction')
    expect(automatic?.data).toMatchObject({ summary: 'automatic summary', summaryEventSeq: 21 })
    expect(snapshot(compactions).nodes.values().filter(candidate => candidate.kind === 'compaction')).toHaveLength(1)
  })

  it('fills a landed compaction marker when an older page supplies its summary', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(13, 'user/message', {
        ...textMessage('checkpoint', 'checkpoint'),
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact-1' },
      }, { surfaceOp: { op: 'replace', start: 1, end: 8 } }),
    ], true)
    /** 中文说明：测试局部值 before，取值由紧邻初始化决定。 */
    const before = node(snapshot(value), 'compaction')
    expect(before?.data).toMatchObject({ summary: null, summaryEventSeq: null })

    value.prepend([
      at(9, 'compaction/start', { compactionId: 'compact-1', turn: null }),
      at(10, 'compaction/summary', {
        compactionId: 'compact-1',
        summary: [
          { type: 'text', text: 'older ' },
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'summary' },
        ],
        shadowedSeqs: [1, 2, 3],
        shadowedTokenCount: 42,
      }),
    ], false)
    value.flush()

    /** 中文说明：测试局部值 after，取值由紧邻初始化决定。 */
    const after = node(snapshot(value), 'compaction')
    expect(after?.key).toBe(before?.key)
    expect(after?.data).toMatchObject({
      summary: 'older summary',
      summaryEventSeq: 10,
      shadowedItemCount: 3,
      shadowedTokenCount: 42,
    })
  })

  it('renders a historical compaction when its start remains outside the loaded window', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(10, 'compaction/summary', {
        compactionId: 'compact-windowed',
        summary: [{ type: 'text', text: 'loaded summary' }],
        shadowedSeqs: [1, 2, 3],
        shadowedTokenCount: 42,
      }),
      at(11, 'user/message', {
        ...textMessage('checkpoint-windowed', 'checkpoint'),
        source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact-windowed' },
      }, { surfaceOp: { op: 'replace', start: 1, end: 3 } }),
    ], true)

    expect(node(snapshot(value), 'compaction')?.data).toMatchObject({
      summary: 'loaded summary',
      summaryEventSeq: 10,
      shadowedItemCount: 3,
      shadowedTokenCount: 42,
    })
  })

  it('ignores legacy compaction transactions without correlation ids', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(10, 'compaction/start', { turn: null }),
      at(11, 'compaction/end', { turn: null, error: 'This operation was aborted' }),
      at(20, 'compaction/start', { turn: null }),
      at(21, 'compaction/summary', {
        summary: [{ type: 'text', text: 'legacy summary' }],
        shadowedSeqs: [1, 2, 3],
        shadowedTokenCount: 42,
      }),
      at(22, 'user/message', {
        ...textMessage('legacy-checkpoint', 'checkpoint'),
        source: { kind: 'plugin', plugin: 'compact' },
      }, { surfaceOp: { op: 'replace', start: 1, end: 3 } }),
      at(23, 'compaction/end', { turn: null }),
    ], true)

    expect(node(snapshot(value), 'compaction')).toBeUndefined()
  })

  it('ignores legacy retry and code-dispatch events without correlation ids', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(10, 'llm/retry', {
        turn: 1,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 1,
        maxRetries: 2,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'first legacy retry' },
      }),
      at(11, 'llm/retry-started', { turn: 1, step: 1, retry: 1 }),
      at(20, 'llm/retry', {
        turn: 2,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 1,
        maxRetries: 2,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'second legacy retry' },
      }),
      at(30, 'tool/code-dispatch-start', {
        parentCallId: 'root',
        subCallId: 'child',
        name: 'legacy-subcall',
        arguments: {},
      }),
      at(31, 'tool/code-dispatch', {
        parentCallId: 'root',
        subCallId: 'child',
        name: 'legacy-subcall',
        arguments: {},
        content: [],
      }),
    ], true)

    expect(node(snapshot(value), 'model-retry')).toBeUndefined()
    expect(node(snapshot(value), 'tool-call')).toBeUndefined()
  })

  it('renders the exhausted-retry turn error in a partial tail window and after prepending the chain', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(5, 'llm/retry', {
        retryId: 'retry-paged',
        turn: 1,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 2,
        maxRetries: 2,
        delayMs: 20,
        failure: { code: 'TRANSPORT', message: 'second' },
      }),
      at(6, 'step/end', { turn: 1, step: 1 }),
      at(7, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'failed' } },
      }),
    ], true)

    expect(node(snapshot(value), 'model-retry')).toBeUndefined()
    expect(node(snapshot(value), 'turn-error')?.data).toMatchObject({
      kind: 'turn-error',
      seq: 7,
      turn: 1,
      message: 'failed',
      code: 'TRANSPORT',
    })

    value.prepend([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'llm/retry', {
        retryId: 'retry-paged',
        turn: 1,
        step: 1,
        provider: 'fake',
        mode: 'normal',
        policyKey: 'fake-normal',
        retry: 1,
        maxRetries: 2,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'first' },
      }),
      at(4, 'llm/retry-started', {
        retryId: 'retry-paged', turn: 1, step: 1, retry: 1,
      }),
    ], false)
    value.flush()

    /** 中文说明：测试局部值 retry，取值由紧邻初始化决定。 */
    const retry = node(snapshot(value), 'model-retry')
    expect((retry?.data as RetryChatData).attempts).toHaveLength(2)
    expect(node(snapshot(value), 'turn-error')?.data).toMatchObject({
      kind: 'turn-error',
      seq: 7,
      turn: 1,
      message: 'failed',
      code: 'TRANSPORT',
    })
  })

  it('materializes a max-tokens notice and keeps completed and error turns clean', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/message', {
        turn: 1, step: 1, message: assistantMessage('a1', 'truncated answer'),
      }, { surfaceOp: 'append' }),
      at(4, 'step/end', { turn: 1, step: 1 }),
      at(5, 'turn/end', { turn: 1, reason: { kind: 'max-tokens' } }),
    ])
    /** 中文说明：测试局部值 notice，取值由紧邻初始化决定。 */
    const notice = node(snapshot(value), 'turn-max-tokens')
    expect(notice?.data).toMatchObject({ kind: 'turn-max-tokens', seq: 5, turn: 1, step: 1 })
    expect(node(snapshot(value), 'turn-error')).toBeUndefined()
    // The tail stays the turn's last node so its branch action survives; the
    // notice slots between the truncated closing Assistant and the tail.
    /** 中文说明：测试局部值 tail，取值由紧邻初始化决定。 */
    const tail = node(snapshot(value), 'turn-tail')
    expect(notice?.anchorSeq).toBeLessThan(tail?.anchorSeq ?? Number.NEGATIVE_INFINITY)
    expect(notice?.anchorSeq).toBeGreaterThan(3)

    /** 中文说明：测试局部值 completed，取值由紧邻初始化决定。 */
    const completed = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(node(snapshot(completed), 'turn-max-tokens')).toBeUndefined()

    /** 中文说明：测试局部值 failed，取值由紧邻初始化决定。 */
    const failed = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'failed' } },
      }),
    ])
    expect(node(snapshot(failed), 'turn-max-tokens')).toBeUndefined()
    expect(node(snapshot(failed), 'turn-error')).toBeDefined()
  })

  it('keeps the max-tokens notice when the window starts after the owning turn/start', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(9, 'turn/end', { turn: 3, reason: { kind: 'max-tokens' } }),
    ], true)
    /** 中文说明：测试局部值 notice，取值由紧邻初始化决定。 */
    const notice = node(snapshot(value), 'turn-max-tokens')
    expect(notice?.data).toMatchObject({ kind: 'turn-max-tokens', seq: 9, turn: 3 })
  })

  it('pins the max-tokens Definition edges the engine cannot reach', () => {
    // The engine only hands start the single matched turn/end and never emits
    // update Matches for this kind; these direct calls pin the declared
    // behavior of both required Definition members anyway.
    /** 中文说明：测试局部值 match，取值由紧邻初始化决定。 */
    const match = (seq: number, type: string, data: unknown) => ({
      event: { seq, time: seq * 1_000, type, data },
      view: undefined,
      role: 'start',
      location: undefined,
    }) as unknown as Parameters<typeof turnMaxTokensDefinition.start>[1]
    /** 中文说明：测试局部值 context，取值由紧邻初始化决定。 */
    const context = (state: unknown, matches: unknown[] = []) => ({
      key: 'k', kind: 'turn-max-tokens', id: '1', matches, start: undefined, state, current: new Map(),
    }) as unknown as Parameters<NonNullable<typeof turnMaxTokensDefinition.buildViewNode>>[0]
    /** 中文说明：测试局部值 reader，取值由紧邻初始化决定。 */
    const reader = { previous: () => undefined }

    expect(() => turnMaxTokensDefinition.start(context(undefined), match(1, 'turn/start', { turn: 1 }), reader))
      .toThrow('turn-max-tokens start requires a max-tokens turn/end')
    /** 中文说明：状态快照 state，取值由紧邻初始化决定。 */
    const state = { turn: 1, seq: 5, time: 5_000 }
    expect(turnMaxTokensDefinition.update(
      context(state) as Parameters<typeof turnMaxTokensDefinition.update>[0],
      match(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    )).toBe(state)
    expect(turnMaxTokensDefinition.buildViewNode?.(context(undefined))).toBeNull()
  })

  it('preserves nested Tools and manual compaction evidence when their start events are outside the window', () => {
    /** 中文说明：测试局部值 value，取值由紧邻初始化决定。 */
    const value = assembler([
      at(12, 'tool/code-dispatch-start', {
        rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read_file', arguments: { path: 'a' },
      }),
      at(13, 'tool/code-dispatch', {
        rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read_file', arguments: { path: 'a' },
        isError: false, content: [{ type: 'text', text: 'child result' }],
      }),
      at(14, 'tool/result', {
        turn: 1,
        step: 1,
        message: toolResult('root', 'root result'),
      }, { surfaceOp: 'append' }),
      at(20, 'compaction/summary', {
        compactionId: 'manual-1',
        sourceCommandId: 'command-1',
        summary: [{ type: 'text', text: 'manual summary' }],
        shadowedSeqs: [1, 2],
        shadowedTokenCount: 100,
      }),
      at(21, 'user/message', {
        ...textMessage('manual-checkpoint', 'checkpoint'),
        source: {
          kind: 'plugin',
          plugin: 'compact',
          compactionId: 'manual-1',
          sourceCommandId: 'command-1',
        },
      }, { surfaceOp: { op: 'replace', start: 1, end: 2 } }),
      at(22, 'command/done', {
        commandId: 'command-1',
        kind: 'success',
        sourceEventSeq: 20,
      }),
    ], true)

    /** 中文说明：测试局部值 tool，取值由紧邻初始化决定。 */
    const tool = node(snapshot(value), 'tool-call')
    /** 中文说明：测试局部值 root，取值由紧邻初始化决定。 */
    const root = (tool?.data as ToolChatData).root
    expect(root.subCalls).toHaveLength(1)
    expect(root.subCalls[0]).toMatchObject({ callId: 'child', kind: 'tool-result' })
    /** 中文说明：测试局部值 manual，取值由紧邻初始化决定。 */
    const manual = node(snapshot(value), 'manual-compaction')
    expect((manual?.data as ManualCompactionChatData)).toMatchObject({
      command: { commandId: 'command-1', name: 'compact', outcome: { kind: 'success' } },
      compaction: { summary: 'manual summary', summaryEventSeq: 20 },
    })
  })
})
