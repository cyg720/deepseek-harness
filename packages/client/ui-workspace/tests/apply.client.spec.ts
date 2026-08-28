/**
 * 文件职责：验证工作区浏览的 apply.client.spec.ts 行为。
 * 技术维度：Vitest、React 渲染、虚拟列表和服务替身。
 * 产品维度：防止工作区浏览展示与操作流程回归。
 * 逻辑维度：构造状态，触发交互并断言输出和清理。
 * 关键边界：计时器、观察器、DOM 尺寸和异步请求必须恢复。
 * 新手阅读建议：先读夹具，再按加载、交互和异常场景阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { WorkspaceBrowser } from '../src/client/rows/WorkspaceBrowser.tsx'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 create，由紧邻初始化决定。 */
  const create = vi.fn(async (input: { name: string } | { path: string }) => ({
    workspaceId: 'ws-new' as never,
    path: 'name' in input ? `/projects/${input.name}` : input.path,
    title: 'new', sessionIds: [], createdAt: '0', updatedAt: '0',
  }))
  const rename = vi.fn(async () => ({}))
  /** 中文说明：测试局部值 insertSessionBefore，由紧邻初始化决定。 */
  const insertSessionBefore = vi.fn(async () => ({}))
  /** 中文说明：测试局部值 open，由紧邻初始化决定。 */
  const open = vi.fn()
  /** 中文说明：测试局部值 clear，由紧邻初始化决定。 */
  const clear = vi.fn()
  /** 中文说明：测试局部值 search，由紧邻初始化决定。 */
  const search = vi.fn(async () => ({
    ok: true as const,
    value: { items: [{ sessionId: 'session' as never, snippet: 'match' }], hasMore: false },
  }))
  /** 中文说明：测试局部值 renameSession，由紧邻初始化决定。 */
  const renameSession = vi.fn(async (title: string) => ({ ok: true, value: { title, seq: 1 } }))
  /** 中文说明：测试局部值 binding，由紧邻初始化决定。 */
  const binding = vi.fn(() => ({ session: { rename: renameSession } }))
  /** 中文说明：测试局部值 fork，由紧邻初始化决定。 */
  const fork = vi.fn(async () => 'forked' as never)
  const subscribe = () => () => {}
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      subscribe,
    },
    create,
    rename,
    delete: vi.fn(async () => undefined),
    insertBefore: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    insertSessionBefore,
  } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({
        ids: [], byId: {}, current: undefined, phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      }),
      subscribe,
    },
    create: vi.fn(async () => 'created' as never),
    open,
    clear,
    search,
    searchResultLimit: 20,
    binding,
    fork,
  } as never)
  ctx.provide('connection', {
    generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
  } as never)
  const pickDirectory = vi.fn(() => Promise.resolve({ ok: true as const, value: '/projects/picked' }))
  const directoryPicker = { pick: pickDirectory }
  Object.assign(new TestRemote(ctx), { directoryPicker })
  ctx.provide('remote.directoryPicker', directoryPicker as never)
  const locale = new LocaleRuntime(ctx)
  // These specs assert the shipped Chinese copy. There is no jsdom `window`
  // in this lane, so browser-language detection never runs and the locale
  // comes from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, create, rename,
    insertSessionBefore, open, clear, search, renameSession, binding, fork, pickDirectory,
  }
}

/** 中文说明：类型或类 HoleName 约束模块数据或组件职责。 */
type HoleName = 'sidebar.workspaces' | 'conversation.hero.workspace' | 'conversation.empty.workspace'

/** Declare any subset of the holes with a single root registration ('root' is a single slot). */
/* 中文说明：函数 declare 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function declare(slots: SlotRegistry, ...names: HoleName[]): () => void {
  /** 中文说明：测试局部值 children，由紧邻初始化决定。 */
  const children = Object.fromEntries(names.map(name => [name, { kind: 'single', scope: 'root' }]))
  return slots.register({ name: 'root', children } as never, () => null)
}

describe('ui-workspace apply', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'remote.directoryPicker',
    ])
  })

  it('registers browser and pickers for declarations arriving before or after apply', async () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await bench()
    declare(before.slots, 'sidebar.workspaces')
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.workspaces')[0]!.component).toBe(WorkspaceBrowser)
    // Copy rides the standard locale seat: the entry declares the namespace
    // and apply registered both dictionaries.
    expect(before.slots.entries('sidebar.workspaces')[0]!.locale).toBe('workspace')
    expect(before.locale.bind('workspace')('session.new')).toBe('新会话')

    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    declare(after.slots, 'conversation.hero.workspace', 'conversation.empty.workspace')
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.workspace')[0]!.component).toBe(WorkspacePicker)
    // expect(after.slots.entries('conversation.empty.workspace')[0]!.component).toBe(WorkspacePicker)
  })

  it('routes browser actions and picker creation to the services', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const startSession = vi.spyOn(b.ctx.uiWorkspace, 'startSession').mockImplementation(() => undefined)

    /** 中文说明：测试局部值 browser，由紧邻初始化决定。 */
    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    // Both arms delegate to the shared Session navigation action.
    browser.startSession('ws' as never)
    expect(startSession).toHaveBeenCalledWith('ws')
    browser.startSession()
    expect(startSession).toHaveBeenLastCalledWith(undefined)
    browser.open('session' as never)
    expect(b.open).toHaveBeenCalledWith('session')
    /** 中文说明：测试局部值 signal，由紧邻初始化决定。 */
    const signal = new AbortController().signal
    await expect(browser.searchSessions('match', signal)).resolves.toEqual({
      items: [{ sessionId: 'session', snippet: 'match' }],
      hasMore: false,
    })
    expect(b.search).toHaveBeenCalledWith('match', signal)
    expect(browser.searchResultLimit).toBe(20)
    await browser.renameSession('session' as never, 'renamed session')
    expect(b.binding).toHaveBeenCalledWith('session')
    expect(b.renameSession).toHaveBeenCalledWith('renamed session')
    browser.forkSession('session' as never)
    await vi.waitFor(() => {
      expect(b.open).toHaveBeenCalledWith('forked')
    })
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'session', increaseTitle: true })
    await browser.renameWorkspace('ws' as never, 'renamed')
    expect(b.rename).toHaveBeenCalledWith('ws', 'renamed')
    await browser.insertSessionBefore('ws' as never, 's1' as never, 's2' as never)
    expect(b.insertSessionBefore).toHaveBeenCalledWith('ws', 's1', 's2')
    await browser.createWorkspace({ path: '/tmp/browser-project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/browser-project' })

    /** 中文说明：测试局部值 picker，由紧邻初始化决定。 */
    const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
    await picker.createWorkspace({ path: '/tmp/project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/project' })
  })

  it('declares the two directory-flow holes and reports their occupancy per surface', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Registration declared the child holes (declaration = render authorization).
    expect(b.slots.spec('sidebar.workspaces.directoryFlow')).toMatchObject({ kind: 'single' })
    expect(b.slots.spec('conversation.hero.workspace.directoryFlow')).toMatchObject({ kind: 'single' })

    /** 中文说明：测试局部值 browser，由紧邻初始化决定。 */
    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    /** 中文说明：测试局部值 picker，由紧邻初始化决定。 */
    const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    expect(browser.hooks.connectionGeneration.getSnapshot()).toBeUndefined()
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    // A flow occupant flips exactly its own surface, and the source notifies.
    /** 中文说明：测试局部值 notified，由紧邻初始化决定。 */
    const notified = vi.fn()
    /** 中文说明：测试局部值 unsubscribe，由紧邻初始化决定。 */
    const unsubscribe = browser.hooks.directoryFlow.subscribe(notified)
    /** 中文说明：测试局部值 dispose，由紧邻初始化决定。 */
    const dispose = b.slots.register({ name: 'sidebar.workspaces.directoryFlow' } as never, () => null)
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(true)
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    await Promise.resolve()
    expect(notified).toHaveBeenCalled()
    dispose()
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    unsubscribe()
  })

  it('rejects the browser search callback on a Session Controller business error', async () => {
    const b = await bench()
    b.search.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'internal', message: 'index unavailable', details: {} },
    }) as never)
    declare(b.slots, 'sidebar.workspaces')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 browser，由紧邻初始化决定。 */
    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    await expect(browser.searchSessions('needle', new AbortController().signal))
      .rejects.toThrow('index unavailable')
  })

  it('unregisters every entry on teardown', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace', 'conversation.empty.workspace')
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.workspace')).toHaveLength(0)
    // expect(b.slots.entries('conversation.empty.workspace')).toHaveLength(0)
  })
})
