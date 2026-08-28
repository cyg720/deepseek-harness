// @vitest-environment jsdom
/*
 * 文件职责：验证客户端渲染器的 use-projection.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
/**
 * useProjection standard-kit delivery (session-projection subsystem page:
 * docs/subsystems/session-projection.md): the fifth
 * framework hook seat rides the same provide channel as useSession — a
 * session slot component receives `useProjection` in its kit, key-addressed
 * over the binding's projection source family; unresolved keys and absent
 * sessions read `undefined`; live value changes re-render; the selector
 * overload runs over the whole value.
 */
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ScopedStandardSourceBinding, SlotRendererHost, SlotScopeAdapter, StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

type SessionBinding = ScopedStandardSourceBinding

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

/** 中文说明：类型或类 UseProjectionProp 约束模块数据或职责。 */
type UseProjectionProp = (key: string, selector?: (v: unknown) => unknown) => unknown

/** 中文说明：函数 makeHost 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeHost() {
  const scopeCtx = new Context()
  const absentBinding: StandardSourceBinding = {
    key: undefined,
    hooks: { session: undefined },
    keyedHooks: { projection: undefined },
    props: { sessionId: undefined },
  }
  const currentBinding = observable<StandardSourceBinding>(absentBinding)
  const cells = new Map<string, ReturnType<typeof observable<unknown>>>()
  /** Store-parallel source family: an unseen key snapshots undefined. */
  const absent = { getSnapshot: () => undefined, subscribe: () => () => {} }
  /** 中文说明：测试局部值 sessionEntries，由紧邻初始化决定。 */
  const sessionEntries: StoredEntry[] = []
  const bindings = new Map<string, SessionBinding>()
  const rootEntry: StoredEntry = {
    component: (props: { renderSlot: (key: string, owner: object) => React.ReactNode }) =>
      <>{props.renderSlot('k.session', {})}</>,
    options: {},
    children: { 'k.session': { kind: 'single', scope: 'session' } },
  }
  const binding = (id: string): SessionBinding => {
    const cached = bindings.get(id)
    if (cached !== undefined) return cached
    const value: SessionBinding = {
      key: id,
      ctx: scopeCtx,
      hooks: { session: { getSnapshot: () => ({ sid: id }), subscribe: () => () => {} } },
      keyedHooks: { projection: key => cells.get(key) ?? absent },
      props: { sessionId: id },
    }
    bindings.set(id, value)
    return value
  }
  const root = observable<StandardSourceBinding>({
    key: undefined,
    hooks: {},
    keyedHooks: {},
    props: {},
  })
  const sessionAdapter: SlotScopeAdapter = {
    current: currentBinding,
    resolve: binding,
    renderArea: (scopeBinding, { empty, children }) => scopeBinding.key === undefined
      ? <>{empty?.() ?? null}</>
      : <>{children}</>,
  }
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
    root,
    scopeRevision: observable(0),
    scope: () => sessionAdapter,
  }
  return {
    host,
    cells,
    // The driver publishes the resolved binding or the absent projection.
    current: {
      set: (id: string | undefined) => {
        currentBinding.set(id === undefined ? absentBinding : binding(id))
      },
    },
    registerSession: (entry: StoredEntry) => { sessionEntries.push(entry) },
  }
}

describe('useProjection standard-kit delivery', () => {
  it('reads the projected value through the kit, undefined for unresolved keys, and follows live changes', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost()
    /** 中文说明：测试局部值 cell，由紧邻初始化决定。 */
    const cell = observable<unknown>({ marks: ['a'] })
    h.cells.set('test/marks', cell)
    /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
    const reads: Record<string, unknown>[] = []
    h.registerSession({
      component: (props: { useProjection: UseProjectionProp }) => {
        reads.push({
          marks: props.useProjection('test/marks'),
          ghost: props.useProjection('test/ghost'),
        })
        return null
      },
      options: {},
    })
    h.current.set('s1')
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    expect(reads.at(-1)).toEqual({ marks: { marks: ['a'] }, ghost: undefined })
    // Live change re-renders with the new whole value.
    act(() => { cell.set({ marks: ['a', 'b'] }) })
    expect(reads.at(-1)).toEqual({ marks: { marks: ['a', 'b'] }, ghost: undefined })
  })

  it('runs the selector overload over the whole value (and over undefined when absent)', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost()
    h.cells.set('test/marks', observable<unknown>({ marks: ['x', 'y'] }))
    /** 中文说明：测试局部值 reads，由紧邻初始化决定。 */
    const reads: unknown[] = []
    h.registerSession({
      component: (props: { useProjection: UseProjectionProp }) => {
        reads.push(props.useProjection('test/marks', v => (v as { marks: string[] } | undefined)?.marks.length ?? -1))
        reads.push(props.useProjection('test/ghost', v => (v === undefined ? 'absent' : 'present')))
        return null
      },
      options: {},
    })
    h.current.set('s1')
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
    expect(reads.slice(-2)).toEqual([2, 'absent'])
  })
})
