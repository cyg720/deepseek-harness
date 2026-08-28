// @vitest-environment jsdom
/*
 * 文件职责：验证客户端渲染器的 scoped-slots-real-core.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止客户端渲染器的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
/**
 * Integration against the real ui-slots SlotCore through a passthrough host:
 * registrations go through the real register() (options form, children
 * declaration), and the outlets ride the real subscribe/getVersion/entries/
 * isLive APIs — microtask-batched notifications, mutation-stable entry
 * references (the cache axis), and ledger-fed stale bindings are the
 * real-core semantics the fake-host suite cannot vouch for.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import {
  SlotCore, StaleAuthorizationError, type PropsRenderSlots, type SlotRendererHost,
  type SlotScopeAdapter, type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：类型或类 SlotMap 约束模块数据或职责。 */
  interface SlotMap {
    // No 'root' merge: the aggregate client program already carries runtime's
    // authoritative 'root' declaration (a private merge would TS2717-collide);
    // only this suite's own test keys merge here.
    'spec.single': { kind: 'single'; scope: 'root'; owner: { label?: string } }
    'spec.list': { kind: 'list'; scope: 'root' }
  }
}

/** 中文说明：类型或类 FrameSlots 约束模块数据或职责。 */
type FrameSlots = PropsRenderSlots<'spec.single' | 'spec.list'>

/** Passthrough host over the real core (store/session seats unused here). */
/* 中文说明：函数 hostOver 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function hostOver(core: SlotCore): SlotRendererHost {
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
  return {
    subscribe: (key, fn) => core.subscribe(key, fn),
    getVersion: key => core.getVersion(key),
    entriesOf: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => { core.reportEntryError(key, entry, error, info) },
    specOf: key => core.specDynamic(key),
    isLive: entry => core.isLive(entry),
    storeOf: () => undefined,
    root: bindingSource,
    scopeRevision: { getSnapshot: () => 0, subscribe: () => () => {} },
    scope: () => sessionAdapter,
  }
}

/** Register the root frame (declaring both child keys) and mount the renderer. */
/* 中文说明：函数 mountFrame 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function mountFrame(core: SlotCore, body: (renderSlot: FrameSlots['renderSlot']) => React.ReactNode) {
  /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
  const dispose = core.register({
    name: 'root',
    children: {
      'spec.single': { kind: 'single', scope: 'root' },
      'spec.list': { kind: 'list', scope: 'root' },
    },
  }, (props: FrameSlots) => <>{body(props.renderSlot)}</>)
  /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
  const view = render(<>{createSlotRenderer().renderRoot(hostOver(core), {})}</>)
  return { view, dispose }
}

describe('createSlotRenderer over the real SlotCore', () => {
  it('renders registrations live through real microtask batching: register, dispose back to fallback', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 { view }，由紧邻初始化决定。 */
    const { view } = mountFrame(core, renderSlot =>
      renderSlot('spec.single', {}, { fallback: <i>none</i> }))
    expect(view.container.textContent).toBe('none')
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    let dispose = () => {}
    // The real core batches subscriber notification per microtask: async act.
    await act(async () => {
      dispose = core.register({ name: 'spec.single' }, ({ label }: { label?: string }) => <b>{label ?? 'on'}</b>)
    })
    expect(view.container.textContent).toBe('on')
    await act(async () => { dispose(); dispose() })   // disposer is idempotent in the real core
    expect(view.container.textContent).toBe('none')
  })

  it('coalesces same-tick mutations into one notification (uSES pairing stays consistent)', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    const notified = vi.fn()
    core.subscribe('spec.list', notified)
    /** 中文说明：测试局部值 { view }，由紧邻初始化决定。 */
    const { view } = mountFrame(core, renderSlot => renderSlot('spec.list', {}))
    await act(async () => {
      core.register({ name: 'spec.list', id: 'two', order: 2 }, () => <span>2</span>)
      core.register({ name: 'spec.list', id: 'one', order: 1 }, () => <span>1</span>)
    })
    expect(notified).toHaveBeenCalledTimes(1)   // two same-tick mutations, one batch
    expect(view.container.textContent).toBe('12')
  })

  it('passes owner props through and keeps sibling entries() references stable across mutations', async () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'spec.single': { kind: 'single', scope: 'root' },
      'spec.list': { kind: 'list', scope: 'root' },
    } }, (props: FrameSlots) => <>
      {props.renderSlot('spec.single', { label: 'owner' })}
      {props.renderSlot('spec.list', {})}
    </>)
    core.register({ name: 'spec.single' }, ({ label }: { label?: string }) => <b>{label}</b>)
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<>{createSlotRenderer().renderRoot(hostOver(core), {})}</>)
    expect(view.container.textContent).toBe('owner')
    // A mutation on the sibling key leaves this key's entries() reference
    // untouched (real-core stability the inject/renderSlot caches key on).
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = core.entries('spec.single')
    await act(async () => { core.register({ name: 'spec.list', id: 'l' }, () => <span>L</span>) })
    expect(core.entries('spec.single')).toBe(before)
    expect(view.container.textContent).toBe('ownerL')
  })

  it('feeds stale bindings from the real ledger: a disposed registration throws off isLive', () => {
    /** 中文说明：测试局部值 core，由紧邻初始化决定。 */
    const core = new SlotCore()
    /** 中文说明：测试局部值 解构结果，由紧邻初始化决定。 */
    let captured: FrameSlots['renderSlot'] | undefined
    /** 中文说明：测试局部值 { view, dispose }，由紧邻初始化决定。 */
    const { view, dispose } = mountFrame(core, (renderSlot) => {
      captured = renderSlot
      return null
    })
    expect(captured!('spec.single', {})).not.toBeUndefined()   // live binding renders
    // Unmount before disposing: an empty 'root' makes a LIVE root outlet
    // rethrow boot-order (covered in the fake-host suite); the scenario here
    // is a retained closure outliving both tree and registration.
    view.unmount()
    dispose()
    expect(() => captured!('spec.single', {})).toThrow(StaleAuthorizationError)
  })
})
