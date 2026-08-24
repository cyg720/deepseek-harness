// @vitest-environment jsdom
/**
 * 文件职责：验证客户端渲染器的 session-provider.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
/**
 * SessionProvider behavior account (render-prop form, framework-wired):
 * empty/body branching off the host's current-session source, key={sessionId}
 * remount semantics, and cell delivery observed through a session slot's
 * standard kit — never through the internal context objects (BindingContext
 * does not leave the package).
 */
import { useEffect, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import type { SessionMaybeProvideInfo, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionProvideInfo, SlotRendererHost } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'
import { SessionProvider } from '../src/client/session-provider.tsx'

/** 中文说明：函数 observable 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function observable<T>(initial: T) {
  /** 中文说明：测试局部值 value，由紧邻初始化决定。 */
  let value = initial
  /** 中文说明：测试局部值 subs，由紧邻初始化决定。 */
  const subs = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } },
    set: (next: T) => { value = next; for (const fn of [...subs]) fn() },
  }
}

/**
 * Minimal host: SessionProvider only reads sessions.provideInfo, but it must
 * render inside the renderer tree (HostContext), so the harness mounts a real
 * root entry whose body is the test's render-prop provider.
 */
/** 中文说明：函数 makeHost 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeHost(bodies: { root: (rp: (key: string, owner: object) => React.ReactNode) => React.ReactNode }) {
  /** 中文说明：测试局部值 absentInfo，由紧邻初始化决定。 */
  const absentInfo: SessionMaybeProvideInfo = { sessionId: undefined, hooks: { session: undefined }, props: {} }
  /** 中文说明：测试局部值 provide，由紧邻初始化决定。 */
  const provide = observable<SessionMaybeProvideInfo>(absentInfo)
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let currentId: string | undefined
  /** 中文说明：测试局部值 infos，由紧邻初始化决定。 */
  const infos = new Map<string, SessionProvideInfo>()
  /** 中文说明：测试局部值 sessionEntries，由紧邻初始化决定。 */
  const sessionEntries: StoredEntry[] = []
  /** 中文说明：测试局部值 rootEntry，由紧邻初始化决定。 */
  const rootEntry: StoredEntry = {
    component: (props: { renderSlot: (key: string, owner: object) => React.ReactNode }) =>
      <>{bodies.root(props.renderSlot)}</>,
    options: {},
    children: { 'k.session': { kind: 'single', scope: 'session' } },
  }
  /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
  const host: SlotRendererHost = {
    subscribe: () => () => {},
    getVersion: () => 0,
    entriesOf: key => key === 'root' ? [rootEntry] : sessionEntries,
    // Single-kind everywhere and no crashes in this suite: the projection is
    // the raw view and crash reports never fire.
    entriesOfSlot: key => key === 'root' ? [rootEntry] : sessionEntries,
    reportEntryError: () => {},
    specOf: key => key === 'k.session' ? { kind: 'single', scope: 'session' } : undefined,
    isLive: () => true,
    storeOf: () => undefined,
    sessions: {
      list: observable<unknown>({ ids: [] }),
      provideInfo: provide,
    },
    workspaces: { list: observable<unknown>({ items: [] }) },
  }
  return {
    host,
    // Driver surface: set(id) publishes the resolved bundle (or the absent
    // projection) through the provide source.
    current: {
      set: (id: string | undefined) => {
        currentId = id
        provide.set((id === undefined ? undefined : infos.get(id)) ?? absentInfo)
      },
    },
    addSession: (id: string) => {
      // Bare source per bundle (identity-stable): the machinery binds useSession from it.
      /** 中文说明：测试局部值 info，由紧邻初始化决定。 */
      const info: SessionProvideInfo = {
        sessionId: id,
        hooks: { session: { getSnapshot: () => ({ sid: id }), subscribe: () => () => {} } },
        props: {},
      }
      infos.set(id, info)
      if (currentId === id) provide.set(info)
      return info
    },
    /** Swap one session's bundle in place (roster-change stand-in); republish when current. */
    replaceSession: (info: SessionProvideInfo) => {
      infos.set(info.sessionId, info)
      if (currentId === info.sessionId) provide.set(info)
    },
    registerSession: (entry: StoredEntry) => { sessionEntries.push(entry) },
  }
}

describe('SessionProvider', () => {
  it('renders empty without a current session, switches to the body on select, falls back on an unresolvable id', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost({
      root: () => (
        <SessionProvider empty={() => <span>empty</span>}>
          {id => <div data-testid="body">{id}</div>}
        </SessionProvider>
      ),
    })
    h.addSession('s1')
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    expect(view.container.textContent).toBe('empty')
    act(() => { h.current.set('s1') })
    expect(view.container.textContent).toBe('s1')
    act(() => { h.current.set('ghost') })   // listed nowhere: cell() misses
    expect(view.container.textContent).toBe('empty')
  })

  it('renders null empty state when the empty prop is omitted', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost({
      root: () => <SessionProvider>{id => <b>{id}</b>}</SessionProvider>,
    })
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    expect(view.container.textContent).toBe('')
  })

  it('remounts the body on session switch (key semantics) but not on unrelated re-renders', () => {
    /** 中文说明：测试局部值 mounts，由紧邻初始化决定。 */
    let mounts = 0
    /** 中文说明：函数 Body 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
    function Body({ id }: { id: string }) {
      /** 中文说明：测试局部值 mounted，由紧邻初始化决定。 */
      const mounted = useRef(false)
      useEffect(() => {
        /* v8 ignore next -- strict-mode double-invoke guard, not a branch under test */
        if (!mounted.current) { mounted.current = true; mounts += 1 }
      }, [])
      return <div>{id}</div>
    }
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost({
      root: () => <SessionProvider>{id => <Body id={id} />}</SessionProvider>,
    })
    h.addSession('s1')
    h.addSession('s2')
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    /** 中文说明：测试局部值 afterS1，由紧邻初始化决定。 */
    const afterS1 = mounts
    act(() => { h.current.set('s2') })
    expect(mounts).toBe(afterS1 + 1)
    /** 中文说明：测试局部值 afterS2，由紧邻初始化决定。 */
    const afterS2 = mounts
    view.rerender(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    expect(mounts).toBe(afterS2)
  })

  it('delivers the resolved cell to session slots under it (observable behavior, not context internals)', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: Record<string, unknown>[] = []
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost({
      root: renderSlot => <SessionProvider>{() => renderSlot('k.session', {})}</SessionProvider>,
    })
    h.addSession('s1')
    h.addSession('s2')
    h.registerSession({
      component: (props: { useSession?: <S>(sel: (s: { sid: string }) => S) => S; sessionId?: string }) => {
        // The bound hook reads the cell's bare source — asserting through it
        // proves the machinery wired THIS session's source, not another's.
        seen.push({ sessionId: props.sessionId, read: props.useSession!(s => s.sid) })
        return null
      },
      options: {},
    })
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    expect(seen.at(-1)!['read']).toBe('s1')
    expect(seen.at(-1)!['sessionId']).toBe('s1')
    act(() => { h.current.set('s2') })
    expect(seen.at(-1)!['read']).toBe('s2')
    expect(seen.at(-1)!['sessionId']).toBe('s2')
  })

  it('republishes a mounted session entry when its provide bundle changes under the same id', () => {
    /** 中文说明：测试局部值 seen，由紧邻初始化决定。 */
    const seen: unknown[] = []
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost({
      root: renderSlot => <SessionProvider>{() => renderSlot('k.session', {})}</SessionProvider>,
    })
    /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
    const original = h.addSession('s1')
    h.registerSession({
      component: (props: { feature?: string }) => {
        seen.push(props.feature)
        return null
      },
      options: {},
    })
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    act(() => { h.current.set('s1') })
    expect(seen.at(-1)).toBeUndefined()
    // A provider-roster change rematerializes the bundle; the provide source
    // must carry it to already-mounted entries without a selection change.
    act(() => { h.replaceSession({ ...original, props: { feature: 'now-live' } }) })
    expect(seen.at(-1)).toBe('now-live')
  })

  it('fails loud when mounted outside the renderer tree (no host channel)', () => {
    /** 中文说明：测试局部值 spy，由紧邻初始化决定。 */
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(
      <SessionProvider>{id => <b>{id}</b>}</SessionProvider>,
    )).toThrow(/outside the installed renderer tree/)
    spy.mockRestore()
  })
})
