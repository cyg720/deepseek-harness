// @vitest-environment jsdom
/*
 * 文件职责：验证会话输入的 queue-dock.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止会话输入用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
/**
 * QueueDock rendering and operations: authoritative rows, inline editing,
 * collapse state, removal, strict steering, failure notices, and live retirement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, QueuedMessage, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QueueItemId } from '../src/client/contract/queue.ts'
import type { InputState } from '../src/client/input/contract.ts'
import { zh } from '../src/client/locales.ts'
import { QueueDock, queueDockEntry, type QueueDockInjected, type QueueDockProps } from '../src/client/queue/QueueDock.tsx'

afterEach(cleanup)

/** 中文说明：测试局部值 SID，由紧邻初始化决定。 */
const SID = 's1' as SessionId
/** 中文说明：测试局部值 iid，由紧邻初始化决定。 */
const iid = (id: string): QueueItemId => id as QueueItemId

/** 中文说明：函数 row 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function row(id: string, text: string | null, preview = text ?? '[image]'): QueuedMessage {
  return {
    id: iid(id), messageId: `message-${id}` as never, placement: 'queued',
    content: text === null ? [{ type: 'image', data: 'x' } as never] : [{ type: 'text', text }],
    preview, text,
  }
}

/** 中文说明：函数 snapshotWith 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function snapshotWith(queue: QueuedMessage[]): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue, running: true, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

/** Minimal live source backing the useSession stub. */
/* 中文说明：函数 liveSession 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function liveSession(initial: ConversationSnapshot) {
  /** 中文说明：测试局部值 snapshot，由紧邻初始化决定。 */
  let snapshot = initial
  /** 中文说明：测试局部值 listeners，由紧邻初始化决定。 */
  const listeners = new Set<() => void>()
  /** 中文说明：测试局部值 useSession，由紧邻初始化决定。 */
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => selector(snapshot),
    )
  return {
    useSession,
    push(next: ConversationSnapshot): void {
      snapshot = next
      /** 中文说明：测试局部值 listener，由紧邻初始化决定。 */
      for (const listener of [...listeners]) listener()
    },
  }
}

/** InputZone owner stub (the dock reads useSession only; the zone fields satisfy the owner share). */
/* 中文说明：测试局部值 INPUT_STATE，由紧邻初始化决定。 */
const INPUT_STATE: InputState = { draft: '', imageIds: [], draftRev: 0, phase: 'plain', occurrences: [], queue: [] }

// Standard locale seat stub mirroring the real ns → common → key chain.
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: QueueDockProps['t'] = makeTranslate(zh, commonZh)

/** 中文说明：函数 kitFor 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function kitFor(snapshot: ConversationSnapshot, injected: Partial<QueueDockInjected> = {}) {
  return {
    sessionId: SID,
    t,
    useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
    useWorkspaces: (() => { throw new Error('unused') }) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => { throw new Error('unused') }) as never,
    inputActions: { setDraft: () => {}, submit: () => {} } as never,
    session: snapshot,
    input: INPUT_STATE,
    updateQueue: vi.fn(() => Promise.resolve()),
    notify: vi.fn(),
    ...injected,
  }
}

describe('QueueDock', () => {
  it('renders null while the queue is empty', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('leaves pending steering to the conversation flow', () => {
    /** 中文说明：测试局部值 steering，由紧邻初始化决定。 */
    const steering = { ...row('s-1', 'interrupt'), placement: 'steering' as const }
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([steering])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders one row directly and defaults multiple rows to a collapsible count header', () => {
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    const single = snapshotWith([row('i-1', 'one')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(single)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<QueueDock {...kitFor(single)} useSession={source.useSession} />)
    expect(view.queryByRole('button', { name: '1 条排队消息' })).toBeNull()
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([row('i-1', 'one'), row('i-2', 'two')])) })
    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(header.getAttribute('aria-controls')!)).toBeTruthy()
    expect(view.queryByText('one')).toBeNull()
    expect(view.queryByText('two')).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('one')).toBeTruthy()
    expect(view.getByText('two')).toBeTruthy()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('one')).toBeNull()
  })

  it('keeps an active single-row editor visible when another item arrives', () => {
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    const single = snapshotWith([row('i-edit', 'before')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(single)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<QueueDock {...kitFor(single)} useSession={source.useSession} />)

    fireEvent.click(view.getByLabelText('编辑排队消息'))
    fireEvent.change(view.getByLabelText('编辑排队消息'), { target: { value: 'draft' } })
    act(() => {
      source.push(snapshotWith([row('i-edit', 'before'), row('i-2', 'second')]))
    })

    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header).toHaveProperty('disabled', true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('textbox', { name: '编辑排队消息' })).toHaveProperty('value', 'draft')
    expect(view.getByText('second')).toBeTruthy()

    fireEvent.click(view.getByLabelText('取消编辑'))
    expect(header).toHaveProperty('disabled', false)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('second')).toBeNull()
  })

  it('keeps an in-flight row action visible when another item arrives', async () => {
    /** 中文说明：测试局部值 single，由紧邻初始化决定。 */
    const single = snapshotWith([row('i-remove', 'remove me')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(single)
    /** 中文说明：测试局部值 finishUpdate，由紧邻初始化决定。 */
    let finishUpdate: (() => void) | undefined
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => new Promise<void>((resolve) => { finishUpdate = resolve }))
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <QueueDock {...kitFor(single, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(view.getByLabelText('删除排队消息'))
    act(() => {
      source.push(snapshotWith([row('i-remove', 'remove me'), row('i-2', 'second')]))
    })

    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header).toHaveProperty('disabled', true)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('remove me')).toBeTruthy()
    expect(view.getByText('second')).toBeTruthy()

    expect(updateQueue).toHaveBeenCalledOnce()
    await act(async () => {
      finishUpdate?.()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(header).toHaveProperty('disabled', false)
      expect(header.getAttribute('aria-expanded')).toBe('false')
    })
  })

  it('defaults a new multi-row queue to collapsed after the prior queue empties', () => {
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(first)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<QueueDock {...kitFor(first)} useSession={source.useSession} />)
    fireEvent.click(view.getByRole('button', { name: '2 条排队消息' }))
    expect(view.getByText('one')).toBeTruthy()

    act(() => { source.push(snapshotWith([])) })
    expect(view.container.innerHTML).toBe('')
    act(() => {
      source.push(snapshotWith([row('i-3', 'three'), row('i-4', 'four')]))
    })

    /** 中文说明：测试局部值 header，由紧邻初始化决定。 */
    const header = view.getByRole('button', { name: '2 条排队消息' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByText('three')).toBeNull()
  })

  it('renders active actions and disables editing for mixed-content rows', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([
      row('i-1', '第一条排队消息'),
      row('i-2', null, 'image [image]'),
    ])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 { container, getByRole }，由紧邻初始化决定。 */
    const { container, getByRole } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    fireEvent.click(getByRole('button', { name: '2 条排队消息' }))
    expect([...container.querySelectorAll('li')].map(item => item.textContent))
      .toEqual(['第一条排队消息', 'image [image]'])
    expect(container.querySelectorAll('button')).toHaveLength(7)
    expect(container.querySelectorAll('[aria-label="编辑排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="删除排队消息"]')).toHaveLength(2)
    expect(container.querySelectorAll('[aria-label="插话发送"]')).toHaveLength(2)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[0] as HTMLButtonElement).disabled).toBe(false)
    expect((container.querySelectorAll('[aria-label="编辑排队消息"]')[1] as HTMLButtonElement).disabled).toBe(true)
    expect(container.querySelectorAll('[aria-label="编辑排队消息"]')[1]?.getAttribute('title'))
      .toBe('包含非文本内容，暂不支持编辑')
  })

  it('edits text inline with save and cancel controls, then saves with the same item identity', async () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-edit', 'before')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.resolve())
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { getByLabelText, queryByLabelText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    /** 中文说明：测试局部值 editor，由紧邻初始化决定。 */
    const editor = getByLabelText('编辑排队消息') as HTMLInputElement
    expect(getByLabelText('保存排队消息')).toBeTruthy()
    expect(getByLabelText('取消编辑')).toBeTruthy()
    expect(queryByLabelText('删除排队消息')).toBeNull()
    fireEvent.change(editor, { target: { value: 'after' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-edit'), {
        kind: 'edit',
        content: [{ type: 'text', text: 'after' }],
      })
    })
  })

  it('cancels an edit by button or Escape without mutating the queue', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-edit', 'before')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.resolve())
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    fireEvent.change(getByLabelText('编辑排队消息'), { target: { value: 'abandoned' } })
    fireEvent.click(getByLabelText('取消编辑'))
    expect(getByText('before')).toBeTruthy()

    fireEvent.click(getByLabelText('编辑排队消息'))
    fireEvent.keyDown(getByLabelText('编辑排队消息'), { key: 'Escape' })
    expect(getByText('before')).toBeTruthy()
    expect(updateQueue).not.toHaveBeenCalled()
  })

  it('keeps editing during IME composition and disables a blank save', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-edit', 'before')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.resolve())
    /** 中文说明：测试局部值 { getByLabelText }，由紧邻初始化决定。 */
    const { getByLabelText } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('编辑排队消息'))
    /** 中文说明：测试局部值 editor，由紧邻初始化决定。 */
    const editor = getByLabelText('编辑排队消息')
    fireEvent.change(editor, { target: { value: '   ' } })
    expect(getByLabelText('保存排队消息')).toHaveProperty('disabled', true)
    fireEvent.change(editor, { target: { value: '输入中' } })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(updateQueue).not.toHaveBeenCalled()
    expect(getByLabelText('编辑排队消息')).toBeTruthy()
  })

  it('removes the addressed row', async () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-1', 'one'), row('i-2', 'two')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.resolve())
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { getAllByLabelText, getByRole } = render(
      <QueueDock {...kitFor(snap, { updateQueue })} useSession={source.useSession} />,
    )

    fireEvent.click(getByRole('button', { name: '2 条排队消息' }))
    fireEvent.click(getAllByLabelText('删除排队消息')[0]!)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-1'), { kind: 'remove' })
    })
  })

  it('strictly steers complete row content only while the agent is running', async () => {
    /** 中文说明：测试局部值 running，由紧邻初始化决定。 */
    const running = snapshotWith([row('i-steer', null, 'image [image]')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(running)
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.resolve())
    /** 中文说明：测试局部值 rendered，由紧邻初始化决定。 */
    const rendered = render(
      <QueueDock {...kitFor(running, { updateQueue })} useSession={source.useSession} />,
    )

    /** 中文说明：测试局部值 button，由紧邻初始化决定。 */
    const button = rendered.getByLabelText('插话发送')
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    await waitFor(() => {
      expect(updateQueue).toHaveBeenCalledWith(iid('i-steer'), { kind: 'steer' })
    })

    act(() => { source.push({ ...running, running: false }) })
    expect(rendered.getByLabelText('插话发送')).toHaveProperty('disabled', true)
    expect(rendered.getByLabelText('插话发送').getAttribute('title')).toBe('仅运行中可插话发送')
  })

  it('renders a session-backed subagent Queue without unsupported actions', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = {
      ...snapshotWith([row('i-subagent', 'pending child follow-up')]),
      subagent: {
        address: {
          parentSessionId: 'parent' as SessionId,
          childSessionId: SID,
          mode: 'continuable' as const,
        },
        parentAvailable: true,
      },
    }
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <QueueDock {...kitFor(snap)} useSession={source.useSession} />,
    )

    expect(view.getByText('pending child follow-up')).toBeTruthy()
    expect(view.queryByLabelText('编辑排队消息')).toBeNull()
    expect(view.queryByLabelText('删除排队消息')).toBeNull()
    expect(view.queryByLabelText('插话发送')).toBeNull()
  })

  it('keeps the row and reports a genuine steer failure', async () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-steer-race', 'pending steer')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    const notify = vi.fn()
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.reject(new Error('transport failed')))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('插话发送'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'error',
        '插话发送失败，请重试。',
      )
    })
    expect(getByText('pending steer')).toBeTruthy()
  })

  it('keeps the row and surfaces a notice when an operation loses the claim race', async () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-race', 'pending')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 notify，由紧邻初始化决定。 */
    const notify = vi.fn()
    /** 中文说明：测试局部值 updateQueue，由紧邻初始化决定。 */
    const updateQueue = vi.fn(() => Promise.reject(new Error('not found')))
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    const { getByLabelText, getByText } = render(
      <QueueDock {...kitFor(snap, { updateQueue, notify })} useSession={source.useSession} />,
    )

    fireEvent.click(getByLabelText('删除排队消息'))
    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith('error', '删除失败：这条消息可能已经开始发送。')
    })
    expect(getByText('pending')).toBeTruthy()
  })

  it('follows authoritative retirement back to null', () => {
    /** 中文说明：测试局部值 snap，由紧邻初始化决定。 */
    const snap = snapshotWith([row('i-1', '在场')])
    /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
    const source = liveSession(snap)
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<QueueDock {...kitFor(snap)} useSession={source.useSession} />)
    expect(container.textContent).toContain('在场')
    act(() => { source.push(snapshotWith([])) })
    expect(container.innerHTML).toBe('')
  })

  it('registers as the terminal composer-context entry', () => {
    expect(queueDockEntry.name).toBe('conversation-queue-dock')
    expect(queueDockEntry.inject).toEqual(['slots', 'conversation', 'sessions'])
    /** 中文说明：测试局部值 register，由紧邻初始化决定。 */
    const register = vi.fn(() => () => undefined)
    /** 中文说明：测试局部值 inject，由紧邻初始化决定。 */
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    queueDockEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'conversation.input.dock', id: 'queue', order: 20 }),
      QueueDock,
    )
  })
})
