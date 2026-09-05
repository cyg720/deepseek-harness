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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply, inject } from '../src/client/index.ts'
import { BrowseDirectoryFlow } from '../src/client/flow.ts'
import { apply as nodeApply } from '../src/index.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)

/** 中文说明：测试局部值 HOLES，由紧邻初始化决定。 */
const HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const

/** 中文说明：测试局部值 HOME，由紧邻初始化决定。 */
const HOME = '/home/u'
/** 中文说明：测试局部值 homeListing，由紧邻初始化决定。 */
const homeListing: DirectoryListing = {
  path: HOME,
  home: HOME,
  crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'u', path: HOME, hidden: false }],
  entries: [{ name: 'Documents', path: `${HOME}/Documents`, hidden: false }],
  truncated: false,
}

/** 中文说明：函数 bench 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
async function bench() {
  /** 中文说明：测试局部值 ctx，由紧邻初始化决定。 */
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  /** 中文说明：测试局部值 listDirectory，由紧邻初始化决定。 */
  const listDirectory = vi.fn(async (): Promise<DirectoryListing> => homeListing)
  /** 中文说明：测试局部值 createDirectory，由紧邻初始化决定。 */
  const createDirectory = vi.fn(async (path: string, name: string) => `${path}/${name}`)
  ctx.provide('uiWorkspace', { listDirectory, createDirectory } as never)
  const slots = ctx.get('slots') as SlotRegistry
  /** 中文说明：测试局部值 declare，由紧邻初始化决定。 */
  const declare = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, listDirectory, createDirectory, declare }
}

/** 中文说明：函数 owner 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function owner(overrides: Partial<DirectoryFlowOwnerProps> = {}): DirectoryFlowOwnerProps {
  return {
    open: true, busy: false,
    onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(),
    ...overrides,
  }
}

describe('directory-picker-browse client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'uiWorkspace', 'locale'])
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

  it('rolls back wholesale and reports loudly when a rival injection wins declaration activation', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    /** 中文说明：测试局部值 rejections，由紧邻初始化决定。 */
    const rejections: unknown[] = []
    /** 中文说明：测试局部值 onUnhandled，由紧邻初始化决定。 */
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
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

  it('rolls back the zh dictionary when a rival already owns the namespace en slot', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    /** 中文说明：测试局部值 locale，由紧邻初始化决定。 */
    const locale = b.ctx.get('locale') as LocaleRuntime
    /** 中文说明：测试局部值 disposeRival，由紧邻初始化决定。 */
    const disposeRival = locale.register('directory-browser', 'en', { 'browser.title': 'rival' })
    /** 中文说明：测试局部值 rejections，由紧邻初始化决定。 */
    const rejections: unknown[] = []
    /** 中文说明：测试局部值 onUnhandled，由紧邻初始化决定。 */
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    // cordis re-raises the apply throw as a late rejection (installFailLoud's contract).
    process.on('unhandledRejection', onUnhandled)
    try {
      /** 中文说明：测试局部值 fiber，由紧邻初始化决定。 */
      const fiber = b.ctx.plugin({ inject: [...inject], apply })
      await expect(fiber.await()).rejects.toThrow(/already has locale/)
      // The zh registration rolled back with the failure: once the rival
      // leaves, a fresh registrant owns the whole namespace again.
      disposeRival()
      /** 中文说明：测试局部值 disposeZh，由紧邻初始化决定。 */
      const disposeZh = locale.register('directory-browser', 'zh', { 'browser.title': '空闲' })
      disposeZh()
    } finally {
      await new Promise(resolve => setTimeout(resolve, 0))
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('registers the dialog dictionaries and binds this package namespace', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = b.slots.entries(HOLES[0])[0]!
    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = (entry.inject as () => { t: (key: string) => string })()
    // zh is the shipped default locale.
    expect(injected.t('browser.title')).toBe('选择工作区目录')
    expect(injected.t('browser.newFolder')).toBe('新建文件夹')
    expect(injected.t('browser.showHidden')).toBe('显示隐藏文件')
  })

  it('drives the injected browse calls through the hole entry', async () => {
    /** 中文说明：测试局部值 b，由紧邻初始化决定。 */
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    /** 中文说明：测试局部值 entry，由紧邻初始化决定。 */
    const entry = b.slots.entries(HOLES[1])[0]!
    /** 中文说明：测试局部值 injected，由紧邻初始化决定。 */
    const injected = (entry.inject as () => {
      listDirectory: (path?: string) => Promise<DirectoryListing>
      createDirectory: (path: string, name: string) => Promise<string>
    })()
    await expect(injected.listDirectory()).resolves.toBe(homeListing)
    await expect(injected.createDirectory(HOME, 'fresh')).resolves.toBe(`${HOME}/fresh`)
    expect(b.listDirectory).toHaveBeenCalledOnce()
    expect(b.createDirectory).toHaveBeenCalledWith(HOME, 'fresh')
  })

  it('adapts the owner conversation onto the dialog: confirm picks, dismissal cancels', async () => {
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props = owner()
    /** 中文说明：测试局部值 listDirectory，由紧邻初始化决定。 */
    const listDirectory = vi.fn(async (): Promise<DirectoryListing> => homeListing)
    /** 中文说明：测试局部值 t，由紧邻初始化决定。 */
    const t = (key: string): string => key
    render(
      <BrowseDirectoryFlow
        {...props}
        listDirectory={listDirectory}
        createDirectory={vi.fn(async () => '')}
        t={t}
      />,
    )
    // The dialog opened at home; its confirm (browser.open) adopts the listed level.
    /** 中文说明：测试局部值 openButton，由紧邻初始化决定。 */
    const openButton = screen.getByRole<HTMLButtonElement>('button', { name: 'browser.open' })
    await waitFor(() => { expect(openButton.disabled).toBe(false) })
    fireEvent.click(openButton)
    expect(props.onPicked).toHaveBeenCalledWith(HOME)
    fireEvent.click(screen.getByRole('button', { name: 'browser.cancel' }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()
  })

  it('renders nothing while the flow is closed', () => {
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(
      <BrowseDirectoryFlow
        {...owner({ open: false })}
        listDirectory={vi.fn(async () => homeListing)}
        createDirectory={vi.fn(async () => '')}
        t={key => key}
      />,
    )
    expect(view.container.innerHTML).toBe('')
  })
})

describe('directory-picker-browse node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
