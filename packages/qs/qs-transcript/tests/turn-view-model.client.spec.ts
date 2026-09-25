// @vitest-environment jsdom
/** 轮次过程与收尾视图模型：坐标、状态优先级与指标缺值。 */
import { expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ChatTurnProcessPresentation, TurnProcessChatData, TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  hasMetrics, hasProcessActivity, hasTurnDiagnostic, nodeTurn, turnMetrics, turnProcessModel, turnTailState,
} from '../src/client/turn-view-model.ts'
import { zh } from '../src/client/locales.ts'

const PROCESS_DATA: TurnProcessChatData = {
  turn: 2,
  controlAnchorSeq: 1,
  processStartSeq: 1,
  answerAnchorSeq: 5,
  answerStep: 3,
  inlineReasoning: false,
  messageCount: 1,
  toolCallCount: 2,
  subagentCount: 0,
}

const PRESENTATION = {
  turn: 2, turnClosed: true, hasExternalProcess: false, compactAnswer: true,
  spec: { ...PROCESS_DATA },
} as unknown as ChatTurnProcessPresentation

it('过程模型保留坐标与计数，运行中由呈现决定', () => {
  expect(turnProcessModel(PRESENTATION, PROCESS_DATA)).toEqual({
    turn: 2, step: 3, running: false, tools: 2, messages: 1, agents: 0, hasUncountedActivity: false,
  })
  expect(turnProcessModel(undefined, PROCESS_DATA).running).toBe(true)
  expect(turnProcessModel(undefined, { ...PROCESS_DATA, answerStep: null }).step).toBeNull()
  const location = { kind: 'turn', turn: { turn: 2, steps: [{ step: 4 }] } } as const
  // 最终答案坐标与运行中坐标不同，且不能借用其他轮的步骤。
  const liveLocation = location as unknown as ChatConversationViewNode['location']
  expect(turnProcessModel(undefined, PROCESS_DATA, liveLocation).step).toBe(4)
  expect(turnProcessModel(PRESENTATION, PROCESS_DATA, liveLocation).step).toBe(3)
  expect(turnProcessModel(undefined, { ...PROCESS_DATA, turn: 3 }, liveLocation).step).toBeNull()
  expect(turnProcessModel(undefined, PROCESS_DATA, { kind: 'session' }).step).toBeNull()
})

it('活动计数只在有正数时成立', () => {
  expect(hasProcessActivity(turnProcessModel(PRESENTATION, PROCESS_DATA))).toBe(true)
  expect(hasProcessActivity(turnProcessModel(PRESENTATION, { ...PROCESS_DATA, toolCallCount: 0, messageCount: 0 }))).toBe(false)
  // 推理和外部过程不依赖工具/消息计数，仍需可展开。
  const empty = { ...PROCESS_DATA, toolCallCount: 0, messageCount: 0 }
  expect(hasProcessActivity(turnProcessModel({ ...PRESENTATION, hasExternalProcess: true }, empty))).toBe(true)
  expect(hasProcessActivity(turnProcessModel(PRESENTATION, { ...empty, inlineReasoning: true }))).toBe(true)
})

it('收尾状态按失败、截断、收尾消息的顺序判定', () => {
  const tail = (closing: TurnTailChatData['closing']): TurnTailChatData => ({ turn: 2, seq: 9, time: 9, closing, branchUnavailable: false })
  const settled = tail({ status: 'settled' } as TurnTailChatData['closing'])
  expect(turnTailState(settled, { failed: false, truncated: false })).toBe('ok')
  expect(turnTailState(settled, { failed: true, truncated: true })).toBe('failed')
  expect(turnTailState(settled, { failed: false, truncated: true })).toBe('truncated')
  expect(turnTailState(tail(null), { failed: false, truncated: false })).toBe('empty')
  expect(turnTailState(tail({ status: 'interrupted' } as TurnTailChatData['closing']), { failed: false, truncated: false })).toBe('stopped')
  expect(turnTailState(tail({ status: 'running' } as TurnTailChatData['closing']), { failed: false, truncated: false })).toBe('running')
})

it('指标只携带已有值，缺值不补 0', () => {
  const full = turnMetrics({
    turn: 2, seq: 9, time: 9, closing: null, branchUnavailable: false,
    ttftMs: 800, tokensPerSecond: 30, tokenUsage: { uncachedInputTokens: 10, outputTokens: 32, totalTokens: 42 },
  })
  expect(full).toEqual({ tokens: 42, ttftMs: 800, tokensPerSecond: 30 })
  expect(hasMetrics(full)).toBe(true)
  const sparse = turnMetrics({ turn: 2, seq: 9, time: 9, closing: null, branchUnavailable: false })
  expect(sparse).toEqual({ tokens: undefined, ttftMs: undefined, tokensPerSecond: undefined })
  expect(hasMetrics(sparse)).toBe(false)
})

it('节点轮次来自位置，会话级与未解析位置不给轮次', () => {
  expect(nodeTurn({ kind: 'session' })).toBeUndefined()
  expect(nodeTurn({ kind: 'unresolved' })).toBeUndefined()
  expect(nodeTurn({
    kind: 'step',
    turn: { turn: 3, status: 'open', steps: [] },
    step: { turn: 3, step: 1, status: 'open' },
  } as never)).toBe(3)
})

it('本轮诊断按 kind 与轮次匹配', () => {
  const node = (kind: string, turn: number | undefined): ChatConversationViewNode => ({
    kind,
    data: {},
    visibility: 'visible',
    anchorSeq: 1,
    location: turn === undefined
      ? { kind: 'session' }
      : { kind: 'turn', turn: { turn, status: 'closed', steps: [] } },
  }) as unknown as ChatConversationViewNode
  const nodes = [node('turn-error', 2), node('turn-max-tokens', 3), node('user', undefined)]
  expect(hasTurnDiagnostic(nodes, 2, 'turn-error')).toBe(true)
  expect(hasTurnDiagnostic(nodes, 2, 'turn-max-tokens')).toBe(false)
  expect(hasTurnDiagnostic(nodes, 3, 'turn-max-tokens')).toBe(true)
  expect(hasTurnDiagnostic(nodes, 9, 'turn-error')).toBe(false)
  // 同轮可同时保留失败与截断，无法确定轮次的诊断不能污染任一轮。
  const mixed = [node('turn-error', 2), node('turn-max-tokens', 2), node('turn-error', undefined)]
  expect(hasTurnDiagnostic(mixed, 2, 'turn-error')).toBe(true)
  expect(hasTurnDiagnostic(mixed, 2, 'turn-max-tokens')).toBe(true)
  expect(hasTurnDiagnostic(mixed, 9, 'turn-error')).toBe(false)
})

it('本轮诊断事实与文案键一一对应', () => {
  expect(zh['row.turnFailed']).toBeTruthy()
  expect(zh['diag.retryScheduled']).toBeTruthy()
})

it('同一节点快照只扫描一次，换页和诊断删除使用新快照重新计算', () => {
  let visits = 0
  const location = { kind: 'turn', turn: { turn: 1, status: 'closed', steps: [] } }
  const nodes = Array.from({ length: 1000 }, (_, index) => ({
    get kind() { visits++; return index === 0 ? 'turn-error' : 'assistant-step' },
    location,
  })) as unknown as ChatConversationViewNode[]
  for (let turn = 1; turn <= 100; turn++) {
    expect(hasTurnDiagnostic(nodes, turn, 'turn-error')).toBe(turn === 1)
    expect(hasTurnDiagnostic(nodes, turn, 'turn-max-tokens')).toBe(false)
  }
  expect(visits).toBe(1000)
  // 官方节点存储用新数组发布变更；新旧快照不能相互污染。
  const removed = nodes.slice(1)
  expect(hasTurnDiagnostic(removed, 1, 'turn-error')).toBe(false)
  expect(visits).toBe(1999)
  expect(hasTurnDiagnostic(nodes, 1, 'turn-error')).toBe(true)
  expect(visits).toBe(1999)
  const truncation = { kind: 'turn-max-tokens', location } as unknown as ChatConversationViewNode
  const added = [...removed, truncation]
  expect(hasTurnDiagnostic(added, 1, 'turn-max-tokens')).toBe(true)
  expect(hasTurnDiagnostic(added, 1, 'turn-error')).toBe(false)
  expect(hasTurnDiagnostic([], 1, 'turn-error')).toBe(false)
})
