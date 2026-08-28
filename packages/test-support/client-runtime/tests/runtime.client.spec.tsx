// @vitest-environment jsdom
/**
 * 文件职责：验证 runtime.client.spec.tsx 覆盖的客户端运行时测试支持行为与测试协作。
 * 技术维度：使用 TypeScript、Vitest、Cordis 插件、快照、模拟服务器或类型生成。
 * 产品维度：通过可复现的客户端运行时测试支持能力保障 Agent 功能在集成层稳定。
 * 逻辑维度：准备夹具或输入，执行装载/生成/调用流程，再规范化并核对结果。
 * 关键边界：夹具必须确定且跨平台；模型可见状态应可重放；临时资源必须释放。
 * 新手阅读建议：先看导出类型和夹具，再读主流程，最后关注规范化、失败和清理。
 */
/**
 * SlotTestRuntime behavior: root declaration + rendering, session
 * add/update/switch/remove through the real renderer, shared store identity
 * and scope pruning, feature mount/dispose cascade, and runtime disposal
 * idempotence. All through the production SlotRegistry + createSlotRenderer
 * stack — this suite is the fixture the migrated feature specs rely on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '../src/settings-scope.ts'
import { cleanup } from '@testing-library/react'
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 中文说明：interface SlotMap 定义本测试所需的数据或行为，用于表达客户端运行时测试支持场景。 */
  interface SlotMap {
    'trt.panel': { kind: 'single'; scope: 'root'; owner: { label?: string } }
    'trt.chat': { kind: 'single'; scope: 'session' }
    'trt.rows': { kind: 'list'; scope: 'root' }
    'trt.rows.hole': { kind: 'single'; scope: 'root' }
  }
}

afterEach(cleanup)

/** 中文说明：type FrameProps 定义本测试所需的数据或行为，用于表达客户端运行时测试支持场景。 */
type FrameProps = PropsRenderSlots<'trt.panel' | 'trt.chat' | 'trt.rows'>

/** Root frame declaring all three suite slots (render sites for each kind). */
/* 中文说明：函数 Frame 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
function Frame({ renderSlot, SessionProvider }: FrameProps) {
  return (
    <>
      {renderSlot('trt.panel', { label: 'from-owner' }, { fallback: <i>no panel</i> })}
      <SessionProvider empty={() => <i>no session</i>}>
        {renderSlot('trt.chat', {})}
      </SessionProvider>
      {renderSlot('trt.rows', {})}
    </>
  )
}

/** 中文说明：常量 CHILDREN 保存本测试共享的固定值；取值依据紧邻初始化，使用时不要修改。 */
const CHILDREN = {
  'trt.panel': { kind: 'single', scope: 'root' },
  'trt.chat': { kind: 'single', scope: 'session' },
  'trt.rows': { kind: 'list', scope: 'root' },
} as const

/** 中文说明：函数 runtimeWithFrame 承担本测试的处理步骤；参数按签名传入，返回值供后续流程使用；示例见本文件调用。 */
async function runtimeWithFrame() {
  /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
  const runtime = await SlotTestRuntime.create()
  await runtime.root.declare(CHILDREN, Frame)
  return runtime
}

describe('root declaration and rendering', () => {
  it('renders declared slots through the real renderer: fallback, then a live registration, then unload', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('no panel')

    /** 中文说明：函数值 dispose 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    let dispose = (): void => {}
    await runtime.flush() // no-op guard: flush outside mutations is safe
    await (async () => {
      dispose = runtime.slots.register(
        { name: 'trt.panel' },
        ({ label }: { label?: string }) => <b>panel:{label}</b>)
      await runtime.flush()
    })()
    expect(view.container.textContent).toContain('panel:from-owner')
    dispose()
    await runtime.flush()
    expect(view.container.textContent).toContain('no panel')
    await runtime.dispose()
  })

  it('fails loud when rendering with no root declaration (production boot-order check)', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    expect(() => runtime.renderRoot()).toThrow(/'root' has no registration/)
    await runtime.dispose()
  })
})

describe('sessions', () => {
  it('drives SessionProvider: empty state, current session, switch, live snapshot updates', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.chat' }, (props: SessionStandardProps) => {
      /** 中文说明：函数值 running 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
      const running = props.useSession(s => s.running)
      return <span>chat:{props.sessionId}:{String(running)}</span>
    })
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('no session')

    await runtime.sessions.add({ id: 's1' })
    expect(view.container.textContent).toContain('chat:s1:false')

    await runtime.sessions.updateSessionSnapshot('s1', (draft) => { draft.running = true })
    expect(view.container.textContent).toContain('chat:s1:true')

    await runtime.sessions.add({ id: 's2' }) // becomes current by default
    expect(view.container.textContent).toContain('chat:s2:false')

    await runtime.sessions.setCurrent(undefined)
    expect(view.container.textContent).toContain('no session')
    await runtime.sessions.setCurrent('s1')
    expect(view.container.textContent).toContain('chat:s1:true')
    await runtime.dispose()
  })

  it('add with current:false keeps the selection; unknown ids fail loud on the mutators', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' }, { current: false })
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    expect(runtime.sessions.list.getSnapshot().ids).toEqual(['s1', 's2'])
    await expect(runtime.sessions.add({ id: 's1' })).rejects.toThrow(/already added/)
    await expect(runtime.sessions.setCurrent('ghost')).rejects.toThrow(/not added/)
    await expect(runtime.sessions.updateSessionSnapshot('ghost', () => {})).rejects.toThrow(/not added/)
    await expect(runtime.sessions.remove('ghost')).rejects.toThrow(/not added/)
    expect(() => runtime.sessions.behavior('ghost')).toThrow(/not added/)
    await runtime.dispose()
  })

  it('mints REAL-tag scopes lazily and resolves them through the production scopeOf; bindings expose the behavior face', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    /** 中文说明：变量 prompt 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const prompt = vi.fn()
    await runtime.sessions.add({ id: 's1', session: { prompt } })

    expect(runtime.sessions.scope('ghost')).toBeUndefined()
    expect(runtime.sessions.binding('ghost')).toBeUndefined()

    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = runtime.sessions.scope('s1')!
    expect(runtime.sessions.scope('s1')).toBe(scope) // stable per session
    expect(runtime.sessions.scopeOf(scope)).toBe('s1')
    expect(runtime.sessions.scopeOf(runtime.ctx)).toBeUndefined()
    // sessionOf resolves the behavior face off the scope tag.
    expect(runtime.sessions.sessionOf(scope)).toBe(runtime.sessions.behavior('s1'))
    expect(runtime.sessions.sessionOf(runtime.ctx)).toBeUndefined()

    /** 中文说明：变量 binding 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const binding = runtime.sessions.binding('s1')!
    expect(binding.sessionId).toBe('s1')
    expect(binding.ctx).toBe(scope)
    await binding.session.prompt([], 'queue')
    expect(prompt).toHaveBeenCalledOnce()
    expect(runtime.sessions.behavior('s1')).toBe(binding.session)
    expect(binding.session.getSnapshot().sessionId).toBe('s1')

    // A scoped service resolves through the scope ctx (scope-addressed pattern).
    runtime.ctx.provide('probe', { hello: 'world' })
    expect(scope.get('probe')).toEqual({ hello: 'world' })
    await runtime.dispose()
  })

  it('records service-face calls and retains catalog addresses only for addressed selection', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' })
    /** 中文说明：变量 address 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const address = {
      parentSessionId: 's2' as SessionId,
      childSessionId: 's1' as SessionId,
      mode: 'continuable' as const,
    }
    runtime.sessions.openSubagent(address)
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot()).toMatchObject({ current: 's1', currentAddress: address })
    expect(runtime.sessions.subagentAddress('s1' as SessionId)).toEqual(address)
    expect(runtime.sessions.subagentAddress('s2' as SessionId)).toBeUndefined()
    await runtime.sessions.updateSummary('s1', { displayTitle: 'renamed', running: true })
    expect(runtime.sessions.list.getSnapshot().byId['s1' as SessionId])
      .toMatchObject({ displayTitle: 'renamed', running: true })
    runtime.sessions.setSubagentCatalogOpen('s2' as SessionId, true)
    await runtime.sessions.refreshSubagents('s2' as SessionId)
    runtime.sessions.open('s1' as SessionId)
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    expect(runtime.sessions.list.getSnapshot().currentAddress).toBeUndefined()
    runtime.sessions.clear()
    await runtime.flush()
    expect(runtime.sessions.list.getSnapshot().current).toBeUndefined()
    await expect(runtime.sessions.fork({
      sessionId: 's1' as SessionId, atSeq: 7, increaseTitle: true,
    })).resolves.toBe('s1')
    expect(runtime.sessions.calls).toEqual([
      { method: 'openSubagent', args: [address] },
      { method: 'setSubagentCatalogOpen', args: ['s2', true] },
      { method: 'refreshSubagents', args: ['s2'] },
      { method: 'open', args: ['s1'] },
      { method: 'clear', args: [] },
      { method: 'fork', args: [{ sessionId: 's1', atSeq: 7, increaseTitle: true }] },
    ])
    await runtime.dispose()
  })

  it('answers search with an empty page until a scenario declares hits, recording every call', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    /** 中文说明：变量 signal 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const signal = new AbortController().signal
    expect(runtime.sessions.searchResultLimit).toBeGreaterThan(0)
    await expect(runtime.sessions.search('marker', signal))
      .resolves.toEqual({ ok: true, value: { items: [], hasMore: false } })
    runtime.sessions.stubSearch(query => ({
      items: [{ sessionId: 's1' as SessionId, snippet: `hit: ${query}` }],
      hasMore: true,
    }))
    await expect(runtime.sessions.search('marker', signal)).resolves.toEqual({
      ok: true,
      value: { items: [{ sessionId: 's1', snippet: 'hit: marker' }], hasMore: true },
    })
    expect(runtime.sessions.calls).toEqual([
      { method: 'search', args: ['marker', signal] },
      { method: 'search', args: ['marker', signal] },
    ])
    await runtime.dispose()
  })
})

describe('stores', () => {
  /** 中文说明：函数值 createSuiteStore 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
  const createSuiteStore = () => defineStore({
    init: () => ({ note: '' }),
    persist: 'trt.store',
    actions: { setNote: (d, note: string) => { d.note = note } },
  })

  it('resolves per-session instances via the host face: shared identity, isolation, action-driven re-render', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = createSuiteStore()
    runtime.slots.register(
      { name: 'trt.chat', store: handle },
      (props: SessionStandardProps & { useStore: <S>(sel: (s: { note: string }) => S) => S }) =>
        <span>note:{props.useStore(s => s.note)}</span>)
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    await runtime.sessions.add({ id: 's1' })

    expect(() => runtime.storeOf('trt.panel')).toThrow(/no registration/)
    /** 中文说明：变量 store 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const store = runtime.storeOf('trt.chat', 's1')
    await runtime.flush()
    ;(store.actions['setNote'] as (note: string) => void)('hello')
    await runtime.flush()
    expect(view.container.textContent).toContain('note:hello')
    expect(runtime.storeOf('trt.chat', 's1')).toBe(store) // cached per scope key

    await runtime.sessions.add({ id: 's2' })
    /** 中文说明：变量 other 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const other = runtime.storeOf('trt.chat', 's2')
    expect(other).not.toBe(store)
    expect(other.getSnapshot()).toEqual({ note: '' })
    await runtime.dispose()
  })

  it('storeOf guards: before renderRoot, and for storeless entries', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.panel' }, () => null)
    runtime.slots.register({ name: 'trt.chat', store: createSuiteStore() }, () => null)
    expect(() => runtime.storeOf('trt.panel')).toThrow(/before renderRoot/)
    runtime.renderRoot()
    expect(() => runtime.storeOf('trt.panel')).toThrow(/declares no store/)
    expect(() => runtime.storeOf('trt.chat', 'missing')).toThrow(/no live Session binding/)
    await runtime.dispose()
  })

  it('remove() prunes the session store scope: persisted state clears, a re-added session starts fresh', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    /** 中文说明：变量 handle 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const handle = createSuiteStore()
    runtime.slots.register({ name: 'trt.chat', store: handle }, () => null)
    runtime.renderRoot()
    await runtime.sessions.add({ id: 's1' })

    /** 中文说明：变量 doomed 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const doomed = runtime.storeOf('trt.chat', 's1')
    ;(doomed.actions['setNote'] as (note: string) => void)('buried')
    expect(localStorage.getItem('trt.store.s1')).not.toBeNull()

    await runtime.sessions.remove('s1')
    expect(localStorage.getItem('trt.store.s1')).toBeNull()
    expect(runtime.sessions.list.getSnapshot().ids).toEqual([])
    expect(runtime.sessions.binding('s1')).toBeUndefined()

    await runtime.sessions.add({ id: 's1' })
    /** 中文说明：变量 reborn 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const reborn = runtime.storeOf('trt.chat', 's1')
    expect(reborn).not.toBe(doomed)
    expect(reborn.getSnapshot()).toEqual({ note: '' })
    await runtime.dispose()
  })

  it('remove() also disposes a minted scope fiber; removing a non-current session keeps the selection', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    await runtime.sessions.add({ id: 's1' })
    await runtime.sessions.add({ id: 's2' }, { current: false })
    /** 中文说明：变量 scope 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const scope = runtime.sessions.scope('s1')!
    await runtime.sessions.remove('s2')
    expect(runtime.sessions.list.getSnapshot().current).toBe('s1')
    await runtime.sessions.remove('s1')
    expect(scope.fiber.uid).toBeNull() // disposed fiber loses its uid
    expect(runtime.sessions.list.getSnapshot().current).toBeUndefined()
    await runtime.dispose()
  })
})

describe('workspaces', () => {
  it('feeds the renderer root source from the Workspace Controller snapshot', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register(
      { name: 'trt.panel' },
      (props: { useWorkspaces: <S>(sel: (s: { phase: string }) => S) => S }) =>
        <span>ws:{props.useWorkspaces(s => s.phase)}</span>)
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('ws:ready')

    await runtime.workspaces.update((draft) => { draft.phase = 'pending' })
    expect(view.container.textContent).toContain('ws:pending')
    await runtime.dispose()
  })
})

describe('feature mount and disposal', () => {
  it('mounts a plugin on a real fiber; dispose() cascades entries, declared children, and services', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    runtime.ctx.provide('layout', { openDetails: vi.fn() })
    const feature = await runtime.mount({
      inject: ['slots', 'layout'],
      apply: (ctx: typeof runtime.ctx) => {
        ctx.provide('feature-service', { ok: true })
        ctx.slots.register({
          name: 'trt.rows',
          id: 'row-1',
          children: { 'trt.rows.hole': { kind: 'single', scope: 'root' } },
        } as never, ((props: { renderSlot: (key: string, owner: object) => unknown }) =>
          <div data-testid="row">{props.renderSlot('trt.rows.hole', {}) as React.ReactNode}</div>) as never)
      },
    })
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    expect(view.getByTestId('row')).toBeTruthy()
    expect(runtime.ctx.get('feature-service')).toEqual({ ok: true })
    expect(runtime.slots.entries('trt.rows')).toHaveLength(1)

    await feature.dispose()
    await feature.dispose() // idempotent
    expect(runtime.slots.entries('trt.rows')).toHaveLength(0)
    expect(runtime.slots.spec('trt.rows.hole')).toBeUndefined()
    expect(runtime.ctx.get('feature-service')).toBeUndefined()
    expect(view.queryByTestId('row')).toBeNull()
    await runtime.dispose()
  })

  it('mount fails loud on missing services instead of suspending forever', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    await expect(runtime.mount({ inject: ['slots', 'absent-service'], apply: () => {} }))
      .rejects.toThrow(/missing service\(s\) absent-service/)
    await runtime.dispose()
  })

  it('runtime dispose is idempotent, unmounts views, disposes mounted features, and clears persisted state', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await runtimeWithFrame()
    /** 中文说明：变量 feature 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const feature = await runtime.mount({
      inject: ['slots'],
      apply: (ctx: typeof runtime.ctx) => { ctx.slots.register({ name: 'trt.panel' }, () => <b>p</b>) },
    })
    /** 中文说明：变量 view 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('p')
    localStorage.setItem('trt.leftover', 'x')

    await runtime.dispose()
    expect(view.container.innerHTML).toBe('')
    expect(feature.fiber.uid).toBeNull()
    expect(localStorage.getItem('trt.leftover')).toBeNull()
    await runtime.dispose() // idempotent
    await expect(runtime.dispose()).resolves.toBeUndefined()
  })
})

describe('single-slot mounting (declare + renderSlot)', () => {
  it('renders one slot inside its data-slot wrapper and updates owner props in place', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register(
      { name: 'trt.panel' },
      ({ label }: { label?: string }) => <b data-testid="panel">{label ?? 'none'}</b>)
    /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slot = runtime.renderSlot('trt.panel', { label: 'first' })
    expect(slot.container.getAttribute('data-slot')).toBe('trt.panel')
    expect(slot.view.getByTestId('panel').textContent).toBe('first')

    /** 中文说明：变量 panel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const panel = slot.view.getByTestId('panel')
    slot.update({ label: 'second' })
    expect(slot.view.getByTestId('panel').textContent).toBe('second')
    // In-place re-render: the element identity survived the owner flip.
    expect(slot.view.getByTestId('panel')).toBe(panel)
    await runtime.dispose()
  })

  it('views sibling slots of one tree separately and rejects undeclared keys', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'trt.panel': { kind: 'single', scope: 'root' },
      'trt.rows': { kind: 'list', scope: 'root' },
    })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>panel</b>)
    runtime.slots.register({ name: 'trt.rows', id: 'r1' }, () => <i>row</i>)
    /** 中文说明：变量 panel 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const panel = runtime.renderSlot('trt.panel', {})
    /** 中文说明：变量 rows 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const rows = runtime.renderSlot('trt.rows', {})
    expect(panel.container.textContent).toBe('panel')
    expect(rows.container.textContent).toBe('row')
    expect(() => runtime.renderSlot('trt.chat', {})).toThrow(/without declare\(\)/)
    await runtime.dispose()
  })

  it('folds class hashes and collapses svg internals in snapshots, leaving the live DOM alone', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3 plain">
        <span className="_label_ff00aa">styled</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 0L16 16" fill="currentColor" />
        </svg>
      </div>
    ))
    /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    // The serializer works on a clone: the live DOM keeps hashes and paths.
    expect(slot.container.querySelector('div')!.className).toBe('_frame_a1b2c3 plain')
    expect(slot.container.querySelector('svg path')).not.toBeNull()
    await runtime.dispose()
  })
})

describe('fixture session face', () => {
  it('fail-loud stubs name the missing verb; supplied overrides run instead', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.sessions.add({ id: 's1' })
    /** 中文说明：变量 bare 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const bare = runtime.sessions.behavior('s1')
    expect(() => bare.prompt()).toThrow(/prompt is not stubbed/)
    expect(() => bare.readAttachment('att-1' as Parameters<typeof bare.readAttachment>[0])).toThrow(/readAttachment is not stubbed/)
    expect(() => bare.updateQueue()).toThrow(/updateQueue is not stubbed/)
    expect(() => bare.cancel()).toThrow(/cancel is not stubbed/)
    expect(() => bare.command()).toThrow(/command is not stubbed/)
    expect(() => bare.loadOlder()).toThrow(/loadOlder is not stubbed/)
    expect(() => bare.rename()).toThrow(/rename is not stubbed/)
    const submission = bare.beginSubmission()
    expect(submission.requestId).toBe('test-submission-1')
    expect(() => { submission.abandon() }).not.toThrow()
    await runtime.dispose()
  })

  it('projects controller values through the real ui-session and renderer path', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.chat' }, (props: SessionStandardProps) => (
      <span>todos:{props.useProjection('todos', value => value?.length ?? 0)}</span>
    ))
    const view = runtime.renderRoot()
    await runtime.sessions.add({ id: 's1' })
    expect(view.container.textContent).toContain('todos:0')

    const session = runtime.sessions.behavior('s1')
    /** 中文说明：变量 face 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const face = session.projections.faceOf('todos')
    expect(session.projections.faceOf('todos')).toBe(face)
    expect(face.getSnapshot()).toBeUndefined()
    /** 中文说明：变量 seen 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const seen: unknown[] = []
    /** 中文说明：函数值 off 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const off = face.subscribe(() => { seen.push(face.getSnapshot()) })
    session.projections.set('todos', [1, 2])
    await runtime.flush()
    expect(seen).toEqual([[1, 2]])
    expect(view.container.textContent).toContain('todos:2')
    off()
    session.projections.set('todos', [3])
    await runtime.flush()
    expect(seen).toEqual([[1, 2]]) // unsubscribed
    expect(view.container.textContent).toContain('todos:1')
    // A never-subscribed key sets without listeners (the empty-notify arm).
    session.projections.set('untouched', 1)
    await runtime.dispose()
  })
})

describe('workspaces action face', () => {
  it('records every IWorkspaces verb with inert defaults and honors stubs', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    /** 中文说明：变量 ws 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const ws = runtime.workspaces
    /** 中文说明：变量 created 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const created = await ws.create({ path: '/tmp/alpha' })
    expect(created.title).toBe('/tmp/alpha')
    /** 中文说明：变量 registered 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const registered = await ws.create({ path: '/tmp/beta' })
    expect(registered.path).toBe('/tmp/beta')
    const renamed = await ws.rename('w1' as WorkspaceId, 'Renamed')
    expect(renamed.title).toBe('Renamed')
    await ws.delete('w1' as WorkspaceId)
    await ws.insertBefore('w1' as WorkspaceId, 'w2' as WorkspaceId)
    /** 中文说明：变量 moved 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const moved = await ws.insertSessionBefore('w1' as WorkspaceId, 's1' as SessionId, 's2' as SessionId)
    expect(moved.sessionIds).toEqual(['s1'])
    // Default archive mirrors the production effect: the id joins the list
    // state's archive set (features render against the same snapshot).
    await ws.archiveSession('s1' as SessionId)
    expect(ws.list.getSnapshot().archivedSessionIds).toEqual(['s1'])
    expect(ws.calls.map(c => c.method)).toEqual(
      ['create', 'create', 'rename', 'delete', 'insertBefore', 'insertSessionBefore', 'archiveSession'])

    ws.stub('create', () => Promise.resolve({ workspaceId: 'ws-x', title: 'X', path: '/x', sessionIds: [] } as never))
    ws.stub('rename', () => Promise.resolve({ workspaceId: 'w1', title: 'S', path: '/s', sessionIds: [] } as never))
    ws.stub('delete', () => Promise.resolve())
    const insertBefore = vi.fn(() => Promise.resolve())
    ws.stub('insertBefore', insertBefore)
    ws.stub('insertSessionBefore', () => Promise.resolve({ workspaceId: 'w1', title: '', path: '', sessionIds: [] } as never))
    ws.stub('archiveSession', () => Promise.resolve())
    expect((await ws.create({ path: '/y' })).title).toBe('X')
    expect((await ws.rename('w1' as WorkspaceId, 'z')).title).toBe('S')
    await ws.delete('w1' as WorkspaceId)
    await ws.insertBefore('w2' as WorkspaceId)
    expect(insertBefore).toHaveBeenCalledWith('w2', undefined)
    expect((await ws.insertSessionBefore('w1' as WorkspaceId, 's1' as SessionId)).sessionIds).toEqual([])
    // The stub replaces the default set mutation: the set stays as-is.
    await ws.archiveSession('s2' as SessionId)
    expect(ws.list.getSnapshot().archivedSessionIds).toEqual(['s1'])
    await runtime.dispose()
  })
})

describe('single-slot mounting edge arms', () => {
  it('renderSlot fails loud after dispose and after an external unmount', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>p</b>)
    runtime.renderSlot('trt.panel', {})
    // RTL cleanup empties the mounted tree behind the runtime's back: the
    // wrapper lookup names the state instead of returning a dead container.
    cleanup()
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/rendered no wrapper/)
    await runtime.dispose()
    // After dispose the root registration is gone: the production boot-order
    // check fires before any wrapper lookup.
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/'root' has no registration/)
  })

  it('serializes childless svg untouched next to scoped classes', async () => {
    /** 中文说明：变量 runtime 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3">
        <svg viewBox="0 0 1 1" aria-hidden="true" />
      </div>
    ))
    /** 中文说明：变量 slot 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })
})

describe('stubbed settings scope', () => {
  it('records both write kinds and publishes a Host acceptance to its listeners', async () => {
    /** 中文说明：变量 host 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    const host = stubSettingsScope<{ preference: string }>()
    /** 中文说明：变量 notified 保存本测试当前步骤所需的数据；取值由紧邻初始化或后续赋值决定。 */
    let notified = 0
    /** 中文说明：函数值 stop 封装本测试的局部步骤；参数和返回值由右侧签名约束；示例见本文件调用。 */
    const stop = host.scope.subscribe(() => { notified += 1 })
    expect(host.listenerCount()).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({
      status: 'loading', base: undefined, user: undefined,
    })

    await host.scope.set('preference', 'dark')
    await host.scope.unset('preference')
    host.publish({
      status: 'ready',
      value: { preference: 'system' },
      base: { preference: 'system' },
      revision: 2,
      writable: true,
    })

    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(host.unset).toHaveBeenCalledWith('preference')
    expect(notified).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({ status: 'ready', revision: 2, writable: true })
    stop()
    expect(host.listenerCount()).toBe(0)
  })
})
