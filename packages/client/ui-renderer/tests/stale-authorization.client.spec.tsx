// @vitest-environment jsdom
/**
 * 文件职责：验证客户端渲染器的 stale-authorization.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
/**
 * A retained render binding dies with its entry. Re-registering the same key
 * creates a new binding rather than reviving the stale closure.
 */
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  StaleAuthorizationError, type SlotEntryDef, type SlotSpec, type StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RenderOpts, SlotRendererHost, SlotScopeAdapter, StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

/** 中文说明：类型或类 RenderSlotFn 约束模块数据或职责。 */
type RenderSlotFn = (key: string, owner: object, opts?: RenderOpts) => ReactNode
/** 中文说明：类型或类 DeclaredSpec 约束模块数据或职责。 */
type DeclaredSpec = SlotSpec<SlotEntryDef>

/** Ledger-shaped fake: add/dispose maintain the live set the way the runtime ledger does. */
/* 中文说明：函数 makeHost 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function makeHost() {
  /** 中文说明：测试局部值 entries，由紧邻初始化决定。 */
  const entries = new Map<string, StoredEntry[]>()
  /** 中文说明：测试局部值 versions，由紧邻初始化决定。 */
  const versions = new Map<string, number>()
  /** 中文说明：测试局部值 subs，由紧邻初始化决定。 */
  const subs = new Map<string, Set<() => void>>()
  /** 中文说明：测试局部值 live，由紧邻初始化决定。 */
  const live = new Set<StoredEntry>()
  const absentBinding: StandardSourceBinding = {
    key: undefined,
    hooks: {},
    keyedHooks: {},
    props: {},
  }
  const bindingSource = {
    getSnapshot: () => absentBinding,
    subscribe: () => () => {},
  }
  const sessionAdapter: SlotScopeAdapter = {
    current: bindingSource,
    resolve: () => undefined,
  }
  const bump = (key: string) => {
    versions.set(key, (versions.get(key) ?? 0) + 1)
    /** 中文说明：测试局部值 fn，由紧邻初始化决定。 */
    for (const fn of [...(subs.get(key) ?? [])]) fn()
  }
  /** 中文说明：测试局部值 host，由紧邻初始化决定。 */
  const host: SlotRendererHost = {
    subscribe: (key, fn) => {
      /** 中文说明：测试局部值 set，由紧邻初始化决定。 */
      const set = subs.get(key) ?? new Set()
      set.add(fn)
      subs.set(key, set)
      return () => { set.delete(fn) }
    },
    getVersion: key => versions.get(key) ?? 0,
    entriesOf: key => entries.get(key) ?? [],
    // Single-kind everywhere and no crashes in this suite: the projection is
    // the raw view and crash reports never fire.
    entriesOfSlot: key => entries.get(key) ?? [],
    reportEntryError: () => {},
    specOf: () => ({ kind: 'single', scope: 'root' }),
    isLive: entry => live.has(entry),
    storeOf: () => undefined,
    root: bindingSource,
    scopeRevision: { getSnapshot: () => 0, subscribe: () => () => {} },
    scope: () => sessionAdapter,
  }
  return {
    host,
    add: (key: string, entry: StoredEntry) => {
      entries.set(key, [...(entries.get(key) ?? []), entry])
      live.add(entry)
      bump(key)
      return () => {
        entries.set(key, (entries.get(key) ?? []).filter(e => e !== entry))
        live.delete(entry)
        bump(key)
      }
    },
  }
}

/** 中文说明：测试局部值 CHILD，由紧邻初始化决定。 */
const CHILD: DeclaredSpec = { kind: 'single', scope: 'root' }

/**
 * Mount a root entry that leaks its binding to the test, then render. The
 * returned dispose unmounts the view FIRST: an empty 'root' makes the live
 * root outlet rethrow its boot-order failure (fail-loud, covered in the
 * scoped-slots suite); the retained-closure scenario under test here is a
 * dead entry whose binding outlives the tree.
 */
/* 中文说明：函数 mountCapturing 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mountCapturing(h: ReturnType<typeof makeHost>) {
  /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
  let captured: RenderSlotFn | undefined
  /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
  const entry: StoredEntry = {
    component: (props: { renderSlot: RenderSlotFn }) => {
      captured = props.renderSlot
      return null
    },
    options: {},
    children: { 'k.child': CHILD },
  }
  /** 中文说明：测试局部值 disposeEntry，由紧邻初始化决定。 */
  const disposeEntry = h.add('root', entry)
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)
  return {
    binding: captured!,
    entry,
    dispose: () => {
      view.unmount()
      disposeEntry()
    },
  }
}

describe('stale authorization', () => {
  it('a live binding renders; the same closure throws after its entry is disposed', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost()
    /** 中文说明：测试局部值 { binding, dispose }，由紧邻初始化决定。 */
    const { binding, dispose } = mountCapturing(h)
    expect(binding('k.child', {})).not.toBeUndefined()   // live: returns an element
    act(() => { dispose() })
    expect(() => binding('k.child', {})).toThrow(StaleAuthorizationError)
    expect(() => binding('k.child', {})).toThrow(/disposed registration/)
  })

  it('stale check precedes the ownership check: a dead binding throws stale even for undeclared keys', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost()
    /** 中文说明：测试局部值 { binding, dispose }，由紧邻初始化决定。 */
    const { binding, dispose } = mountCapturing(h)
    act(() => { dispose() })
    // Were ownership checked first this would be SlotOwnershipError; the dead
    // entry must fail on liveness regardless of the key asked for.
    expect(() => binding('k.undeclared', {})).toThrow(StaleAuthorizationError)
  })

  it('HMR reload (same key, new entry) mints a fresh binding; the old one stays dead', () => {
    /** 中文说明：测试局部值 h，由紧邻初始化决定。 */
    const h = makeHost()
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = mountCapturing(h)
    act(() => { first.dispose() })

    // Reload: a new entry object for the same slot key (new registration identity).
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let secondBinding: RenderSlotFn | undefined
    /** 中文说明：测试局部值 secondEntry，由紧邻初始化决定。 */
    const secondEntry: StoredEntry = {
      component: (props: { renderSlot: RenderSlotFn }) => {
        secondBinding = props.renderSlot
        return null
      },
      options: {},
      children: { 'k.child': CHILD },
    }
    h.add('root', secondEntry)
    render(<>{createSlotRenderer().renderRoot(h.host, {})}</>)

    expect(secondBinding).toBeDefined()
    expect(secondBinding).not.toBe(first.binding)          // new identity, no revival
    expect(secondBinding!('k.child', {})).not.toBeUndefined()   // new binding is live
    expect(() => first.binding('k.child', {})).toThrow(StaleAuthorizationError)   // old stays dead
  })
})
