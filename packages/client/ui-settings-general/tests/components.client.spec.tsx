// @vitest-environment jsdom
/**
 * 文件职责：验证通用设置的 components.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染、DOM 事件和服务替身。
 * 产品维度：防止通用设置的展示、作用域或交互回归。
 * 逻辑维度：构造上下文与属性，渲染后断言状态和清理。
 * 关键边界：Provider、订阅、全局 DOM 与异步任务必须释放。
 * 新手阅读建议：先读辅助夹具，再按场景顺序阅读。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

/** Store over a real mirror derived from the same fake wire. */
/* 中文说明：函数 derivedDocumentStore 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
function derivedDocumentStore(api: object) {
  /** 中文说明：测试局部值 wire，由紧邻初始化决定。 */
  const wire = api as never
  return new SettingsDocumentStore(wire, new SettingsDescribeMirror(wire))
}
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
/** 中文说明：测试局部值 t，由紧邻初始化决定。 */
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
/** 中文说明：测试局部值 unusedHook，由紧邻初始化决定。 */
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
type AttentionSnapshot = Parameters<Parameters<TriggerContentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: TriggerContentProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const kit = { useSessions: unusedHook, useSessionPendingInteraction, useWorkspaces: unusedHook }

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    /** 中文说明：测试局部值 { container }，由紧邻初始化决定。 */
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  /** 中文说明：函数 mount 的参数见签名，返回结果供相邻流程使用；示例见本文件。 */
  function mount() {
    /** 中文说明：测试局部值 renderSlot，由紧邻初始化决定。 */
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    /** 中文说明：测试局部值 props，由紧邻初始化决定。 */
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    /** 中文说明：测试局部值 view，由紧邻初始化决定。 */
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    /** 中文说明：测试局部值 { renderSlot }，由紧邻初始化决定。 */
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    /** 中文说明：测试局部值 openDocument，由紧邻初始化决定。 */
    const openDocument = vi.fn(() => Promise.resolve({
      ok: true as const, value: { opened: true as const },
    }))
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    /** 中文说明：测试局部值 action，由紧邻初始化决定。 */
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith() })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    /** 中文说明：测试局部值 describe，由紧邻初始化决定。 */
    const describe = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } })
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } })
    const wire = { settings: { describe, openSettingsDocument: vi.fn() } } as never
    const mirror = new SettingsDescribeMirror(wire)
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = new SettingsDocumentStore(wire, mirror)
    /** 中文说明：测试局部值 first，由紧邻初始化决定。 */
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    /** 中文说明：测试局部值 controller，由紧邻初始化决定。 */
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: vi.fn(() => Promise.resolve({
          ok: false as const,
          error: { code: 'internal' as const, message: 'xdg-open missing', details: {} },
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
