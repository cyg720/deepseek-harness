// @vitest-environment jsdom
// ChatView behavior: flow derivation, streaming isolation (Profiler counts),
// Tool seat ownership and selection handoff — driven through a scripted
// ObservableSnapshot fake, no wire or Tool presentation plugin.
/**
 * 文件职责：验证会话界面的 chat-view.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import type {
  AssistantMessageNode, CommandNode, CompactionSummaryNode, ConversationNode, ConversationSnapshot,
  ModelRetryNode, RunningToolCall, SessionId, SessionListState, ToolCallBlock, ToolResultNode, TurnErrorNode,
  TurnMaxTokensNode, UserMessageNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS, PendingWait,
} from '@deepseek-ai/dsh-client-runtime/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ChatNode, ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps, SelectionTarget, UseChatNodeTurnData,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createChatStore } from '../src/client/stores.ts'
import { ChatView } from '../src/client/chat/ChatView.tsx'
import { zh } from '../src/client/locales.ts'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from '../src/client/chat/CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
} from '../src/client/chat/MessageItem.tsx'
import { TurnTailNodeView } from '../src/client/chat/TurnTailNodeView.tsx'
import { formatRunDuration } from '../src/client/chat/message-chrome.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
// Keyless create() persists under the bare declared key; clear between cases
// so one harness's selection cannot rehydrate into the next.
beforeEach(() => {
  localStorage.clear()
})

/** 中文说明：测试局部值 SID，取值由紧邻初始化决定。 */
const SID = 's1' as SessionId
/** 中文说明：类型或类 RoutedChatNodeOwner 约束本文件的数据或组件职责。 */
type RoutedChatNodeOwner = ChatNodeOwnerProps & { readonly node: ChatNode }

/** 中文说明：函数 snapshotBase 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function snapshotBase(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: chatSnapshotFixture(), nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Scripted snapshot source: set() swaps the top-level object like the real Session. */
/** 中文说明：函数 makeSource 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function makeSource(init?: Partial<ConversationSnapshot>) {
  /** 中文说明：测试局部值 initial，取值由紧邻初始化决定。 */
  const initial = { ...snapshotBase(), ...init }
  /** 中文说明：测试局部值 snap，取值由紧邻初始化决定。 */
  let snap: ConversationSnapshot = {
    ...initial,
    chat: init?.chat ?? chatSnapshotFixture(initial),
  }
  /** 中文说明：测试局部值 subs，取值由紧邻初始化决定。 */
  const subs = new Set<() => void>()
  return {
    set: (next: Partial<ConversationSnapshot>) => {
      /** 中文说明：测试局部值 merged，取值由紧邻初始化决定。 */
      const merged = { ...snap, ...next }
      snap = {
        ...merged,
        chat: Object.hasOwn(next, 'chat') && next.chat !== undefined
          ? next.chat
          : chatSnapshotFixture(merged, snap.chat),
      }
      /** 中文说明：测试局部值 fn，取值由紧邻初始化决定。 */
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

/** 中文说明：测试局部值 user，取值由紧邻初始化决定。 */
const user = (seq: number, text: string): UserMessageNode => ({
  kind: 'user',
  seq,
  time: seq * 1000,
  content: [{ type: 'text', text }] as never,
  source: null,
})
/** 中文说明：测试局部值 assistant，取值由紧邻初始化决定。 */
const assistant = (seq: number, text: string, turn = 1): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: 1, blocks: [{ kind: 'text', text }],
})
/** 中文说明：测试局部值 retry，取值由紧邻初始化决定。 */
const retry = (seq: number): ModelRetryNode => ({
  kind: 'model-retry', retryId: 'chat-view-retry' as ModelRetryNode['retryId'],
  seq, time: seq * 1_000, turn: 1, step: 0,
  retryState: 'scheduled',
  provider: 'mock', mode: 'normal', policyKey: 'mock-normal',
  retry: 1, maxRetries: 2, delayMs: 450,
  failure: { code: 'TRANSPORT', message: '连接被重置' },
})
/** 中文说明：失败观测值 turnError，取值由紧邻初始化决定。 */
const turnError = (seq: number, code?: string): TurnErrorNode => ({
  kind: 'turn-error', seq, time: seq * 1_000, turn: 1, step: 0,
  message: seq === 2 ? 'API key is invalid' : 'plugin exploded',
  ...(code === undefined ? {} : { code }),
})
/** 中文说明：测试局部值 turnMaxTokens，取值由紧邻初始化决定。 */
const turnMaxTokens = (seq: number): TurnMaxTokensNode => ({
  kind: 'turn-max-tokens', seq, time: seq * 1_000, turn: 1, step: 0,
})
/** 中文说明：测试局部值 toolResult，取值由紧邻初始化决定。 */
const toolResult = (seq: number, callId: string, name = 'bash'): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name, argsRaw: `{"command":"cmd-${callId}","description":"run ${callId}"}` },
  callTime: seq * 1_000 - 500,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})
/** 中文说明：测试局部值 runningCall，取值由紧邻初始化决定。 */
const runningCall = (callId: string, name = 'bash'): RunningToolCall => ({
  callId, name, argsRaw: `{"command":"cmd-${callId}"}`, turn: 2, step: 1, time: 1_000, callView: null, subCalls: [],
})
/** 中文说明：测试局部值 command，取值由紧邻初始化决定。 */
const command = (over: Partial<CommandNode> = {}): CommandNode => ({
  kind: 'command', seq: 5, time: 5_000, commandId: 'cmd-1' as CommandNode['commandId'],
  name: 'plan', args: '', outcome: { kind: 'success', text: '已进入 plan mode' },
  ...over,
})
/** 中文说明：测试局部值 compaction，取值由紧邻初始化决定。 */
const compaction = (over: Partial<CompactionSummaryNode> = {}): CompactionSummaryNode => ({
  kind: 'compaction', seq: 8, time: 8_000,
  summary: '## 压缩摘要\n\n保留的事实。',
  summaryEventSeq: 7,
  shadowedItemCount: 16,
  shadowedTokenCount: 11_309,
  ...over,
})

/** Empty sessions-list hook for the global standard-kit seat. */
/** 中文说明：函数 emptySessions 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function emptySessions() {
  /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}

/** 中文说明：函数 emptyWorkspaces 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function emptyWorkspaces() {
  /** 中文说明：状态快照 store，取值由紧邻初始化决定。 */
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

/** 中文说明：函数 makeHarness 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function makeHarness(init?: Partial<ConversationSnapshot>) {
  /** 中文说明：测试局部值 { set, source }，取值由紧邻初始化决定。 */
  const { set, source } = makeSource(init)
  /** 中文说明：测试局部值 openDetails，取值由紧邻初始化决定。 */
  const openDetails = vi.fn<(t: SelectionTarget) => void>()
  /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
  const openFile = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined)
  /** 中文说明：测试局部值 loadOlder，取值由紧邻初始化决定。 */
  const loadOlder = vi.fn()
  /** 中文说明：测试局部值 inspectCall，取值由紧邻初始化决定。 */
  const inspectCall = vi.fn<(callId: string) => void>()
  // In-memory scroll memory matching the apply.ts per-session map contract.
  /** 中文说明：测试局部值 savedScroll，取值由紧邻初始化决定。 */
  let savedScroll: ReturnType<ChatViewSlotProps['chatScroll']['read']> = null
  /** 中文说明：测试局部值 chatScroll，取值由紧邻初始化决定。 */
  const chatScroll: ChatViewSlotProps['chatScroll'] = {
    save: (position) => { savedScroll = position },
    read: () => savedScroll,
  }
  /** 中文说明：测试局部值 forkAt，取值由紧邻初始化决定。 */
  const forkAt = vi.fn()
  // Selection rides the REAL chat store (same construction path as
  // production; the view reads it through the PropsStore useStore share).
  /** 中文说明：测试局部值 chat，取值由紧邻初始化决定。 */
  const chat = createChatStore().create()
  /** 中文说明：测试局部值 t，取值由紧邻初始化决定。 */
  const t = makeTranslate(zh, commonZh)
  /** 中文说明：测试局部值 toolOwners: Array<{，取值由紧邻初始化决定。 */
  const toolOwners: Array<{
    callId: string
    toolName: string
    block: ToolCallBlock
    selectedCallId: string | undefined
    openFile: ChatNodeOwnerProps['openFile']
    inspectCall: ChatNodeOwnerProps['inspectCall']
  }> = []
  /** 中文说明：测试局部值 renderCommandSlot，取值由紧邻初始化决定。 */
  const renderCommandSlot = ((_key: string, _owner: object, opts?: { fallback?: React.ReactNode }) =>
    opts?.fallback ?? null) as unknown as React.ComponentProps<typeof CommandNodeView>['renderSlot']
  /** 中文说明：测试局部值 renderTurnTail，取值由紧邻初始化决定。 */
  const renderTurnTail = ((_key: string, _owner: object) => null) as unknown as
    React.ComponentProps<typeof TurnTailNodeView>['renderSlotChain']
  /** 中文说明：测试局部值 renderTurnTailSlot，取值由紧邻初始化决定。 */
  const renderTurnTailSlot = (() => null) as unknown as
    React.ComponentProps<typeof TurnTailNodeView>['renderSlot']
  /** 中文说明：测试局部值 renderSlot，取值由紧邻初始化决定。 */
  const renderSlot = ((key: string, owner: object, opts?: {
    fallback?: React.ReactNode
    hookContext?: unknown
  }) => {
    if (key !== 'conversation.chat.node') return opts?.fallback ?? null
    /** 中文说明：测试局部值 nodeOwner，取值由紧邻初始化决定。 */
    const nodeOwner = owner as RoutedChatNodeOwner
    /** 中文说明：测试局部值 nodeKey，取值由紧邻初始化决定。 */
    const nodeKey = opts?.hookContext as string | undefined
    /** 中文说明：测试局部值 useTurnData，取值由紧邻初始化决定。 */
    const useTurnData: UseChatNodeTurnData = dataKey => props.useSession((snapshot) => {
      /** 中文说明：测试局部值 location，取值由紧邻初始化决定。 */
      const location = nodeKey === undefined ? undefined : snapshot.chat.nodes.get(nodeKey)?.location
      return location?.kind === 'turn' || location?.kind === 'step'
        ? location.turn.data.get(dataKey)
        : undefined
    })
    /** 中文说明：测试局部值 nodeProps，取值由紧邻初始化决定。 */
    const nodeProps = <Kind extends ChatNode['kind']>(): ChatNodeViewProps<Kind> => (
      { ...props, ...nodeOwner, useTurnData } as unknown as ChatNodeViewProps<Kind>
    )
    switch (nodeOwner.node.kind) {
      case 'user':
      case 'steering':
        return <UserMessageNodeView {...nodeProps<'user' | 'steering'>()} />
      case 'context':
        return <ContextMessageNodeView {...nodeProps<'context'>()} />
      case 'assistant-step':
        return <AssistantNodeView {...nodeProps<'assistant-step'>()} />
      case 'command':
        return (
          <CommandNodeView
            {...nodeProps<'command'>()}
            renderSlot={renderCommandSlot}
            SessionProvider={props.SessionProvider}
          />
        )
      case 'manual-compaction':
        return <ManualCompactionNodeView {...nodeProps<'manual-compaction'>()} />
      case 'compaction':
        return <CompactionNodeView {...nodeProps<'compaction'>()} />
      case 'model-retry':
        return <RetryNodeView {...nodeProps<'model-retry'>()} />
      case 'turn-error':
        return <TurnErrorNodeView {...nodeProps<'turn-error'>()} />
      case 'turn-max-tokens':
        return <TurnMaxTokensNodeView {...nodeProps<'turn-max-tokens'>()} />
      case 'turn-tail':
        return (
          <TurnTailNodeView
            {...nodeProps<'turn-tail'>()}
            renderSlot={renderTurnTailSlot}
            renderSlotChain={renderTurnTail}
            SessionProvider={props.SessionProvider}
          />
        )
      case 'unknown':
        return <UnknownNodeView {...nodeProps<'unknown'>()} />
      case 'tool-call': {
        /** 中文说明：测试局部值 block，取值由紧邻初始化决定。 */
        const block = nodeOwner.node.data.root
        /** 中文说明：测试局部值 toolName，取值由紧邻初始化决定。 */
        const toolName = 'kind' in block ? block.call?.name ?? '' : block.name
        /** 中文说明：测试局部值 tool，取值由紧邻初始化决定。 */
        const tool = {
          callId: block.callId,
          toolName,
          block,
          selectedCallId: nodeOwner.selectedCallId,
          openFile: nodeOwner.openFile,
          inspectCall: nodeOwner.inspectCall,
        }
        toolOwners.push(tool)
        return (
          <div
            data-testid={`tool-seat-${tool.callId}`}
            data-chat-anchor-key={`call:${tool.callId}`}
            data-chat-call-id={tool.callId}
          >
            {tool.toolName || '(unnamed)'}:{tool.callId}
          </div>
        )
      }
      default:
        return opts?.fallback ?? null
    }
  }) as unknown as ChatViewSlotProps['renderSlot']
  // SessionProvider seat arrives with the session-scope child declaration;
  // ChatView never invokes it (render-prop pass-through stub).
  /** 中文说明：测试局部值 SessionProviderStub，取值由紧邻初始化决定。 */
  const SessionProviderStub: ChatViewSlotProps['SessionProvider'] = ({ children }) => <>{children(SID)}</>
  /** 中文说明：测试局部值 props，取值由紧邻初始化决定。 */
  const props: ChatViewSlotProps = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source),
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useProjection: (() => undefined),
    useInput: (() => { throw new Error('unused') }),
    inputActions: {
      setDraft: () => {},
      addImages: () => true,
      removeImage: () => {},
      pruneImages: () => {},
      submit: () => {},
    },
    useStore: bindSnapshotSelector(chat),
    actions: chat.actions,
    renderSlot,
    SessionProvider: SessionProviderStub,
    openDetails,
    openFile,
    loadOlder,
    loadImage: vi.fn(() => Promise.reject(new Error('not used'))),
    inspectCall,
    chatScroll,
    forkAt,
    // Absent-service default; mention tests override with a real resolver.
    fileMentions: () => undefined,
    // Mirrors the real lookup chain (conversation namespace, then common).
    t,
  }
  /** 中文说明：测试局部值 setSelection，取值由紧邻初始化决定。 */
  const setSelection = (next: SelectionTarget | null): void => { chat.actions.select(next) }
  return {
    set, ChatView, props, openDetails, openFile, loadOlder, inspectCall,
    chatScroll, forkAt, setSelection, toolOwners,
  }
}

/** Simulate reader input (any device): a delivered position that deviates
 * from the observed-top ledger of programmatic writes. */
/** 中文说明：函数 readerScroll 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function readerScroll(element: HTMLElement, top: number): void {
  element.scrollTop = top
  fireEvent.scroll(element)
}

/** 中文说明：函数 installScrollMetrics 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function installScrollMetrics(element: HTMLElement, initialHeight: number, clientHeight: number) {
  /** 中文说明：测试局部值 scrollHeight，取值由紧邻初始化决定。 */
  let scrollHeight = initialHeight
  /** 中文说明：测试局部值 scrollTop，取值由紧邻初始化决定。 */
  let scrollTop = 0
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight)) },
  })
  return {
    setHeight: (value: number) => { scrollHeight = value },
    setLayout: (height: number, top: number) => {
      scrollHeight = height
      scrollTop = Math.max(0, Math.min(top, scrollHeight - clientHeight))
    },
  }
}

describe('Chat node rendering', () => {

  it('threads the injected file-mention vocabulary into the closing prose only', () => {
    /** 中文说明：测试局部值 wrote，取值由紧邻初始化决定。 */
    const wrote = (seq: number, callId: string, path: string): ToolResultNode => ({
      ...toolResult(seq, callId, 'write'),
      callView: {
        card: 'diff', title: 'Write', diffs: [{ path, oldText: null, newText: 'x' }], locations: [{ path }],
      },
    })
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [
        user(1, 'build it'),
        assistant(2, 'writing `report.html` now', 1),
        wrote(3, 'w', 'site/report.html'),
        assistant(4, 'Wrote `report.html`; `notes.md` untouched.', 1),
      ],
      turnEnds: new Map([[1, 4]]),
    })
    // Stub provider mirroring the real service: only produced files resolve.
    h.props.fileMentions = owner => ({
      resolve: (value) => {
        if (value !== 'report.html') return undefined
        return {
          open: () => { void h.openFile(`for-seq-${String(owner.seq)}/site/report.html`) },
          label: '打开 site/report.html',
          title: 'site/report.html',
        }
      },
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // Exactly one live mention: the closing message links, the mid-turn
    // narration stays inert code, and the unknown file resolves to nothing.
    /** 中文说明：测试局部值 mentions，取值由紧邻初始化决定。 */
    const mentions = view.container.querySelectorAll('code button')
    expect(mentions).toHaveLength(1)
    /** 中文说明：测试局部值 mention，取值由紧邻初始化决定。 */
    const mention = view.getByRole('button', { name: '打开 site/report.html' })
    expect(mention.getAttribute('title')).toBe('site/report.html')
    fireEvent.click(mention)
    // The vocabulary was built from the closing message's own owner currency.
    expect(h.openFile).toHaveBeenCalledWith('for-seq-4/site/report.html')
  })

  it('formatRunDuration localizes units and floors partial seconds', () => {
    /** 中文说明：测试局部值 t，取值由紧邻初始化决定。 */
    const t = makeTranslate(zh, commonZh)
    expect(formatRunDuration(0, t)).toBe('0秒')
    expect(formatRunDuration(-500, t)).toBe('0秒')
    expect(formatRunDuration(15_999, t)).toBe('15秒')
    expect(formatRunDuration(125_000, t)).toBe('2分05秒')
  })

})

describe('ChatView', () => {
  it('hands a windowless tool result to the Tool seat with an empty tool name', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [{ ...toolResult(3, 'w1'), call: null }],
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('tool-seat-w1')).toBeTruthy()
    expect(h.toolOwners[0]).toMatchObject({ callId: 'w1', toolName: '' })
  })

  it('prepend keeps the reader\'s latest pending-request scroll position anchored', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(9, 'first visible'), user(10, 'next visible')], hasMore: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    /** 中文说明：测试局部值 first，取值由紧邻初始化决定。 */
    const first = view.container.querySelector('[data-chat-flow-key="fixture:user:9"]') as HTMLDivElement
    /** 中文说明：测试局部值 next，取值由紧邻初始化决定。 */
    const next = view.container.querySelector('[data-chat-flow-key="fixture:user:10"]') as HTMLDivElement
    /** 中文说明：测试局部值 firstTop，取值由紧邻初始化决定。 */
    let firstTop = 100
    /** 中文说明：测试局部值 nextTop，取值由紧邻初始化决定。 */
    let nextTop = 300
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, bottom: 200 } as DOMRect),
    )
    vi.spyOn(first, 'getBoundingClientRect').mockImplementation(
      () => ({ top: firstTop, bottom: firstTop + 40 } as DOMRect),
    )
    vi.spyOn(next, 'getBoundingClientRect').mockImplementation(
      () => ({ top: nextTop, bottom: nextTop + 40 } as DOMRect),
    )
    Object.defineProperty(scroller, 'scrollHeight', { value: 800, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, writable: true })
    readerScroll(scroller, 50)
    fireEvent.click(view.getByText('加载更早'))
    // The reader moves after the request starts; this, not the click-time
    // row, is the intent the arriving page must preserve.
    firstTop = -200
    nextTop = 60
    readerScroll(scroller, 90)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1300, writable: true })
    nextTop = 560
    act(() => { h.set({ nodes: [assistant(2, 'older'), user(9, 'first visible'), user(10, 'next visible')] }) })
    expect(scroller.scrollTop).toBe(590) // latest 90 + the anchored row's 500px prepend shift
  })

  it('renders the fixture main line as independently keyed business nodes', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'do the thing'), assistant(2, 'running tools'), toolResult(3, 'a'), toolResult(4, 'b')],
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText('do the thing')).toBeTruthy()
    expect(view.getByText('running tools')).toBeTruthy()
    expect(view.getByTestId('tool-seat-a').textContent).toBe('bash:a')
    expect(view.getByTestId('tool-seat-b').textContent).toBe('bash:b')
    expect([...view.container.querySelectorAll('[data-chat-flow-key]')].map(row => ({
      key: row.getAttribute('data-chat-flow-key'),
      kind: row.getAttribute('data-chat-flow-kind'),
    }))).toEqual([
      { key: 'fixture:user:1', kind: 'user' },
      { key: 'fixture:assistant:2', kind: 'assistant-step' },
      { key: 'fixture:tool:a', kind: 'tool-call' },
      { key: 'fixture:tool:b', kind: 'tool-call' },
    ])
    expect([...view.container.querySelectorAll('[data-chat-call-id]')].map(row => row.getAttribute('data-chat-call-id')))
      .toEqual(['a', 'b'])
    expect([...view.container.querySelectorAll('[data-chat-anchor-key]')].map(row => row.getAttribute('data-chat-anchor-key')))
      .toEqual([
        'fixture:user:1', 'fixture:assistant:2',
        'fixture:tool:a', 'call:a', 'fixture:tool:b', 'call:b',
      ])
  })

  it('renders Host-pending steering at the flow tail and hands off to the durable node', () => {
    /** 中文说明：测试局部值 writeText，取值由紧邻初始化决定。 */
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    /** 中文说明：测试局部值 pending，取值由紧邻初始化决定。 */
    const pending = {
      id: 'steer-occurrence' as never,
      messageId: 'steer-message' as never,
      placement: 'steering' as const,
      content: [{ type: 'text' as const, text: 'interrupt now' }],
      preview: 'interrupt now',
      text: 'interrupt now',
    }
    /** 中文说明：测试局部值 queued，取值由紧邻初始化决定。 */
    const queued = {
      id: 'queued-occurrence' as never,
      messageId: 'queued-message' as never,
      placement: 'queued' as const,
      content: [{ type: 'text' as const, text: 'later' }],
      preview: 'later',
      text: 'later',
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [assistant(1, 'working')], queue: [queued, pending], running: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)

    expect(view.getByText('interrupt now').closest('[data-pending-steering]')).not.toBeNull()
    expect(view.queryByText('later')).toBeNull()
    /** 中文说明：测试局部值 pendingBubble，取值由紧邻初始化决定。 */
    const pendingBubble = view.getByText('interrupt now').closest('[data-pending-steering]')
    expect(pendingBubble).not.toBeNull()
    fireEvent.click(within(pendingBubble as HTMLElement).getByRole('button', { name: '复制' }))
    expect(writeText).toHaveBeenCalledWith('interrupt now')
    expect(within(pendingBubble as HTMLElement).queryByRole('button', { name: '在新对话中分支' })).toBeNull()
    expect(view.getByRole('status').compareDocumentPosition(view.getByText('interrupt now'))
      & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    act(() => {
      h.set({
        queue: [queued],
        nodes: [
          assistant(1, 'working'),
          {
            kind: 'steering', messageId: pending.messageId,
            seq: 2, time: 2_000,
            content: [{ type: 'text', text: 'interrupt now' }], source: null,
          },
        ],
      })
    })
    expect(view.getAllByText('interrupt now')).toHaveLength(1)
    expect(view.container.querySelector('[data-pending-steering]')).toBeNull()
    // Only the durable steering bubble: the turn is still running, so its
    // assistant narration owns no footer yet, and a steering bubble never
    // carries a branch action.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(1)
    /** 中文说明：测试局部值 durableBubble，取值由紧邻初始化决定。 */
    const durableBubble = view.getByText('interrupt now').closest('[class*="userRow"]') as HTMLElement
    expect(within(durableBubble).queryByRole('button', { name: '在新对话中分支' })).toBeNull()

    act(() => {
      h.set({ running: false, turnEnds: new Map([[1, 3]]) })
    })
    // The Turn Tail belongs to the closed Turn, independently of a later
    // steering bubble's placement in the Chat list.
    /** 中文说明：测试局部值 branchButtons，取值由紧邻初始化决定。 */
    const branchButtons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(branchButtons).toHaveLength(1)
    expect(branchButtons[0]!.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(branchButtons[0]!)
    expect(h.forkAt).toHaveBeenCalledWith(1)
  })

  it('keeps a later pending occurrence visible when it reuses a durable MessageId', () => {
    /** 中文说明：测试局部值 pending，取值由紧邻初始化决定。 */
    const pending = {
      id: 'steer-occurrence-later' as never,
      messageId: 'shared-steer-message' as never,
      placement: 'steering' as const,
      content: [{ type: 'text' as const, text: 'same steering' }],
      preview: 'same steering',
      text: 'same steering',
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      queue: [pending],
      nodes: [{
        kind: 'user', seq: 2, time: 2_000,
        content: pending.content, source: null,
      }],
      running: true,
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)

    expect(view.getAllByText('same steering')).toHaveLength(2)
    expect(view.container.querySelectorAll('[data-pending-steering]')).toHaveLength(1)
  })

  it('animates only the latest unresolved model retry', () => {
    /** 中文说明：测试局部值 retryNode，取值由紧邻初始化决定。 */
    const retryNode = retry(2)
    /** 中文说明：测试局部值 nextRetry，取值由紧邻初始化决定。 */
    const nextRetry = { ...retry(3), turn: 2, retry: 2 }
    /** 中文说明：测试局部值 context，取值由紧邻初始化决定。 */
    const context = {
      kind: 'context', seq: 4, time: 4_000, content: [], source: null,
      provenance: { role: 'inject', label: null },
      form: null,
    } as const satisfies ConversationNode
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'try'), retryNode], running: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 disclosure，取值由紧邻初始化决定。 */
    const disclosure = view.container.querySelector('details') as HTMLDetailsElement
    expect(disclosure.dataset.active).toBe('true')
    expect(within(disclosure).getByRole('status').textContent).toBe('正在重试模型请求（1/2） · 1s')

    act(() => {
      h.set({ nodes: [user(1, 'try'), nextRetry] })
    })
    expect(within(disclosure).getAllByRole('status')).toHaveLength(1)
    expect(view.container.querySelector('details')).toBe(disclosure)
    expect(within(disclosure).getByRole('status').textContent).toBe('正在重试模型请求（2/2） · 1s')

    act(() => {
      h.set({
        nodes: [
          user(1, 'try'),
          { ...nextRetry, retryState: 'started' },
          context,
          assistant(5, 'done'),
        ],
        running: false,
      })
    })
    expect(disclosure.dataset.active).toBeUndefined()
    expect(within(disclosure).getByRole('status').textContent).toBe('已重试模型请求（2/2） · 1s')

    act(() => {
      h.set({ nodes: [user(1, 'try'), { ...retry(6), retryState: 'cancelled' }], running: true })
    })
    /** 中文说明：测试局部值 cancelledDisclosure，取值由紧邻初始化决定。 */
    const cancelledDisclosure = view.container.querySelector('details') as HTMLDetailsElement
    expect(cancelledDisclosure.dataset.active).toBeUndefined()
    expect(within(cancelledDisclosure).getByRole('status').textContent).toContain('重试已取消')
  })

  it('renders terminal turn failures inline with their durable message and optional code', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'try'), turnError(2, 'AUTH'), turnError(3)] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 statuses，取值由紧邻初始化决定。 */
    const statuses = view.getAllByRole('status')
    expect(statuses.map(status => status.textContent)).toEqual([
      '本轮运行失败API key is invalidAUTH',
      '本轮运行失败plugin exploded',
    ])
  })

  it('renders the max-tokens notice with localized guidance, distinct from turn errors', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'try'), assistant(2, 'truncated'), turnMaxTokens(3)] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 statuses，取值由紧邻初始化决定。 */
    const statuses = view.getAllByRole('status')
    expect(statuses.map(status => status.textContent)).toEqual([
      '已达到输出 token 上限回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。',
    ])
    expect(view.queryByText('本轮运行失败')).toBeNull()
  })

  it('hands the trajectory callback to the Tool seat', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [toolResult(3, 'a')],
    })
    render(<h.ChatView {...h.props} />)
    expect(h.toolOwners[0]?.inspectCall).toBe(h.inspectCall)
  })

  it('shows assistant IconActions only on the last content message of each turn', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [
        user(1, 'hi'),
        assistant(2, 'mid-turn text'),
        toolResult(3, 'a'),
        assistant(4, 'final answer'),
        user(5, 'next'),
        assistant(6, 'second turn', 2),
      ],
      turnEnds: new Map([[1, 4], [2, 6]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // Branch renders only under assistant answers; user bubbles keep copy alone.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(4)
    /** 中文说明：测试局部值 branchButtons，取值由紧邻初始化决定。 */
    const branchButtons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(branchButtons).toHaveLength(2)
    expect(branchButtons.map(button => button.getAttribute('aria-disabled'))).toEqual([null, null])
  })

  it('withholds assistant IconActions while the turn is still running', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      running: true,
      runningCalls: [runningCall('a')],
      nodes: [
        user(1, 'first'),
        assistant(2, 'previous answer', 1),
        user(4, 'second'),
        assistant(5, 'mid-turn text', 2),
      ],
      // Boundary seqs follow the log: a turn/end is strictly after its own nodes.
      turnEnds: new Map([[1, 3]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // 2 user + the settled turn-1 tail, which keeps its seat while a later
    // turn runs; turn 2's narration stays chrome-free while its tool runs, so
    // the footer never appears and then moves.
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(3)
    expect(view.getByText('mid-turn text')).toBeTruthy()
    // turn/end lands: the same node becomes the settled answer and takes the seat.
    act(() => { h.set({ running: false, runningCalls: [], turnEnds: new Map([[1, 3], [2, 6]]) }) })
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(4)
  })

  it('the actions-owning assistant footer shows the turn run time', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [
        user(1, 'hi'), // time 1_000
        assistant(2, 'mid-turn text'),
        assistant(16, 'final answer'),
        toolResult(18, 'trailing'),
      ],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 20_000 }]]),
      turnEnds: new Map([[1, 20]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // The exact turn/end includes trailing tool activity after the final text.
    expect(view.getAllByText(/用时 19秒/)).toHaveLength(1)
  })

  it('the settled footer appends first-step ttft and turn decode throughput', () => {
    /** 中文说明：测试局部值 first，取值由紧邻初始化决定。 */
    const first: AssistantMessageNode = {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'mid' }],
      timing: { stepStartTime: 1_000, firstTokenTime: 2_200, completedTime: 5_200 },
      usage: { outputTokens: 40 },
    }
    /** 中文说明：测试局部值 second，取值由紧邻初始化决定。 */
    const second: AssistantMessageNode = {
      kind: 'assistant', seq: 16, time: 16_000, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'final' }],
      timing: { stepStartTime: 10_000, firstTokenTime: 10_200, completedTime: 12_200 },
      usage: { outputTokens: 60 },
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'hi'), first, second],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 20_000 }]]),
      turnEnds: new Map([[1, 20]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // First-step ttft (1.2s) plus 100 tokens over 5s of decode.
    expect(view.getAllByText(/用时 19秒/)).toHaveLength(1)
    expect(view.getAllByText(/首 token 1\.2秒/)).toHaveLength(1)
    expect(view.getAllByText(/20 tok\/s/)).toHaveLength(1)
  })

  it('withholds ttft and throughput while the turn is still running', () => {
    /** 中文说明：测试局部值 settled，取值由紧邻初始化决定。 */
    const settled: AssistantMessageNode = {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'answer' }],
      timing: { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_000 },
      usage: { outputTokens: 10 },
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'hi'), settled],
      turnTimings: new Map([[1, { startTime: 1_000 }]]),
      turnEnds: new Map(),
      running: true,
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/首 token|tok\/s/)).toBeNull()
  })

  it('user and assistant message containers scope the hover-revealed time chrome', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'hi'), assistant(2, 'answer')],
      turnTimings: new Map([[1, { startTime: 1_000, endTime: 2_000 }]]),
      turnEnds: new Map([[1, 2]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // The user row and the settled assistant's Turn Tail each own one clock scope.
    expect(view.container.querySelectorAll('[data-time-hover-root]')).toHaveLength(2)
  })

  it('the run-time label is withheld when the turn start is outside the window', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [assistant(16, 'tail without trigger')],
      turnEnds: new Map([[1, 16]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/用时/)).toBeNull()
  })

  it('enables fork only on the finalized assistant at the completed transcript tail', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'question'), assistant(2, 'answer')],
      turnEnds: new Map([[1, 3]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // The user bubble offers no branch; the settled answer's is live.
    /** 中文说明：测试局部值 buttons，取值由紧邻初始化决定。 */
    const buttons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(buttons[0]!)
    expect(h.forkAt.mock.calls).toEqual([[2]])
  })

  it('disables fork when the indexed Turn has a later steering Node', () => {
    /** 中文说明：测试局部值 base，取值由紧邻初始化决定。 */
    const base = chatSnapshotFixture({
      nodes: [user(1, 'question'), assistant(2, 'answer')],
      turnEnds: new Map([[1, 4]]),
    })
    /** 中文说明：测试局部值 chat，取值由紧邻初始化决定。 */
    const chat = {
      ...base,
      locations: {
        getTurn: (turn: number) => turn === 1
          ? [...base.locations.getTurn(turn), 'fixture:steering:later']
          : base.locations.getTurn(turn),
        getStep: (turn: number, step: number) => base.locations.getStep(turn, step),
      },
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ chat })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 branch，取值由紧邻初始化决定。 */
    const branch = view.getByRole('button', { name: '在新对话中分支' })
    expect(branch.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(branch)
    expect(h.forkAt).not.toHaveBeenCalled()
  })

  it('keeps final content actions but disables branch when Tool and interrupted Think follow it', () => {
    /** 中文说明：测试局部值 interruptedThink，取值由紧邻初始化决定。 */
    const interruptedThink: AssistantMessageNode = {
      kind: 'assistant', seq: 4.1, time: 4_100, turn: 1, step: 2,
      blocks: [{ kind: 'reasoning', text: 'bad path' }], interrupted: true,
    }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'question'), assistant(2, 'answer'), toolResult(3, 'a'), interruptedThink],
      turnEnds: new Map([[1, 5]]),
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getAllByRole('button', { name: '复制' })).toHaveLength(2)
    /** 中文说明：测试局部值 buttons，取值由紧邻初始化决定。 */
    const buttons = view.getAllByRole('button', { name: '在新对话中分支' })
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(buttons[0]!)
    expect(h.forkAt).not.toHaveBeenCalled()
  })

  it('renders assistant Markdown across history, streaming, final, and interrupted states while user text stays literal', () => {
    /** 中文说明：测试局部值 markdown，取值由紧邻初始化决定。 */
    const markdown = '# Rendered\n\n- **one**\n- `two`'
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, markdown), assistant(2, markdown)] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.container.querySelectorAll('h1')).toHaveLength(1)
    /** 中文说明：测试局部值 literal，取值由紧邻初始化决定。 */
    const literal = view.getByText((_content, element) => (
      element?.tagName === 'DIV' && element.childElementCount === 0 && element.textContent === markdown
    ))
    expect(literal.querySelector('h1')).toBeNull()

    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: markdown }] } })
    })
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
    expect(view.container.querySelector('[data-streaming="true"] h1')?.textContent).toBe('Rendered')

    act(() => {
      h.set({
        nodes: [user(1, markdown), assistant(2, markdown), assistant(3, markdown)],
        partial: null,
      })
    })
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
    expect(view.container.querySelector('[data-streaming="true"]')).toBeNull()

    act(() => {
      h.set({
        nodes: [
          user(1, markdown),
          assistant(2, markdown),
          { ...assistant(3, markdown), interrupted: true },
        ],
      })
    })
    expect(view.getByText('已停止')).toBeTruthy()
    expect(view.container.querySelectorAll('h1')).toHaveLength(2)
  })

  it('streaming partial frames update the tail without replacing a sibling Tool row', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(2, 'old answer'), toolResult(3, 'a')],
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 tool，取值由紧邻初始化决定。 */
    const tool = view.getByTestId('tool-seat-a')
    /** 中文说明：测试局部值 beforeHtml，取值由紧邻初始化决定。 */
    const beforeHtml = tool.innerHTML
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'streaming…' }] } })
    })
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'streaming… more' }] } })
    })
    expect(view.getByText('streaming… more')).toBeTruthy()
    expect(view.getByTestId('tool-seat-a')).toBe(tool)
    expect(tool.innerHTML).toBe(beforeHtml)
  })

  it('streaming leaves neighbor tool rows and history items at zero re-renders', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(2, 'old'), toolResult(3, 'a')],
    })
    // Count renderSlot invocations: the memo boundary holds when CallRow does
    // not re-render, so the row's renderSlot call count freezes during chunks.
    /** 中文说明：当前数据 rowRenders，取值由紧邻初始化决定。 */
    let rowRenders = 0
    h.props.renderSlot = ((key: string, owner: object) => {
      if (key !== 'conversation.chat.node'
        || (owner as RoutedChatNodeOwner).node.kind !== 'tool-call') return null
      rowRenders += 1
      return <div data-testid="counting-row" />
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('counting-row')).toBeTruthy()
    /** 中文说明：测试局部值 afterMount，取值由紧邻初始化决定。 */
    const afterMount = rowRenders
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'chunk1' }] } })
    })
    act(() => {
      h.set({ partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'chunk1 chunk2' }] } })
    })
    expect(rowRenders).toBe(afterMount)
  })

  it('updates the selected call id handed to the Tool seat', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    render(<h.ChatView {...h.props} />)
    expect(h.toolOwners.at(-1)?.selectedCallId).toBeUndefined()
    act(() => { h.setSelection({ turnSeq: 3, callId: 'a', toolName: 'bash' }) })
    expect(h.toolOwners.at(-1)?.selectedCallId).toBe('a')
  })

  it('hands running calls to a live Tool group', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ runningCalls: [runningCall('r1')], running: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByTestId('tool-seat-r1')).toBeTruthy()
    expect(h.toolOwners[0]?.block).toMatchObject({ callId: 'r1', argsRaw: '{"command":"cmd-r1"}' })
    expect(view.getByRole('status').textContent).toBe('Deep diving...')
  })

  it('keeps the Tool renderer mounted when a running call settles into log order', () => {
    /** 中文说明：测试局部值 mounted，取值由紧邻初始化决定。 */
    const mounted = vi.fn()
    /** 中文说明：测试局部值 unmounted，取值由紧邻初始化决定。 */
    const unmounted = vi.fn()
    /** 中文说明：函数 StatefulToolNode 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
    function StatefulToolNode({ node }: { readonly node: ChatNode<'tool-call'> }) {
      useEffect(() => {
        mounted()
        return () => { unmounted() }
      }, [])
      /** 中文说明：测试局部值 root，取值由紧邻初始化决定。 */
      const root = node.data.root
      return (
        <div data-testid="stateful-tool" data-state={'kind' in root ? 'settled' : 'running'}>
          {root.callId}
        </div>
      )
    }

    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [user(1, 'q'), assistant(4, 'later')],
      runningCalls: [runningCall('r1')],
      running: true,
    })
    h.props.renderSlot = ((key: string, owner: object, opts?: { fallback?: React.ReactNode }) => {
      /** 中文说明：测试局部值 routed，取值由紧邻初始化决定。 */
      const routed = owner as RoutedChatNodeOwner
      return key === 'conversation.chat.node' && routed.node.kind === 'tool-call'
        ? <StatefulToolNode node={routed.node} />
        : opts?.fallback ?? null
    }) as ChatViewSlotProps['renderSlot']
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 tool，取值由紧邻初始化决定。 */
    const tool = view.getByTestId('stateful-tool')
    /** 中文说明：当前数据 row，取值由紧邻初始化决定。 */
    const row = view.container.querySelector('[data-chat-flow-key="fixture:tool:r1"]')
    expect(tool.dataset.state).toBe('running')
    expect(mounted).toHaveBeenCalledTimes(1)

    act(() => {
      h.set({
        nodes: [user(1, 'q'), toolResult(3, 'r1'), assistant(4, 'later')],
        runningCalls: [],
        running: false,
      })
    })

    expect(view.getByTestId('stateful-tool')).toBe(tool)
    expect(view.container.querySelector('[data-chat-flow-key="fixture:tool:r1"]')).toBe(row)
    expect(tool.dataset.state).toBe('settled')
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('the running clock uses turn/start, ignores steering, and stays out of the live region', () => {
    /** 中文说明：测试局部值 startTime，取值由紧邻初始化决定。 */
    const startTime = Date.now() - 125_000
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger: UserMessageNode = { ...user(1, 'go'), time: startTime + 1 }
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      nodes: [trigger], turnTimings: new Map([[1, { startTime }]]), running: true,
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    // Freshly mounted (as after a reload) yet already past the 15s gate.
    /** 中文说明：测试局部值 status，取值由紧邻初始化决定。 */
    const status = view.getByRole('status')
    expect(status.textContent).toMatch(/^Deep diving\.\.\.2分0\d秒$/)
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull()
    act(() => {
      h.set({ queue: [{
        id: 'steering-occurrence' as never,
        messageId: 'steering-message' as never,
        placement: 'steering',
        content: [{ type: 'text', text: 'also' }],
        preview: 'also',
        text: 'also',
      }] })
    })
    expect(status.textContent).toMatch(/^Deep diving\.\.\.2分0\d秒$/)
  })

  it('hands each ordered root call to the keyed business-node slot', () => {
    /** 中文说明：测试局部值 block，取值由紧邻初始化决定。 */
    const block = toolResult(3, 'a')
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [block] })
    /** 中文说明：有序集合 calls，取值由紧邻初始化决定。 */
    const calls: { key: string; owner: object; entryKey?: string }[] = []
    h.props.renderSlot = ((key: string, owner: object, opts?: { entryKey?: string; fallback?: React.ReactNode }) => {
      calls.push({ key, owner, ...(opts?.entryKey !== undefined ? { entryKey: opts.entryKey } : {}) })
      return opts?.fallback ?? null
    })
    render(<h.ChatView {...h.props} />)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      key: 'conversation.chat.node',
      owner: { node: { kind: 'tool-call' }, selectedCallId: undefined },
      entryKey: 'tool-call',
    })
    /** 中文说明：测试局部值 owner，取值由紧邻初始化决定。 */
    const owner = calls[0]?.owner as RoutedChatNodeOwner
    expect((owner.node.data as { readonly root: ToolCallBlock }).root).toBe(block)
    expect(owner.openFile).not.toBe(h.openFile)
    owner.openFile('src/a.ts')
    expect(h.openFile).toHaveBeenCalledWith('src/a.ts')
    expect(owner.inspectCall).toBe(h.inspectCall)
  })

  it('shows a Host open refusal with the reason and retries the same path', async () => {
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('xdg-open is not available'))
      .mockResolvedValueOnce(undefined)
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('src/a.ts') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件' })).toBeTruthy()
    })
    expect(screen.getByRole('dialog', { name: '无法打开文件' }).textContent).toContain('xdg-open is not available')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(openFile).toHaveBeenCalledTimes(2)
    expect(openFile).toHaveBeenNthCalledWith(1, 'src/a.ts')
    expect(openFile).toHaveBeenNthCalledWith(2, 'src/a.ts')
  })

  it('keeps a non-Error Host refusal visible and dismisses it on cancel', async () => {
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce('permission denied')
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('notes.md') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件' }).textContent).toContain('permission denied')
    })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(openFile).toHaveBeenCalledTimes(1)
  })

  it('substitutes the unknown-open copy when the Host refusal has no text', async () => {
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error(''))
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('empty.ts') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件' }).textContent).toContain('无法打开此文件')
    })
  })

  it('names a workspace-folder Host refusal as a folder', async () => {
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error(''))
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('.') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件夹' }).textContent).toContain('无法打开此文件夹')
    })
  })

  it('ignores a Host refusal that settles after the dialog is dismissed', async () => {
    /** 中文说明：测试局部值 rejectRetry，取值由紧邻初始化决定。 */
    let rejectRetry!: (error: unknown) => void
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first refusal'))
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        rejectRetry = reject
      }))
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('src/a.ts') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件' }).textContent).toContain('first refusal')
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })) })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => { rejectRetry(new Error('late refusal')) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores a Host open that succeeds after the dialog is dismissed', async () => {
    /** 中文说明：测试局部值 resolveRetry，取值由紧邻初始化决定。 */
    let resolveRetry!: () => void
    /** 中文说明：测试局部值 openFile，取值由紧邻初始化决定。 */
    const openFile = vi.fn<(path: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('first refusal'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveRetry = () => { resolve() }
      }))
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [toolResult(3, 'a')] })
    h.props.openFile = openFile
    render(<h.ChatView {...h.props} />)
    await act(async () => { h.toolOwners[0]!.openFile('src/a.ts') })
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '无法打开文件' }).textContent).toContain('first refusal')
    })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })) })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await act(async () => { resolveRetry() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('prepend preserves a semantic row; a trailing user node force-scrolls', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(5, 'later'), assistant(6, 'a')], hasMore: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    // jsdom has no layout: fake the metrics the anchor math reads.
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 400, writable: true })
    /** 中文说明：测试局部值 anchored，取值由紧邻初始化决定。 */
    const anchored = view.container.querySelector('[data-chat-flow-key="fixture:user:5"]') as HTMLDivElement
    /** 中文说明：测试局部值 anchoredTop，取值由紧邻初始化决定。 */
    let anchoredTop = 100
    vi.spyOn(anchored, 'getBoundingClientRect').mockImplementation(
      () => ({ top: anchoredTop, bottom: anchoredTop + 40 } as DOMRect),
    )
    readerScroll(scroller, 80)
    // Arm the paging anchor, then deliver an older page (head seq decreases).
    fireEvent.click(view.getByText('加载更早'))
    Object.defineProperty(scroller, 'scrollHeight', { value: 1600, writable: true })
    anchoredTop = 700
    act(() => { h.set({ nodes: [user(1, 'old'), assistant(2, 'b'), user(5, 'later'), assistant(6, 'a')] }) })
    expect(scroller.scrollTop).toBe(680) // reader offset 80 + the anchored row's 600px shift
    // A new trailing user bubble (own words) force-scrolls to the bottom.
    act(() => { h.set({ nodes: [user(1, 'old'), assistant(2, 'b'), user(5, 'later'), assistant(6, 'a'), user(9, 'mine')] }) })
    expect(scroller.scrollTop).toBe(1600)
  })

  it('back-to-bottom cancels an in-flight paging anchor', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(9, 'late')], hasMore: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 800, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 200, writable: true })
    readerScroll(scroller, 50)
    fireEvent.click(view.getByText('加载更早'))
    fireEvent.click(view.getByLabelText('回到底部'))
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_300, writable: true })
    act(() => { h.set({ nodes: [assistant(2, 'older'), user(9, 'late')] }) })
    expect(scroller.scrollTop).toBe(1_300)
    expect(h.chatScroll.read()).toBeNull()
  })

  it('scrolling away disables follow and shows the back-to-bottom button; clicking returns', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    readerScroll(scroller, 100) // far from bottom
    /** 中文说明：测试局部值 backButton，取值由紧邻初始化决定。 */
    const backButton = view.getByLabelText('回到底部')
    expect(backButton).toBeTruthy()
    // Streaming growth must NOT drag a scrolled-away reader down.
    act(() => { h.set({ partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'grow' }] } }) })
    expect(scroller.scrollTop).toBe(100)
    fireEvent.click(backButton)
    expect(scroller.scrollTop).toBe(1000)
    // At the bottom again: follow re-arms and the button unmounts.
    expect(view.queryByLabelText('回到底部')).toBeNull()
  })

  it('keeps following when a stream-finalization shrink clamp delivers its scroll', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    /** 中文说明：测试局部值 metrics，取值由紧邻初始化决定。 */
    const metrics = installScrollMetrics(scroller, 1_000, 300)
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)

    // Stream finalization shrinks the column: the browser clamps the pinned
    // position onto the new floor and delivers a scroll event. The clamp
    // lands exactly on the ledger's floor min, so it is not reader input.
    metrics.setLayout(800, 700)
    fireEvent.scroll(scroller)
    expect(scroller.scrollTop).toBe(500)
    expect(view.queryByLabelText('回到底部')).toBeNull()
    expect(h.chatScroll.read()).toBeNull()

    metrics.setHeight(1_200)
    act(() => { h.set({ running: true }) })
    expect(scroller.scrollTop).toBe(900)
  })

  it('uses the last delivered top when compositor scrolling precedes scroll delivery', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    installScrollMetrics(scroller, 1_000, 300)
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)

    // Chromium advances compositor geometry before delivering the event:
    // attribution must compare against the observed-top ledger, never a
    // baseline sampled from already-moved raw geometry.
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    expect(view.getByLabelText('回到底部')).toBeTruthy()
  })

  it('one ResizeObserver owns pinned dynamic-height follow and ignores growth while away', () => {
    /** 中文说明：测试局部值 notify，取值由紧邻初始化决定。 */
    let notify: (() => void) | undefined
    /** 中文说明：测试局部值 observe，取值由紧邻初始化决定。 */
    const observe = vi.fn()
    /** 中文说明：类型或类 ResizeObserverStub 约束本文件的数据或组件职责。 */
    class ResizeObserverStub {
      constructor(callback: ResizeObserverCallback) {
        notify = () => { callback([], this as unknown as ResizeObserver) }
      }

      observe = observe
      disconnect = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    scroller.scrollTop = 700
    fireEvent.scroll(scroller)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_200, writable: true })
    act(() => { notify?.() })
    expect(scroller.scrollTop).toBe(1_200)
    readerScroll(scroller, 200)
    Object.defineProperty(scroller, 'scrollHeight', { value: 1_400, writable: true })
    act(() => { notify?.() })
    expect(scroller.scrollTop).toBe(200)
    expect(observe).toHaveBeenCalledTimes(1)
  })

  it('entering the at-bottom threshold does not snap the remaining scroll distance', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    /** 中文说明：测试局部值 scroller，取值由紧邻初始化决定。 */
    const scroller = view.container.querySelector('[class*="scroll"]') as HTMLDivElement
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, writable: true })
    Object.defineProperty(scroller, 'clientHeight', { value: 300, writable: true })
    // Inside FOLLOW_THRESHOLD (24) but not flush with the floor — the chrome
    // re-render from setAtBottom must not force scrollTop to scrollHeight.
    readerScroll(scroller, 690) // distance-to-bottom = 10
    expect(view.queryByLabelText('回到底部')).toBeNull()
    expect(scroller.scrollTop).toBe(690)
  })

  it('under data-conversation-scroll, bottom-follow targets the host scrollport', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    try {
      /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
      const view = render(<h.ChatView {...h.props} />, { container: host })
      // Open jump uses the host, not the local .scroll node.
      expect(host.scrollTop).toBe(2000)
      readerScroll(host, 100)
      expect(view.getByLabelText('回到底部')).toBeTruthy()
      fireEvent.click(view.getByLabelText('回到底部'))
      expect(host.scrollTop).toBe(2000)
    } finally {
      host.remove()
    }
  })

  it('a remount restores the saved semantic row after width reflow', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    /** 中文说明：测试局部值 anchorTop，取值由紧邻初始化决定。 */
    let anchorTop = 80
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, bottom: 500 } as DOMRect),
    )
    /** 中文说明：测试局部值 rect，取值由紧邻初始化决定。 */
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.chatAnchorKey === 'fixture:user:1') {
        return { top: anchorTop, bottom: anchorTop + 40 } as DOMRect
      }
      return { top: 0, bottom: 40 } as DOMRect
    })
    try {
      /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      // Fresh open (nothing saved): the bottom jump stands.
      /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
      const view = render(<h.ChatView {...h.props} />, { container: host })
      expect(host.scrollTop).toBe(2000)
      // Reader scrolls up; the position is recorded continuously.
      readerScroll(host, 100)
      // View-tab switch away and back: the view unmounts, then remounts.
      view.rerender(<div />)
      anchorTop = 560
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(580) // approximate 100 + the row's 480px reflow shift
      // The restored position is above the floor: follow stays disarmed.
      expect(view.getByLabelText('回到底部')).toBeTruthy()
    } finally {
      rect.mockRestore()
      host.remove()
    }
  })

  it('normalizes a semantic restore clamped to the bottom before an immediate remount', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2_000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    /** 中文说明：测试局部值 scrollTop，取值由紧邻初始化决定。 */
    let scrollTop = 0
    Object.defineProperty(host, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = Math.min(value, 1_500) },
    })
    document.body.appendChild(host)
    /** 中文说明：测试局部值 rect，取值由紧邻初始化决定。 */
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.chatAnchorKey === 'fixture:user:1') return { top: 300, bottom: 340 } as DOMRect
      return { top: 0, bottom: 500 } as DOMRect
    })
    try {
      /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      h.chatScroll.save({ anchorKey: 'fixture:user:1', anchorTop: 80, scrollTop: 1_400 })
      /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
      const view = render(<h.ChatView {...h.props} />, { container: host })
      expect(host.scrollTop).toBe(1_500)
      expect(h.chatScroll.read()).toBeNull()
      view.rerender(<div />)
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(1_500)
    } finally {
      rect.mockRestore()
      host.remove()
    }
  })

  it('a remount while pinned to the bottom keeps the bottom jump', () => {
    /** 中文说明：测试局部值 host，取值由紧邻初始化决定。 */
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    Object.defineProperty(host, 'scrollHeight', { value: 2000, writable: true, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 500, writable: true, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: 0, writable: true, configurable: true })
    document.body.appendChild(host)
    try {
      /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
      const h = makeHarness({ nodes: [user(1, 'q'), assistant(2, 'a')] })
      /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
      const view = render(<h.ChatView {...h.props} />, { container: host })
      // At the bottom: the scroll event records the pinned state (null).
      fireEvent.scroll(host)
      expect(h.chatScroll.read()).toBeNull()
      view.rerender(<div />)
      host.scrollTop = 0
      view.rerender(<h.ChatView {...h.props} />)
      expect(host.scrollTop).toBe(2000)
    } finally {
      host.remove()
    }
  })

  it('paging button loads older and shows its busy label', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [user(5, 'later')], hasMore: true })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    fireEvent.click(view.getByText('加载更早'))
    expect(h.loadOlder).toHaveBeenCalledTimes(1)
    act(() => { h.set({ loadingOlder: true }) })
    expect(view.getByText('加载中…')).toBeTruthy()
  })

  it('shows open error and loading states', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      openState: 'error',
      openError: { code: 'internal', message: 'boom' } as never,
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText(/历史加载失败：boom/)).toBeTruthy()
    /** 中文说明：测试局部值 loading，取值由紧邻初始化决定。 */
    const loading = makeHarness({ openState: 'loading' })
    /** 中文说明：测试局部值 lv，取值由紧邻初始化决定。 */
    const lv = render(<loading.ChatView {...loading.props} />)
    expect(lv.getByText('载入历史…')).toBeTruthy()
  })

  it('pending waits leave the flow entirely — questions and approvals both take over the composer', () => {
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({
      pending: [
        new PendingWait('approval', RpcId('r1'), SID,
          { approvalId: 'ap1', toolName: 'bash' } as PendingWait<'approval'>['payload'], vi.fn()),
        new PendingWait('question', RpcId('r2'), SID,
          { questions: [{ id: 'q1', question: '选择' }] }, vi.fn()),
      ],
    })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.queryByText(/等待回答/)).toBeNull()
    expect(view.queryByText(/等待审批/)).toBeNull()
  })

  it('renders command nodes as durable rows: settled text, error state, executing spinner, run-less soft-fall', () => {
    // Settled success: the bare command name is the title, the outcome text
    // the summary — neither the dispatched `/` nor its arguments reach the row
    // (the settlement text already says what the command did).
    /** 中文说明：测试局部值 settled，取值由紧邻初始化决定。 */
    const settled = makeHarness({ nodes: [user(1, 'hi'), command({ args: ' now' })] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<settled.ChatView {...settled.props} />)
    expect(view.getByText('plan')).toBeTruthy()
    expect(view.queryByText('/plan')).toBeNull()
    expect(view.queryByText('/plan now')).toBeNull()
    expect(view.getByText('已进入 plan mode')).toBeTruthy()

    // Error outcome flips the row state; a text-less error gets the default copy.
    /** 中文说明：测试局部值 failed，取值由紧邻初始化决定。 */
    const failed = makeHarness({
      nodes: [command({ seq: 6, commandId: 'cmd-2' as CommandNode['commandId'], outcome: { kind: 'error' } })],
    })
    /** 中文说明：测试局部值 fv，取值由紧邻初始化决定。 */
    const fv = render(<failed.ChatView {...failed.props} />)
    expect(fv.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(fv.getByText('命令失败')).toBeTruthy()
    expect(fv.getByText('失败')).toBeTruthy()

    // Still executing: running state with the executing copy.
    /** 中文说明：测试局部值 executing，取值由紧邻初始化决定。 */
    const executing = makeHarness({
      nodes: [command({ seq: 7, commandId: 'cmd-3' as CommandNode['commandId'], outcome: null })],
    })
    /** 中文说明：测试局部值 xv，取值由紧邻初始化决定。 */
    const xv = render(<executing.ChatView {...executing.props} />)
    expect(xv.container.querySelector('[data-state="running"]')).not.toBeNull()
    expect(xv.getByText('执行中…')).toBeTruthy()
    expect(xv.getByText('运行中')).toBeTruthy()

    // Cross-window soft-fall (run page truncated): generic title, outcome preserved.
    /** 中文说明：测试局部值 orphan，取值由紧邻初始化决定。 */
    const orphan = makeHarness({
      nodes: [command({ seq: 8, commandId: 'cmd-4' as CommandNode['commandId'], name: null, args: null, outcome: { kind: 'success' } })],
    })
    /** 中文说明：测试局部值 ov，取值由紧邻初始化决定。 */
    const ov = render(<orphan.ChatView {...orphan.props} />)
    expect(ov.getByText('命令')).toBeTruthy()
    expect(ov.getByText('已完成')).toBeTruthy()
  })

  it('renders /compact as one stateful disclosure from running through completion', () => {
    /** 中文说明：测试局部值 running，取值由紧邻初始化决定。 */
    const running = command({
      commandId: 'cmd-compact' as CommandNode['commandId'],
      name: 'compact',
      outcome: null,
    })
    /** 中文说明：测试局部值 h，取值由紧邻初始化决定。 */
    const h = makeHarness({ nodes: [running] })
    /** 中文说明：测试局部值 view，取值由紧邻初始化决定。 */
    const view = render(<h.ChatView {...h.props} />)
    expect(view.getByText('正在压缩…')).toBeTruthy()
    expect(view.container.querySelector('[data-state="running"]')).not.toBeNull()

    act(() => {
      h.set({
        nodes: [{
          ...running,
          outcome: {
            kind: 'success',
            text: 'Compacted 16 history items (~11309 tokens).',
            sourceEventSeq: 7,
          },
        }, compaction()],
      })
    })

    expect(view.queryByText('正在压缩…')).toBeNull()
    expect(view.queryByText('上下文已压缩')).toBeNull()
    expect(view.getByText('已压缩 16 条历史记录（约 11309 tokens）')).toBeTruthy()
    /** 中文说明：当前数据 row，取值由紧邻初始化决定。 */
    const row = view.getByRole('button', { name: /compact/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(row.querySelector('[data-compaction-icon="context"]')).not.toBeNull()
    expect(row.querySelector('[data-compaction-disclosure="collapsed"]')).not.toBeNull()
    expect(view.queryByText('保留的事实。')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(row.querySelector('[data-compaction-disclosure="expanded"]')).not.toBeNull()
    expect(view.getByRole('heading', { name: '压缩摘要' })).toBeTruthy()
  })

  it('keeps /compact no-history and error settlements on the generic command row', () => {
    /** 中文说明：测试局部值 noHistory，取值由紧邻初始化决定。 */
    const noHistory = makeHarness({
      nodes: [command({
        name: 'compact',
        outcome: { kind: 'success', text: 'No compactable history yet.' },
      })],
    })
    /** 中文说明：测试局部值 noHistoryView，取值由紧邻初始化决定。 */
    const noHistoryView = render(<noHistory.ChatView {...noHistory.props} />)
    expect(noHistoryView.getByText('No compactable history yet.')).toBeTruthy()
    expect(noHistoryView.queryByRole('button')).toBeNull()

    /** 中文说明：测试局部值 failed，取值由紧邻初始化决定。 */
    const failed = makeHarness({
      nodes: [command({
        commandId: 'cmd-compact-failed' as CommandNode['commandId'],
        name: 'compact',
        outcome: { kind: 'error', text: 'Compaction cancelled.' },
      })],
    })
    /** 中文说明：测试局部值 failedView，取值由紧邻初始化决定。 */
    const failedView = render(<failed.ChatView {...failed.props} />)
    expect(failedView.getByText('Compaction cancelled.')).toBeTruthy()
    expect(failedView.container.querySelector('[data-state="error"]')).not.toBeNull()
  })
})
