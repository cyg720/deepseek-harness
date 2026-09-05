// @vitest-environment jsdom
/**
 * 文件职责：验证目录选择的 client-flow.client.spec.tsx 行为。
 * 技术维度：Vitest、React 渲染、事件模拟和服务替身。
 * 产品维度：防止目录选择用户流程回归。
 * 逻辑维度：构造状态，触发行为并断言结果和清理。
 * 关键边界：异步任务、全局替身和 DOM 必须在用例后恢复。
 * 新手阅读建议：先读辅助函数，再按场景顺序阅读。
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply, inject } from '../src/client/index.ts'
import { NativeDirectoryFlow } from '../src/client/flow.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(cleanup)

/** 中文说明：测试局部值 HOLES，由紧邻初始化决定。 */
const HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  /** 中文说明：测试局部值 pickDirectory，由紧邻初始化决定。 */
  const pickDirectory = vi.fn(async (): Promise<string | null> => '/tmp/picked')
  ctx.provide('uiWorkspace', { pickDirectory } as never)
  const slots = ctx.get('slots') as SlotRegistry
  /** 中文说明：测试局部值 declare，由紧邻初始化决定。 */
  const declare = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, pickDirectory, declare }
}

/** 中文说明：函数 owner 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function owner(overrides: Partial<DirectoryFlowOwnerProps> = {}): DirectoryFlowOwnerProps {
  return {
    open: true, busy: false,
    onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(),
    ...overrides,
  }
}

describe('directory-picker-native client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'uiWorkspace'])
  })

  it('fills both directory-flow holes for declarations before or after apply, and leaves with its fiber', async () => {
    /** 中文说明：测试局部值 before，由紧邻初始化决定。 */
    const before = await bench()
    before.declare()
    /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    // Registry-contribution disposal proof: the fiber going down empties the holes.
    await fiber.dispose()
    /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    /** 中文说明：测试局部值 after，由紧邻初始化决定。 */
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('fails loudly instead of deduplicating a duplicate package row', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 duplicate，由紧邻初始化决定。 */
    const duplicate = b.ctx.plugin({ inject: [...inject], apply })
    await expect(duplicate.await()).rejects.toThrow(/already has a registration/)
    /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
    for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(1)
  })

  it('rolls back wholesale and reports loudly when a rival injection wins declaration activation', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 rejections，由紧邻初始化决定。 */
    const rejections: unknown[] = []
    /** 中文说明：测试局部值 onUnhandled，由紧邻初始化决定。 */
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    // queueMicrotask throws surface as uncaughtException, not a rejection.
    process.on('unhandledRejection', onUnhandled)
    process.on('uncaughtException', onUnhandled)
    try {
      // The rival subscribes first, so synchronous declaration notifications
      // let it occupy the pair before this provider's waiting injection runs.
      b.slots.inject(HOLES[0], () => b.slots.inject(HOLES[1], function* () {
        yield b.slots.register({ name: HOLES[0] } as never, () => null)
        yield b.slots.register({ name: HOLES[1] } as never, () => null)
      }))
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      b.declare()
      await new Promise(resolve => setTimeout(resolve, 20))
      // The rival keeps both holes; this provider rolled back wholesale and
      // surfaced the conflict on the fail-loud channel — no partial mix.
      /** 中文说明：测试局部值 hole，由紧邻初始化决定。 */
      for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(1)
      expect(rejections.map(String).join('\n')).toContain('already has a registration')

      // Non-Error conflicts wrap before the loud rethrow (same channel).
      /** 中文说明：测试局部值 c，由紧邻初始化决定。 */
      const c = await bench()
      await c.ctx.plugin({ inject: [...inject], apply }).await()
      /** 中文说明：测试局部值 original，由紧邻初始化决定。 */
      const original = c.slots.register.bind(c.slots)
      /** 中文说明：测试局部值 slotsAny，由紧邻初始化决定。 */
      const slotsAny = c.slots as { register: typeof original }
      slotsAny.register = ((options: never, component: never) => {
        if ((options as { name?: string }).name === HOLES[0]) throw 'string conflict'
        return original(options, component)
      }) as typeof original
      c.declare()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(rejections.map(String).join('\n')).toContain('string conflict')
    } finally {
      process.off('unhandledRejection', onUnhandled)
      process.off('uncaughtException', onUnhandled)
    }
  })

  it('rolls back the outer injection when the second hole is already occupied', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    // Foreign occupant in the SECOND registered hole: the pair construction
    // throws after the outer injection installed its subscription.
    b.slots.register({ name: HOLES[1] } as never, () => null)
    /** 中文说明：测试局部值 rejections，由紧邻初始化决定。 */
    const rejections: unknown[] = []
    /** 中文说明：测试局部值 onUnhandled，由紧邻初始化决定。 */
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
      const fiber = b.ctx.plugin({ inject: [...inject], apply })
      await expect(fiber.await()).rejects.toThrow(/already has a registration/)
      // A leaked first deferral would now race this probe registration and
      // throw from its orphaned subscription against the HERO hole; the
      // rollback leaves only the activation failure itself (cordis re-raises
      // the apply throw as a late rejection — installFailLoud's contract).
      /** 中文说明：测试局部值 disposeProbe，由紧邻初始化决定。 */
      const disposeProbe = b.slots.register({ name: HOLES[0] } as never, () => null)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(rejections.map(String).filter(text => text.includes(HOLES[0]))).toEqual([])
      disposeProbe()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('rejects a second flow occupant at load (single-kind hole)', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(() => b.slots.register({ name: HOLES[0] } as never, () => null))
      .toThrow(/already has a registration/)
  })

  it('drives the injected pick through the hole entry and reports the picked path', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = b.slots.entries(HOLES[0])[0]!
    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = (entry.inject as () => { pick: () => Promise<string | null> })()
    await expect(injected.pick()).resolves.toBe('/tmp/picked')
    expect(b.pickDirectory).toHaveBeenCalledOnce()
  })

  it('runs one pick per open edge and reports the path to the latest onPicked', async () => {
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (path: string | null) => void
    /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
    const pick = vi.fn(() => new Promise<string | null>((settle) => { resolve = settle }))
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = owner()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<NativeDirectoryFlow {...first} pick={pick} />)
    expect(pick).toHaveBeenCalledOnce()
    // Re-renders while open (busy flips, handler identity changes) must not relaunch the chooser.
    /** 中文说明：测试局部值 second，由紧邻初始化决定。 */
    const second = owner()
    view.rerender(<NativeDirectoryFlow {...second} busy pick={pick} />)
    expect(pick).toHaveBeenCalledOnce()
    // Even a fresh injected face (re-registration re-runs the inject factory)
    // must not relaunch while the same request is still open.
    /** 中文说明：测试局部值 replacedPick，由紧邻初始化决定。 */
    const replacedPick = vi.fn(() => new Promise<string | null>(() => {}))
    view.rerender(<NativeDirectoryFlow {...second} busy pick={replacedPick} />)
    expect(replacedPick).not.toHaveBeenCalled()
    await act(async () => { resolve('/tmp/project') })
    expect(second.onPicked).toHaveBeenCalledWith('/tmp/project')
    expect(first.onPicked).not.toHaveBeenCalled()
  })

  it('discards a settlement that lands after the flow unmounted', async () => {
    /** 中文说明：测试局部值 resolve，由紧邻初始化决定。 */
    let resolve!: (path: string | null) => void
    /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
    const pick = vi.fn(() => new Promise<string | null>((settle) => { resolve = settle }))
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props = owner()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<NativeDirectoryFlow {...props} pick={pick} />)
    expect(pick).toHaveBeenCalledOnce()
    view.unmount()
    // The dead instance must neither adopt nor error; the owner's callbacks
    // stay untouched by the orphaned chooser's answer.
    await act(async () => { resolve('/tmp/late') })
    expect(props.onPicked).not.toHaveBeenCalled()
    expect(props.onCancel).not.toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()

    // The failure arm is discarded the same way.
    /** 中文说明：测试局部值 reject，由紧邻初始化决定。 */
    let reject!: (reason: unknown) => void
    /** 中文说明：测试局部值 failing，由紧邻初始化决定。 */
    const failing = vi.fn(() => new Promise<string | null>((_settle, rejectPick) => { reject = rejectPick }))
    /** 中文说明：测试局部值 late，由紧邻初始化决定。 */
    const late = owner()
    /** 中文说明：测试局部值 failingView，由紧邻初始化决定。 */
    const failingView = render(<NativeDirectoryFlow {...late} pick={failing} />)
    failingView.unmount()
    await act(async () => { reject(new Error('too late')) })
    expect(late.onError).not.toHaveBeenCalled()
  })

  it('reports null as cancellation and re-arms after the owner withdraws open', async () => {
    /** 中文说明：测试局部值 pick，由紧邻初始化决定。 */
    const pick = vi.fn(async () => null as string | null)
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props = owner()
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<NativeDirectoryFlow {...props} pick={pick} />)
    await act(async () => {})
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(props.onPicked).not.toHaveBeenCalled()
    // Withdraw and reopen: a fresh request runs a fresh pick.
    view.rerender(<NativeDirectoryFlow {...props} open={false} pick={pick} />)
    view.rerender(<NativeDirectoryFlow {...props} pick={pick} />)
    await act(async () => {})
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('folds pick failures into onError messages', async () => {
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props = owner()
    render(<NativeDirectoryFlow {...props} pick={vi.fn(async () => { throw new Error('no chooser installed') })} />)
    await act(async () => {})
    expect(props.onError).toHaveBeenCalledWith('no chooser installed')

    /** 中文说明：测试局部值 nonError，由紧邻初始化决定。 */
    const nonError = owner()
    render(<NativeDirectoryFlow {...nonError} pick={vi.fn(async () => { throw 'denied' })} />)
    await act(async () => {})
    expect(nonError.onError).toHaveBeenCalledWith('denied')
  })

  it('renders nothing while closed and while open', () => {
    /** 中文说明：测试局部值 closed，由紧邻初始化决定。 */
    const closed = render(<NativeDirectoryFlow {...owner({ open: false })} pick={vi.fn(async () => null)} />)
    expect(closed.container.innerHTML).toBe('')
    /** 中文说明：测试局部值 opened，由紧邻初始化决定。 */
    const opened = render(<NativeDirectoryFlow {...owner()} pick={vi.fn(async () => null)} />)
    expect(opened.container.innerHTML).toBe('')
  })
})

describe('directory-picker-native node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
