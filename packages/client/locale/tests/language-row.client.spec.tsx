// @vitest-environment jsdom
/**
 * 文件职责：验证本地化的 language-row 行为与边界。
 * 技术维度：Vitest、TypeScript、可控测试替身和真实模块组装。
 * 产品维度：防止用户可见行为在重构或扩展后发生回归。
 * 逻辑维度：构造场景输入，调用被测入口，记录状态并断言结果。
 * 关键边界：测试替身需在用例后清理；异步任务不能泄漏到后续场景。
 * 新手阅读建议：先读辅助函数和固定数据，再按 describe 场景顺序阅读。
 */
/** LanguageRow behavior: selector pill shows the active locale, the menu
 * opens/closes, and selection drives setLocale. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LanguageRow } from '../src/client/LanguageRow.tsx'
import type { LanguageRowComponentProps } from '../src/client/LanguageRow.tsx'
import { createLanguageRowStore } from '../src/client/settings-store.ts'

afterEach(cleanup)

/** 中文说明：按序保存的数据集合 OPTIONS，取值由紧邻初始化决定，仅在当前作用域使用。 */
const OPTIONS = [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]

/** Empty global standard-kit hooks (the row reads neither). */
/* 中文说明：函数 emptySessions 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function emptySessions() {
  /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
/** 中文说明：函数 emptyWorkspaces 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function emptyWorkspaces() {
  /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

/** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function mount(active = 'en') {
  // Real store instance — the sanctioned zero-machinery path for tests.
  /** 中文说明：当前状态或快照 store，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const store = createLanguageRowStore().create()
  store.actions.sync(active, OPTIONS, 0)
  /** 中文说明：测试场景的局部值 setLocale，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const setLocale = vi.fn()
  /** 中文说明：测试场景的局部值 props，取值由紧邻初始化决定，仅在当前作用域使用。 */
  const props: LanguageRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => key === 'language.title' ? 'Language' : key,
    setLocale,
  }
  render(<LanguageRow {...props} />)
  return { store, setLocale }
}

describe('LanguageRow', () => {
  it('shows the title and the active locale label on the selector pill', () => {
    mount('en')
    expect(screen.getByText('Language')).toBeDefined()
    /** 中文说明：测试场景的局部值 trigger，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const trigger = screen.getByRole('button', { name: /English/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the menu, selects a locale, and closes', () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = mount('en')
    /** 中文说明：测试场景的局部值 trigger，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const trigger = screen.getByRole('button', { name: /English/ })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: '中文' }))
    expect(b.setLocale).toHaveBeenCalledWith('zh')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()
  })

  it('closes on outside pointerdown without selecting', () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = mount('en')
    fireEvent.click(screen.getByRole('button', { name: /English/ }))
    expect(screen.getByRole('menuitem', { name: '中文' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: '中文' })).toBeNull()
    expect(b.setLocale).not.toHaveBeenCalled()
  })

  it('follows store changes; an unknown active id falls back to the id itself', () => {
    /** 中文说明：测试场景的局部值 b，取值由紧邻初始化决定，仅在当前作用域使用。 */
    const b = mount('en')
    act(() => { b.store.actions.sync('zh', OPTIONS, 1) })
    expect(screen.getByRole('button', { name: /中文/ })).toBeDefined()
    act(() => { b.store.actions.sync('fr', OPTIONS, 2) })
    expect(screen.getByRole('button', { name: /fr/ })).toBeDefined()
  })
})
