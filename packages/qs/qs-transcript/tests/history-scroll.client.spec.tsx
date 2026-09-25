// @vitest-environment jsdom
/** 自动分页观察器的串行、失败暂停与旧会话回调隔离。 */
import { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useHistoryScroll, type HistoryScrollInput } from '../src/client/history-scroll.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

type Input = Omit<HistoryScrollInput, 'sentinel'>

/** 仅替换几何观察，分页动作与生命周期使用真实 hook。 */
function observers() {
  const instances: FakeObserver[] = []
  class FakeObserver {
    target!: Element
    disconnect = vi.fn()
    constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
      instances.push(this)
    }
    observe(target: Element) { this.target = target }
    emit(visible: boolean) {
      this.callback(
        [{ target: this.target, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver,
      )
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return instances
}

/** 真实滚动根是哨兵的祖先，未提供根时仍保留手动入口。 */
function Harness({ input, root = true }: { input: Input; root?: boolean }) {
  const sentinel = useRef<HTMLDivElement | null>(null)
  useHistoryScroll({ ...input, sentinel })
  return <div data-qs-scroll={root ? true : undefined}><div ref={sentinel} /></div>
}

function input(): Input {
  return { sessionId: 'a', connected: true, openState: 'open',
    history: { hasMore: true, loadingOlder: false, historyLoad: { phase: 'idle' } },
    captureAnchor: vi.fn(), loadOlder: vi.fn() }
}

it('顶部进入只请求一次，加载结束后可继续填充短窗口，旧会话回调失效', () => {
  const list = observers()
  let state = input()
  const first = state
  const view = render(<Harness input={state} />)
  const old = list[0]!
  expect(old.options.root).toBe(view.container.firstElementChild)
  old.emit(false)
  expect(first.loadOlder).not.toHaveBeenCalled()
  old.emit(true); old.emit(true)
  expect(first.loadOlder).toHaveBeenCalledOnce()
  expect(first.captureAnchor).toHaveBeenCalledOnce()
  state = { ...state, history: { ...state.history, loadingOlder: true } }
  view.rerender(<Harness input={state} />)
  expect(old.disconnect).toHaveBeenCalledOnce()
  old.emit(true)
  expect(first.loadOlder).toHaveBeenCalledOnce()
  state = { ...state, history: { ...state.history, loadingOlder: false, historyLoad: {
    phase: 'succeeded', requestId: 1, connectionEpoch: 1, kind: 'older', progressed: true, hasMore: true,
  } } }
  view.rerender(<Harness input={state} />)
  const next = list.at(-1)!
  next.emit(true)
  expect(first.loadOlder).toHaveBeenCalledTimes(2)
  const other = { ...input(), sessionId: 'b' }
  view.rerender(<Harness input={other} />)
  next.emit(true)
  expect(other.loadOlder).not.toHaveBeenCalled()
  list.at(-1)!.emit(true)
  expect(other.loadOlder).toHaveBeenCalledOnce()
  view.unmount()
  list.at(-1)!.emit(true)
  expect(other.loadOlder).toHaveBeenCalledOnce()
})

it('断线、未打开、无更多、失败、取消、其他分页进行中和无进展均暂停自动触发', () => {
  const list = observers()
  const base = input()
  const changes: Partial<Input>[] = [
    { connected: false }, { openState: 'loading' },
    { history: { ...base.history, hasMore: false } },
    ...(['failed', 'cancelled', 'loading'] as const).map(phase => ({ history: {
      ...base.history, historyLoad: { phase, requestId: 1, connectionEpoch: 1, kind: 'older' as const },
    } })),
    { history: { ...base.history, historyLoad: {
      phase: 'succeeded', requestId: 1, connectionEpoch: 1, kind: 'older', progressed: false, hasMore: true,
    } } },
  ]
  for (const change of changes) {
    const view = render(<Harness input={{ ...base, ...change }} />)
    expect(list).toHaveLength(0)
    view.unmount()
  }
  const absent = render(<Harness input={base} root={false} />)
  expect(list).toHaveLength(0)
  absent.unmount()
  vi.stubGlobal('IntersectionObserver', undefined)
  render(<Harness input={base} />)
  expect(base.loadOlder).not.toHaveBeenCalled()
})
