// @vitest-environment jsdom
/**
 * 文件职责：验证会话界面的 enter-behavior-row.client.spec.tsx 行为和边界。
 * 技术维度：Vitest、React 测试渲染、事件模拟与可控服务替身。
 * 产品维度：防止会话界面交互和展示在扩展后回归。
 * 逻辑维度：构造状态，触发渲染或交互，再断言输出和清理。
 * 关键边界：全局替身、计时器和异步任务必须在用例后恢复。
 * 新手阅读建议：先读辅助夹具，再按 describe 场景顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EnterBehaviorRow } from '../src/client/settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowProps } from '../src/client/settings/EnterBehaviorRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

/** 中文说明：函数 emptySessions 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

/** 中文说明：函数 emptyWorkspaces 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件调用处。 */
function mount() {
  /** 中文说明：测试局部值 policy，取值由紧邻初始化决定。 */
  const policy = new ComposerSubmissionPolicy()
  /** 中文说明：测试局部值 setBusyEnter，取值由紧邻初始化决定。 */
  const setBusyEnter = vi.fn((behavior: 'queue' | 'steer') => { policy.setBusyEnter(behavior) })
  /** 中文说明：测试局部值 props，取值由紧邻初始化决定。 */
  const props: EnterBehaviorRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useBusyEnter: bindSnapshotSelector(policy.busyEnter),
    setBusyEnter,
    t: makeTranslate(en),
  }
  render(<EnterBehaviorRow {...props} />)
  return { policy, setBusyEnter }
}

describe('EnterBehaviorRow', () => {
  it('explains the busy-only scope and shows Queue by default', () => {
    mount()
    expect(screen.getByText('Enter behavior while busy')).toBeDefined()
    expect(screen.getByText('Busy only; Cmd/Ctrl+Enter uses the other behavior')).toBeDefined()
    expect(screen.getByRole('button', { name: /Queue/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Steer, follows later preference changes, and closes outside', () => {
    /** 中文说明：测试局部值 b，取值由紧邻初始化决定。 */
    const b = mount()
    /** 中文说明：测试局部值 trigger，取值由紧邻初始化决定。 */
    const trigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Steer' }))
    expect(b.setBusyEnter).toHaveBeenCalledWith('steer')
    expect(screen.getByRole('button', { name: /Steer/ })).toBeDefined()

    act(() => { b.policy.setBusyEnter('queue') })
    /** 中文说明：测试局部值 queueTrigger，取值由紧邻初始化决定。 */
    const queueTrigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(queueTrigger)
    expect(screen.getByRole('menuitem', { name: 'Steer' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Steer' })).toBeNull()
  })
})
