// @vitest-environment jsdom
/**
 * 文件职责：验证客户端渲染器的 bind.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { bindSnapshotSelector } from '../src/client/bind.ts'
import type { HostObservable as ObservableSnapshot, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

// Keep equality local: this suite asserts the eq parameter contract without
// adding a reverse dependency from the UI renderer to runtime.
/** 中文说明：测试局部值 shallowEqual，由紧邻初始化决定。 */
const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.is(a[k], b[k]))

/** 中文说明：类型或类 Snap 约束模块数据或职责。 */
interface Snap { a: number; b: number }

/** Hand-rolled observable source so subscription counting is exact. */
/** 中文说明：函数 makeSource 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeSource(initial: Snap) {
  /** 中文说明：测试局部值 state，由紧邻初始化决定。 */
  let state = initial
  /** 中文说明：测试局部值 listeners，由紧邻初始化决定。 */
  const listeners = new Set<() => void>()
  /** 中文说明：测试局部值 subscribeCalls，由紧邻初始化决定。 */
  let subscribeCalls = 0
  /** 中文说明：测试局部值 source，由紧邻初始化决定。 */
  const source: ObservableSnapshot<Snap> = {
    getSnapshot: () => state,
    subscribe: (fn) => {
      subscribeCalls += 1
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
  }
  return {
    source,
    set: (next: Snap) => {
      state = next
      /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
      for (const fn of [...listeners]) fn()
    },
    stats: { get subscribeCalls() { return subscribeCalls }, get active() { return listeners.size } },
  }
}

/** 中文说明：函数 Harness 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function Harness<S>({ useSelector, sel, eq, probe }: {
  useSelector: SnapshotSelectorHook<Snap>
  sel: (s: Snap) => S
  eq?: (a: S, b: S) => boolean
  probe: { renders: number; value?: S | undefined }
}) {
  probe.renders += 1
  probe.value = useSelector(sel, eq)
  return null
}

describe('bindSnapshotSelector', () => {
  it('re-renders on selected change and bails out when the slice is equal', () => {
    /** 中文说明：测试局部值 { source, set }，由紧邻初始化决定。 */
    const { source, set } = makeSource({ a: 1, b: 10 })
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(source)
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as number | undefined }
    render(<Harness useSelector={useSelector} sel={s => s.a} probe={probe} />)
    expect(probe.value).toBe(1)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = probe.renders
    act(() => { set({ a: 1, b: 11 }) })   // unrelated field: Object.is bail
    expect(probe.renders).toBe(before)
    act(() => { set({ a: 2, b: 11 }) })
    expect(probe.renders).toBe(before + 1)
    expect(probe.value).toBe(2)
  })

  it('supports custom equality for object slices', () => {
    /** 中文说明：测试局部值 { source, set }，由紧邻初始化决定。 */
    const { source, set } = makeSource({ a: 1, b: 10 })
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(source)
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as { a: number } | undefined }
    render(<Harness useSelector={useSelector} sel={s => ({ a: s.a })} eq={shallowEqual} probe={probe} />)
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = probe.renders
    act(() => { set({ a: 1, b: 99 }) })   // fresh object, shallow-equal slice
    expect(probe.renders).toBe(before)
    act(() => { set({ a: 5, b: 99 }) })
    expect(probe.renders).toBe(before + 1)
    expect(probe.value).toEqual({ a: 5 })
  })

  it('does not resubscribe across re-renders of the same component', () => {
    /** 中文说明：测试局部值 { source, set, stats }，由紧邻初始化决定。 */
    const { source, set, stats } = makeSource({ a: 1, b: 10 })
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(source)
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as number | undefined }
    /** 中文说明：测试局部值 { rerender }，由紧邻初始化决定。 */
    const { rerender } = render(<Harness useSelector={useSelector} sel={s => s.a} probe={probe} />)
    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = stats.subscribeCalls
    rerender(<Harness useSelector={useSelector} sel={s => s.a} probe={probe} />)
    act(() => { set({ a: 2, b: 10 }) })
    rerender(<Harness useSelector={useSelector} sel={s => s.a} probe={probe} />)
    expect(stats.subscribeCalls).toBe(after)
  })

  it('is StrictMode-safe and cleans up subscriptions on unmount', () => {
    /** 中文说明：测试局部值 { source, stats }，由紧邻初始化决定。 */
    const { source, stats } = makeSource({ a: 1, b: 10 })
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(source)
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as number | undefined }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <StrictMode>
        <Harness useSelector={useSelector} sel={s => s.a} probe={probe} />
      </StrictMode>,
    )
    expect(probe.value).toBe(1)
    view.unmount()
    expect(stats.active).toBe(0)
  })

  it('binds method-style sources without losing this', () => {
    /** 中文说明：类型或类 MethodSource 约束模块数据或职责。 */
    class MethodSource implements ObservableSnapshot<Snap> {
      private state: Snap = { a: 7, b: 0 }
      private listeners = new Set<() => void>()
      getSnapshot(): Snap { return this.state }
      subscribe(fn: () => void): () => void {
        this.listeners.add(fn)
        return () => { this.listeners.delete(fn) }
      }
    }
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(new MethodSource())
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as number | undefined }
    render(<Harness useSelector={useSelector} sel={s => s.a} probe={probe} />)
    expect(probe.value).toBe(7)
  })

  it('memoizes the selector result against getSnapshot spam', () => {
    /** 中文说明：测试局部值 { source }，由紧邻初始化决定。 */
    const { source } = makeSource({ a: 1, b: 10 })
    /** 中文说明：测试局部值 sel，由紧邻初始化决定。 */
    const sel = vi.fn((s: Snap) => s.a)
    /** 中文说明：测试局部值 useSelector，由紧邻初始化决定。 */
    const useSelector = bindSnapshotSelector(source)
    /** 中文说明：测试局部值 probe，由紧邻初始化决定。 */
    const probe = { renders: 0, value: undefined as number | undefined }
    /** 中文说明：测试局部值 { rerender }，由紧邻初始化决定。 */
    const { rerender } = render(<Harness useSelector={useSelector} sel={sel} probe={probe} />)
    /** 中文说明：测试局部值 calls，由紧邻初始化决定。 */
    const calls = sel.mock.calls.length
    rerender(<Harness useSelector={useSelector} sel={sel} probe={probe} />)
    // Same snapshot + same selector reference: no recompute beyond bookkeeping.
    expect(sel.mock.calls.length).toBeLessThanOrEqual(calls + 1)
  })
})
