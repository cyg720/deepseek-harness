// @vitest-environment jsdom
/**
 * 文件职责：验证工作流运行的 workflow-run.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止工作流运行展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConversationEventRegistry, ConversationNodeAssembler, SlotRegistry,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationMatch, ConversationNodeDefinition,
  ConversationViewDefinition, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  WorkflowRunPanel, type WorkflowRunInjected, type WorkflowRunPanelProps,
} from '../src/client/WorkflowRunPanel.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import {
  workflowRunDefinition, type WorkflowRunChatData,
} from '../src/client/workflow-definition.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 PARENT_ID，由紧邻初始化决定。 */
const PARENT_ID = 'parent' as SessionId
/** 中文说明：测试局部值 CHILD_ID，由紧邻初始化决定。 */
const CHILD_ID = 'child-1' as SessionId
/** 中文说明：测试局部值 SECOND_ID，由紧邻初始化决定。 */
const SECOND_ID = 'child-2' as SessionId

/** 中文说明：类型或类 ChatSnapshot 约束模块数据或组件职责。 */
interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

/** 中文说明：类型或类 TestEventDefinitions 约束模块数据或组件职责。 */
class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [workflowRunDefinition] }
  fallbackEntry(): undefined { return undefined }
}

/** 中文说明：类型或类 TestViewDefinitions 约束模块数据或组件职责。 */
class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

/** 中文说明：测试局部值 chatViewDefinition，由紧邻初始化决定。 */
const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    /** 中文说明：测试局部值 nodes，由紧邻初始化决定。 */
    let nodes = new Map<string, ChatConversationViewNode>()
    /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        /** 中文说明：测试局部值 node，由紧邻初始化决定。 */
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

/** 中文说明：函数 at 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return { event: { seq, time: seq * 100, type, data } as ConversationEventInput['event'], view: undefined }
}

/** 中文说明：函数 matched 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function matched(input: ConversationEventInput, role: ConversationMatch['role']): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } }
}

/** 中文说明：函数 assembler 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function assembler(entries: readonly ConversationEventInput[], hasMore = false): ConversationNodeAssembler {
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

/** 中文说明：函数 workflowData 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function workflowData(value: ConversationNodeAssembler): WorkflowRunChatData | undefined {
  /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()][0]?.data as WorkflowRunChatData | undefined
}

/** 中文说明：函数 completeEvents 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function completeEvents(): ConversationEventInput[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'tool-workflow/run-start', { runId: 'run-1', name: 'audit' }),
    at(4, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'first', phase: '', childId: 'child-1',
    }),
    at(5, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 2, label: 'second', childId: 'child-2',
    }),
    at(6, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }),
    at(7, 'tool-workflow/agent-end', { runId: 'run-1', seq: 2, outcome: 'failed' }),
    at(8, 'tool-workflow/run-end', { runId: 'run-1', stopReason: 'error' }),
    at(9, 'step/end', { turn: 1, step: 1 }),
    at(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('workflow-run Conversation Definition', () => {
  it('groups exact phase identities in first-member order and preserves terminal members', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler(completeEvents())
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data = workflowData(value)
    expect(data).toEqual({
      name: 'audit',
      status: 'failed',
      phases: [
        {
          key: 'value:0:', phase: '',
          members: [{ seq: 1, label: 'first', childId: 'child-1', status: 'completed' }],
        },
        {
          key: 'missing', phase: null,
          members: [{ seq: 2, label: 'second', childId: 'child-2', status: 'failed' }],
        },
      ],
    })
    /** 中文说明：测试局部值 node，由紧邻初始化决定。 */
    const node = [...(value.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
    expect(node.anchorSeq).toBe(3)
    expect(node.kind).toBe('workflow-run')
  })

  it('keeps an update-only tail pending until prepend supplies the unique start', () => {
    /** 中文说明：测试局部值 tail，由紧邻初始化决定。 */
    const tail = completeEvents().slice(3)
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler(tail, true)
    expect(workflowData(value)).toBeUndefined()
    value.prepend(completeEvents().slice(0, 3), false)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(completeEvents())))
  })

  it('produces the same final data through live append as complete replay', () => {
    /** 中文说明：测试局部值 events，由紧邻初始化决定。 */
    const events = completeEvents()
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler(events.slice(0, 3))
    /** 中文说明：测试局部值 event，由紧邻初始化决定。 */
    for (const event of events.slice(3)) value.append(event)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(events)))
  })

  it('shows missing terminal facts as interrupted only after the owning Location closes', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'run-1', name: 'audit' }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'run-1', seq: 1, label: 'worker', childId: 'child-1',
      }),
    ])
    expect(workflowData(value)?.status).toBe('running')
    value.append(at(5, 'step/end', { turn: 1, step: 1 }))
    value.flush()
    expect(workflowData(value)).toMatchObject({
      status: 'interrupted',
      phases: [{ members: [{ status: 'interrupted' }] }],
    })
  })

  it('retains a zero-member run as its own completed node', () => {
    /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'empty', name: 'empty' }),
      at(4, 'tool-workflow/run-end', { runId: 'empty', stopReason: 'completed' }),
    ])
    expect(workflowData(value)).toEqual({
      name: 'empty', status: 'completed', phases: [],
    })
  })

  it('folds same-phase cancellation and a turn-level interruption', () => {
    /** 中文说明：测试局部值 cancelled，由紧邻初始化决定。 */
    const cancelled = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', { runId: 'cancelled', name: 'cancelled' }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 1, label: 'one', phase: 'Research', childId: 'child-1',
      }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 2, label: 'two', phase: 'Research', childId: 'child-2',
      }),
      at(5, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 1, outcome: 'cancelled' }),
      at(6, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 2, outcome: 'completed' }),
      at(7, 'tool-workflow/run-end', { runId: 'cancelled', stopReason: 'cancelled' }),
    ])
    expect(workflowData(cancelled)).toMatchObject({
      status: 'cancelled',
      phases: [{ phase: 'Research', members: [{ status: 'cancelled' }, { status: 'completed' }] }],
    })

    /** 中文说明：测试局部值 interruptedTurn，由紧邻初始化决定。 */
    const interruptedTurn = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', { runId: 'turn', name: 'turn' }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'turn', seq: 1, label: 'open', childId: 'child-1',
      }),
      at(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(workflowData(interruptedTurn)?.status).toBe('interrupted')
  })

  it('handles session/unresolved placement and defensive Definition calls', () => {
    /** 中文说明：测试局部值 sessionLevel，由紧邻初始化决定。 */
    const sessionLevel = assembler([
      at(1, 'tool-workflow/run-start', { runId: 'session', name: 'session' }),
      at(2, 'tool-workflow/agent-start', {
        runId: 'session', seq: 1, label: 'open', childId: 'child-1',
      }),
    ])
    expect(workflowData(sessionLevel)?.status).toBe('running')

    /** 中文说明：测试局部值 invalidStart，由紧邻初始化决定。 */
    const invalidStart = matched(at(1, 'tool-workflow/agent-start', {
      runId: 'direct', seq: 1, label: 'member', childId: 'child-1',
    }), 'start')
    /** 中文说明：测试局部值 emptyContext，由紧邻初始化决定。 */
    const emptyContext: Parameters<typeof workflowRunDefinition.start>[0] = {
      key: 'workflow-run:direct', kind: 'workflow-run', id: 'direct',
      matches: [invalidStart], start: invalidStart, state: undefined, current: new Map(),
    }
    /** 中文说明：测试局部值 reader，由紧邻初始化决定。 */
    const reader: Parameters<typeof workflowRunDefinition.start>[2] = { previous: () => undefined }
    expect(() => workflowRunDefinition.start(emptyContext, invalidStart, reader))
      .toThrow('workflow-run start requires tool-workflow/run-start')

    /** 中文说明：测试局部值 start，由紧邻初始化决定。 */
    const start = matched(at(2, 'tool-workflow/run-start', { runId: 'direct', name: 'direct' }), 'start')
    /** 中文说明：测试局部值 startedContext，由紧邻初始化决定。 */
    const startedContext = { ...emptyContext, matches: [start], start }
    /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
    const state = workflowRunDefinition.start(startedContext, start, reader)
    /** 中文说明：测试局部值 updateContext，由紧邻初始化决定。 */
    const updateContext: Parameters<typeof workflowRunDefinition.update>[0] = { ...startedContext, state }
    /** 中文说明：测试局部值 unrelated，由紧邻初始化决定。 */
    const unrelated = matched(at(3, 'turn/start', { turn: 1 }), 'update')
    expect(workflowRunDefinition.update(updateContext, unrelated)).toBe(state)
    expect(workflowRunDefinition.target).toBe('chat')
    expect(workflowRunDefinition.buildViewNode?.({
      ...updateContext, matches: [], start: undefined,
    })).toBeNull()
    /** 中文说明：测试局部值 directNode，由紧邻初始化决定。 */
    const directNode = workflowRunDefinition.buildViewNode?.(updateContext) as ChatConversationViewNode | null | undefined
    if (directNode === null) throw new Error('expected direct workflow Chat node')
    if (directNode === undefined) throw new Error('expected workflow Chat view builder')
    expect(directNode.kind).toBe('workflow-run')
    expect((directNode.data as WorkflowRunChatData).status).toBe('running')
  })
})

/** 中文说明：函数 node 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function node(data: WorkflowRunChatData): WorkflowRunPanelProps['node'] {
  return {
    key: '12:workflow-runrun-1',
    kind: 'workflow-run',
    id: 'run-1',
    target: 'chat',
    anchorSeq: 3,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

/** 中文说明：测试局部值 phase，由紧邻初始化决定。 */
const phase = (overrides: Partial<WorkflowRunChatData['phases'][number]> = {}): WorkflowRunChatData['phases'][number] => ({
  key: 'missing',
  phase: null,
  members: [{ seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: 'running' }],
  ...overrides,
})

/** 中文说明：测试局部值 listState，由紧邻初始化决定。 */
const listState = (overrides: Partial<SessionListState> = {}): SessionListState => ({
  ids: [PARENT_ID, CHILD_ID],
  byId: {
    [PARENT_ID]: {
      id: PARENT_ID, displayTitle: 'parent', running: true, blank: false, updatedAt: 0,
    },
    [CHILD_ID]: {
      id: CHILD_ID, displayTitle: 'child', parentId: PARENT_ID, origin: 'subagent',
      running: true, blank: false, updatedAt: 0,
    },
  },
  current: PARENT_ID,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
  ...overrides,
})

/** 中文说明：函数 panelProps 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function panelProps(data: WorkflowRunChatData, sessions = listState(), openSession = vi.fn()): WorkflowRunPanelProps {
  return {
    node: node(data),
    sessionId: PARENT_ID,
    useSessions: selector => selector(sessions),
    useSession: (() => undefined) as WorkflowRunPanelProps['useSession'],
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: { setDraft: () => {}, submit: () => {} } as unknown as WorkflowRunPanelProps['inputActions'],
    useWorkspaces: (() => undefined) as WorkflowRunPanelProps['useWorkspaces'],
    useTurnData: () => undefined,
    selectedCallId: undefined,
    cwd: undefined,
    openFile: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    renderMessageImages: () => null,
    fileMentions: () => undefined,
    openSession,
    t: makeTranslate(zh),
  }
}

describe('WorkflowRunPanel', () => {
  it('keeps live run and phase controls manual across ordinary updates and outer hiding', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase({ key: 'research', phase: 'Research' })],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
    const phaseHeader = screen.getByRole('button', { name: /Research/ })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('worker')).toBeTruthy()

    fireEvent.click(phaseHeader)
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('worker')).toBeNull()
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        key: 'research', phase: 'Research',
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'running' },
          { seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'running' },
        ],
      })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Research/ })).toBeNull()
    fireEvent.keyDown(runHeader, { key: 'ArrowDown' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(runHeader, { key: ' ' })
    /** 中文说明：测试局部值 updatedPhase，由紧邻初始化决定。 */
    const updatedPhase = screen.getByRole('button', { name: /Research/ })
    expect(updatedPhase.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('运行中 2')).toBeTruthy()
    fireEvent.keyDown(updatedPhase, { key: 'Enter' })
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()

    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /Research/ })).toBeNull()
    fireEvent.keyDown(runHeader, { key: ' ' })
    expect(screen.getByRole('button', { name: /Research/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('folds each normal completion once and opens a new same-key activity cycle', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    /** 中文说明：测试局部值 runningPhase，由紧邻初始化决定。 */
    const runningPhase = screen.getByRole('button', { name: /未分阶段/ })
    fireEvent.click(runningPhase)
    fireEvent.keyDown(runningPhase, { key: 'Enter' })
    expect(screen.getByText('worker')).toBeTruthy()

    /** 中文说明：测试局部值 phaseCompleted，由紧邻初始化决定。 */
    const phaseCompleted: WorkflowRunChatData = {
      ...running,
      phases: [phase({
        members: [{
          seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'completed',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(phaseCompleted)} />)
    /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('done')).toBeNull()
    fireEvent.click(phaseHeader)
    expect(screen.getByText('done')).toBeTruthy()

    /** 中文说明：测试局部值 cleanUpdate，由紧邻初始化决定。 */
    const cleanUpdate: WorkflowRunChatData = {
      ...phaseCompleted,
      phases: [phase({
        members: [{
          seq: 1, label: 'reviewed', childId: 'child-1' as SessionId, status: 'completed',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(cleanUpdate)} />)
    expect(screen.getByText('reviewed')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    fireEvent.click(runHeader)
    /** 中文说明：测试局部值 renewed，由紧邻初始化决定。 */
    const renewed: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [
          { seq: 1, label: 'reviewed', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'new', childId: 'child-2' as SessionId, status: 'running' },
        ],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(renewed)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('new')).toBeTruthy()

    /** 中文说明：测试局部值 renewedPhaseCompleted，由紧邻初始化决定。 */
    const renewedPhaseCompleted: WorkflowRunChatData = {
      ...renewed,
      phases: [phase({
        members: [
          { seq: 1, label: 'reviewed', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'new', childId: 'child-2' as SessionId, status: 'completed' },
        ],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(renewedPhaseCompleted)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...renewedPhaseCompleted,
      status: 'completed',
    })} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('refolds a phase when a complete activity cycle arrives as one clean update', () => {
    /** 中文说明：测试局部值 firstMember，由紧邻初始化决定。 */
    const firstMember = {
      seq: 1, label: 'first', childId: 'child-1' as SessionId, status: 'completed' as const,
    }
    /** 中文说明：测试局部值 phaseClean，由紧邻初始化决定。 */
    const phaseClean: WorkflowRunChatData = {
      name: 'phase-cycle', status: 'running',
      phases: [phase({ members: [firstMember] })],
    }
    /** 中文说明：测试局部值 phaseView，由紧邻初始化决定。 */
    const phaseView = render(<WorkflowRunPanel {...panelProps(phaseClean)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    expect(screen.getByText('first')).toBeTruthy()
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^phase-cycle/ })
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    phaseView.rerender(<WorkflowRunPanel {...panelProps({
      ...phaseClean,
      phases: [phase({ members: [firstMember, {
        seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'completed',
      }] })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.queryByText('second')).toBeNull()

    phaseView.rerender(<WorkflowRunPanel {...panelProps({
      ...phaseClean,
      status: 'completed',
      phases: [phase({ members: [firstMember, {
        seq: 2, label: 'second', childId: SECOND_ID, status: 'completed',
      }, {
        seq: 3, label: 'final', childId: 'child-3' as SessionId, status: 'completed',
      }] })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /未分阶段/ })).toBeNull()
  })

  it('initializes a newly observed phase before it becomes interactive', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'dynamic-phase', status: 'running',
      phases: [phase({ key: 'research', phase: 'Research' })],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [
        ...running.phases,
        phase({
          key: 'build', phase: 'Build',
          members: [{ seq: 2, label: 'builder', childId: SECOND_ID, status: 'running' }],
        }),
      ],
    })} />)
    /** 中文说明：测试局部值 build，由紧邻初始化决定。 */
    const build = screen.getByRole('button', { name: /Build/ })
    expect(build.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(build)
    expect(build.getAttribute('aria-expanded')).toBe('false')
  })

  it('derives the zero-member running and completed states from the current run status', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = { name: 'empty', status: 'running', phases: [] }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    expect(screen.getByRole('button', { name: /^empty/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('没有启动成员')).toBeTruthy()
    view.rerender(<WorkflowRunPanel {...panelProps({ ...running, status: 'completed' })} />)
    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = screen.getByRole('button', { name: /^empty/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('没有启动成员')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('没有启动成员')).toBeTruthy()
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'initializes %s attention as an expanded disclosure that remains manually collapsible',
    (status) => {
      render(<WorkflowRunPanel {...panelProps({
        name: 'member-outcome', status,
        phases: [phase({
          members: [{ seq: 1, label: status, childId: CHILD_ID, status }],
        })],
      })} />)
      /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
      const runHeader = screen.getByRole('button', { name: /^member-outcome/ })
      /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
      const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
      expect(runHeader.getAttribute('aria-expanded')).toBe('true')
      expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText(status)).toBeTruthy()
      fireEvent.click(phaseHeader)
      fireEvent.click(runHeader)
      expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    },
  )

  it('opens the first abnormal edge once and preserves later abnormal choices', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))

    /** 中文说明：测试局部值 failed，由紧邻初始化决定。 */
    const failed: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [{ seq: 1, label: 'failed', childId: CHILD_ID, status: 'failed' }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(failed)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...failed,
      phases: [phase({
        members: [
          { seq: 1, label: 'failed', childId: CHILD_ID, status: 'failed' },
          { seq: 2, label: 'cancelled', childId: 'child-2' as SessionId, status: 'cancelled' },
        ],
      })],
    })} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('失败 1 · 已取消 1')).toBeTruthy()
  })

  it('keeps clean sibling phases independent and preserves empty versus absent names', () => {
    render(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [
        phase({ key: 'value:0:', phase: '', members: [{
          seq: 1, label: '', childId: 'child-1' as SessionId, status: 'completed',
        }] }),
        phase({ key: 'missing', phase: null, members: [{
          seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'running',
        }] }),
      ],
    })} />)
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    /** 中文说明：测试局部值 cleanPhase，由紧邻初始化决定。 */
    const cleanPhase = screen.getByRole('button', { name: /空阶段名/ })
    expect(cleanPhase.getAttribute('aria-expanded')).toBe('false')
    /** 中文说明：测试局部值 activePhase，由紧邻初始化决定。 */
    const activePhase = screen.getByRole('button', { name: /未分阶段/ })
    expect(activePhase.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByText('空成员名')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(cleanPhase)
    expect(screen.getByText('空成员名')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(activePhase)
    expect(screen.queryByText('second')).toBeNull()
    expect(screen.getByText('空成员名')).toBeTruthy()
    fireEvent.click(runHeader)
    fireEvent.click(runHeader)
    expect(screen.getByRole('button', { name: /空阶段名/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /空阶段名/ }))
    expect(screen.queryByText('空成员名')).toBeNull()
  })

  it('renders mixed and interrupted aggregate status while attention stays visible', () => {
    /** 中文说明：测试局部值 mixed，由紧邻初始化决定。 */
    const mixed: WorkflowRunChatData = {
      name: 'repo-audit', status: 'failed',
      phases: [phase({
        members: [
          { seq: 1, label: 'failed', childId: 'child-1' as SessionId, status: 'failed' },
          { seq: 2, label: 'cancelled', childId: 'child-2' as SessionId, status: 'cancelled' },
        ],
      })],
    }
    /** 中文说明：测试局部值 mixedView，由紧邻初始化决定。 */
    const mixedView = render(<WorkflowRunPanel {...panelProps(mixed)} />)
    expect(screen.getByText('失败 1 · 已取消 1')).toBeTruthy()
    expect([...mixedView.container.querySelectorAll('[data-member-status]')]
      .map(row => row.getAttribute('data-member-status'))).toEqual(['failed', 'cancelled'])
    expect(mixedView.container.querySelectorAll('[data-state="error"]')).toHaveLength(2)
    expect(mixedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(1)
    mixedView.unmount()

    /** 中文说明：测试局部值 interruptedView，由紧邻初始化决定。 */
    const interruptedView = render(<WorkflowRunPanel {...panelProps({
      name: 'repo-audit', status: 'interrupted',
      phases: [phase({
        members: [
          { seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'completed' },
          { seq: 2, label: 'interrupted', childId: 'child-2' as SessionId, status: 'interrupted' },
        ],
      })],
    })} />)
    expect(screen.getByText('已完成 1 · 已中断 1')).toBeTruthy()
    expect(interruptedView.container.querySelector('[data-run-status="interrupted"]')).toBeTruthy()
    expect(interruptedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
  })

  it('defers normal completion collapse until focused member content loses focus', () => {
    /** 中文说明：测试局部值 sessions，由紧邻初始化决定。 */
    const sessions = listState({
      ids: [PARENT_ID, CHILD_ID, SECOND_ID],
      byId: {
        ...listState().byId,
        [SECOND_ID]: {
          id: SECOND_ID, displayTitle: 'second', parentId: PARENT_ID, origin: 'subagent',
          running: true, blank: false, updatedAt: 0,
        },
      },
    })
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase({
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'running' },
          { seq: 2, label: 'second', childId: SECOND_ID, status: 'running' },
        ],
      })],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running, sessions)} />)
    /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
    const member = screen.getByRole('button', { name: '打开 worker' })
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = screen.getByRole('button', { name: '打开 second' })
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    member.focus()
    expect(document.activeElement).toBe(member)
    fireEvent.blur(member, { relatedTarget: second })
    second.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')

    /** 中文说明：测试局部值 outside，由紧邻初始化决定。 */
    const outside = document.createElement('button')
    document.body.append(outside)
    fireEvent.blur(second, { relatedTarget: outside })
    outside.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    member.focus()

    view.rerender(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [phase({
        members: [
          { seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' },
          { seq: 2, label: 'second', childId: SECOND_ID, status: 'completed' },
        ],
      })],
    }, sessions)} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('true')
    /** 中文说明：测试局部值 retained，由紧邻初始化决定。 */
    const retained = screen.getByRole('button', { name: 'worker' })
    expect(retained.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retained)

    fireEvent.blur(retained, { relatedTarget: outside })
    outside.focus()
    expect(document.activeElement).toBe(outside)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(runHeader)
    /** 中文说明：测试局部值 completedPhase，由紧邻初始化决定。 */
    const completedPhase = screen.getByRole('button', { name: /未分阶段/ })
    expect(completedPhase.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(completedPhase)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    expect(screen.getByText('worker')).toBeTruthy()
    outside.remove()
  })

  it('handles a pointer blur and header click as one pending-completion close', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'completed',
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    /** 中文说明：测试局部值 retained，由紧邻初始化决定。 */
    const retained = screen.getByRole('button', { name: 'worker' })
    /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })

    expect(fireEvent.mouseDown(retained)).toBe(true)
    expect(document.activeElement).toBe(retained)
    expect(fireEvent.mouseDown(phaseHeader)).toBe(false)
    fireEvent.click(phaseHeader)
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')

    expect(fireEvent.mouseDown(runHeader)).toBe(false)
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
  })

  it('settles pending completion when keyboard focus moves from content to its header', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    /** 中文说明：测试局部值 retained，由紧邻初始化决定。 */
    const retained = screen.getByRole('button', { name: 'worker' })
    /** 中文说明：测试局部值 phaseHeader，由紧邻初始化决定。 */
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    fireEvent.blur(retained, { relatedTarget: phaseHeader })
    phaseHeader.focus()
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')

    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      status: 'completed',
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    fireEvent.blur(phaseHeader, { relatedTarget: runHeader })
    runHeader.focus()
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
  })

  it('settles a deferred phase close when the user hides the outer run', () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    /** 中文说明：测试局部值 member，由紧邻初始化决定。 */
    const member = screen.getByRole('button', { name: '打开 worker' })
    member.focus()
    view.rerender(<WorkflowRunPanel {...panelProps({
      ...running,
      phases: [phase({
        members: [{ seq: 1, label: 'worker', childId: CHILD_ID, status: 'completed' }],
      })],
    })} />)
    /** 中文说明：测试局部值 runHeader，由紧邻初始化决定。 */
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(runHeader)
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(runHeader)
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('reinitializes manual choices from durable facts after a renderer remount', () => {
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(data)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }))
    view.unmount()
    render(<WorkflowRunPanel {...panelProps(data)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('opens only a running ordinary-list subagent proven to have this parent', () => {
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 openSession，由紧邻初始化决定。 */
    const openSession = vi.fn()
    render(<WorkflowRunPanel {...panelProps(data, listState(), openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 worker' }))
    expect(openSession).toHaveBeenCalledWith('child-1')
  })

  it('promotes a running member when its ordinary Session row arrives', () => {
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<WorkflowRunPanel {...panelProps(data, listState({ ids: [PARENT_ID] }))} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    view.rerender(<WorkflowRunPanel {...panelProps(data, listState())} />)
    expect(screen.getByRole('button', { name: '打开 worker' })).toBeTruthy()
  })

  it.each([
    ['not in ordinary list', listState({ ids: [PARENT_ID] }), 'running'],
    ['remote row', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, origin: undefined },
    } }), 'running'],
    ['wrong parent', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, parentId: 'other' as SessionId },
    } }), 'running'],
    ['list terminal', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false },
    } }), 'running'],
    ['member terminal', listState(), 'completed'],
  ] as const)('does not navigate when %s', (_name, sessions, memberStatus) => {
    /** 中文说明：测试局部值 data，由紧邻初始化决定。 */
    const data: WorkflowRunChatData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [{
          seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: memberStatus,
        }],
      })],
    }
    render(<WorkflowRunPanel {...panelProps(data, sessions)} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    cleanup()
  })
})

/** 中文说明：类型或类 TestSessions 约束模块数据或组件职责。 */
class TestSessions extends Service {
  readonly opened: SessionId[] = []
  constructor(ctx: Context) { super(ctx, 'sessions') }
  open(id: SessionId): void { this.opened.push(id) }
}

describe('plugin lifecycle', () => {
  it('registers and removes the Definition and keyed renderer with its fiber', async () => {
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin(ConversationEventRegistry).await()
    await ctx.plugin(TestSessions).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = ctx.slots.entries('conversation.chat.node')[0]!
    /** 中文说明：测试局部值 face，由紧邻初始化决定。 */
    const face = entry.inject?.() as unknown as WorkflowRunInjected
    face.openSession(CHILD_ID)
    expect((ctx.sessions as unknown as TestSessions).opened).toEqual([CHILD_ID])
    await fiber.dispose()
    expect(ctx.conversationEvents.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])

    /** 中文说明：测试局部值 replacement，由紧邻初始化决定。 */
    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    await replacement.dispose()
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    /** 中文说明：测试局部值 registered，由紧邻初始化决定。 */
    const registered: string[] = []
    /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-workflow-run'])
  })
})
