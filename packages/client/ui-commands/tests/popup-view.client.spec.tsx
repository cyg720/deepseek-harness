// @vitest-environment jsdom
/*
 * 文件职责：验证命令弹层的 popup-view.client.spec.tsx 行为。
 * 技术维度：Vitest、React 测试渲染和可控替身。
 * 产品维度：防止命令弹层用户流程发生回归。
 * 逻辑维度：构造输入、触发交互并断言输出与清理。
 * 关键边界：全局替身和异步任务必须在用例后清理。
 * 新手阅读建议：先读辅助函数，再按测试场景顺序阅读。
 */
/**
 * PopupSelectView interaction spec: the search input takes
 * focus on open and plain typing filters locally, ↑↓ move the filtered
 * highlight while ←→ stay native to the input, Enter selects single-flight,
 * Escape dismisses back through focusComposer, outside pointerdown dismisses
 * plainly, the submitting/failed states render pending text and a working
 * retry button, the highlighted row scrolls into view, and the card height
 * clamps to the space above the composer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SelectOption } from '../src/client/contract.ts'
import type { PopupSpec, TokenSegment } from '../src/client/popup.ts'
import { PopupSelectController } from '../src/client/popup.ts'
import { PopupSelectView } from '../src/client/PopupSelectView.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
/** 中文说明：测试场景的局部值 t，由紧邻初始化决定。 */
const t: Parameters<typeof PopupSelectView>[0]['t'] = makeTranslate(zh, commonZh)

// jsdom has no scrollIntoView; the view calls it on the highlighted row.
/** 中文说明：测试场景的局部值 scrollIntoView，由紧邻初始化决定。 */
const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 中文说明：测试场景的局部值 OPTIONS，由紧邻初始化决定。 */
const OPTIONS: SelectOption[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light', active: true },
  { id: 'sepia', label: 'Sepia', detail: 'warm' },
]
/** 中文说明：测试场景的局部值 GATED，由紧邻初始化决定。 */
const GATED: SelectOption = {
  id: 'full',
  label: 'Full access',
  confirmation: {
    title: 'Enable Full access?',
    description: 'Sensitive operations.',
    acknowledgeLabel: 'I understand the risks',
    cancelLabel: 'Cancel',
    confirmLabel: 'Enable Full access',
  },
}

/** 中文说明：测试场景的局部值 SEGMENT，由紧邻初始化决定。 */
const SEGMENT: TokenSegment = { via: 'enter', token: '/theme' }

/** 中文说明：函数 spec 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function spec(overrides: Partial<PopupSpec<string>> = {}): PopupSpec<string> {
  return {
    options: () => Promise.resolve(OPTIONS),
    onSelect: () => undefined,
    ...overrides,
  }
}

/** 中文说明：函数 mountOpen 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
async function mountOpen(overrides: Partial<PopupSpec<string>> = {}, consumeResult = true) {
  /** 中文说明：测试场景的局部值 consume，由紧邻初始化决定。 */
  const consume = vi.fn((_segment: TokenSegment) => consumeResult)
  /** 中文说明：测试场景的局部值 focusComposer，由紧邻初始化决定。 */
  const focusComposer = vi.fn()
  /** 中文说明：测试场景的局部值 popup，由紧邻初始化决定。 */
  const popup = new PopupSelectController<string>({ consume, focusComposer })
  /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
  const view = render(<PopupSelectView popup={popup} t={t} />)
  await act(async () => {
    popup.open('theme', spec(overrides), 'ctx-A', SEGMENT)
    await Promise.resolve()
  })
  return { popup, view, consume, focusComposer, search: screen.getByRole('textbox', { name: '筛选选项' }) }
}

/** 中文说明：函数 rowLabels 的参数见签名，返回结果供相邻流程使用；调用示例见本文件。 */
function rowLabels(): string[] {
  return screen.getAllByRole('option').map(o => o.querySelector('span')!.textContent)
}

describe('PopupSelectView', () => {
  it('renders null while closed, opens with focus in the search input', async () => {
    /** 中文说明：测试场景的局部值 popup，由紧邻初始化决定。 */
    const popup = new PopupSelectController<string>({ consume: () => true, focusComposer: () => {} })
    /** 中文说明：测试场景的局部值 view，由紧邻初始化决定。 */
    const view = render(<PopupSelectView popup={popup} t={t} />)
    expect(view.container.childElementCount).toBe(0)
    await act(async () => {
      popup.open('theme', spec(), 'ctx-A', SEGMENT)
      await Promise.resolve()
    })
    /** 中文说明：测试场景的局部值 search，由紧邻初始化决定。 */
    const search = screen.getByRole('textbox', { name: '筛选选项' })
    expect(document.activeElement).toBe(search)
    expect(rowLabels()).toEqual(['Dark', 'Light', 'Sepia'])
  })

  it('typing filters rows locally and rebases the highlight', async () => {
    /** 中文说明：测试场景的局部值 options，由紧邻初始化决定。 */
    const options = vi.fn(() => Promise.resolve(OPTIONS))
    /** 中文说明：测试场景的局部值 { search }，由紧邻初始化决定。 */
    const { search } = await mountOpen({ options })
    act(() => { fireEvent.change(search, { target: { value: 'li' } }) })
    expect(rowLabels()).toEqual(['Light'])
    expect(screen.getByRole('option').getAttribute('aria-selected')).toBe('true')
    expect(options).toHaveBeenCalledTimes(1)
    act(() => { fireEvent.change(search, { target: { value: 'zzz' } }) })
    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.queryByText('无选项')).not.toBeNull()
  })

  it('ArrowUp/Down move the filtered highlight; ArrowLeft/Right are left to the native caret', async () => {
    /** 中文说明：测试场景的局部值 { search }，由紧邻初始化决定。 */
    const { search } = await mountOpen()
    act(() => { fireEvent.keyDown(search, { key: 'ArrowDown' }) })
    /** 中文说明：测试场景的局部值 options，由紧邻初始化决定。 */
    let options = screen.getAllByRole('option')
    expect(options[1]!.getAttribute('aria-selected')).toBe('true')
    act(() => { fireEvent.keyDown(search, { key: 'ArrowUp' }) })
    options = screen.getAllByRole('option')
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    // fireEvent returns false when preventDefault was called: arrow left/right must NOT be intercepted.
    expect(fireEvent.keyDown(search, { key: 'ArrowLeft' })).toBe(true)
    expect(fireEvent.keyDown(search, { key: 'ArrowRight' })).toBe(true)
  })

  it('scrolls the highlighted row into view when the highlight moves', async () => {
    /** 中文说明：测试场景的局部值 { search }，由紧邻初始化决定。 */
    const { search } = await mountOpen()
    scrollIntoView.mockClear()
    act(() => { fireEvent.keyDown(search, { key: 'ArrowDown' }) })
    /** 中文说明：测试场景的局部值 options，由紧邻初始化决定。 */
    const options = screen.getAllByRole('option')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrollIntoView.mock.instances.at(-1)).toBe(options[1])
  })

  it('caps the card height at the design maximum when the composer sits low enough', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 800 } as DOMRect)
    await mountOpen()
    expect(screen.getByLabelText('/theme 选项').style.maxHeight).toBe('320px')
  })

  it('clamps the card height to the space above the composer minus the safe margin', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 200 } as DOMRect)
    await mountOpen()
    expect(screen.getByLabelText('/theme 选项').style.maxHeight).toBe('188px')
  })

  it('Enter selects the highlighted row: onSelect, consume, close, focusComposer', async () => {
    /** 中文说明：测试场景的局部值 seen，由紧邻初始化决定。 */
    const seen: Array<{ option: SelectOption; context: string }> = []
    /** 中文说明：测试场景的局部值 解构结果，由紧邻初始化决定。 */
    const { view, search, consume, focusComposer } = await mountOpen({
      onSelect: (option, context) => { seen.push({ option, context }) },
    })
    act(() => { fireEvent.keyDown(search, { key: 'ArrowDown' }) })
    await act(async () => { fireEvent.keyDown(search, { key: 'Enter' }) })
    expect(seen).toEqual([{ option: OPTIONS[1], context: 'ctx-A' }])
    expect(consume).toHaveBeenCalledExactlyOnceWith(SEGMENT)
    expect(focusComposer).toHaveBeenCalledTimes(1)
    expect(view.container.childElementCount).toBe(0)
  })

  it('click selects a row; mouseenter moves the highlight', async () => {
    /** 中文说明：测试场景的局部值 seen，由紧邻初始化决定。 */
    const seen: SelectOption[] = []
    /** 中文说明：测试场景的局部值 { view }，由紧邻初始化决定。 */
    const { view } = await mountOpen({ onSelect: (option) => { seen.push(option) } })
    /** 中文说明：测试场景的局部值 options，由紧邻初始化决定。 */
    const options = screen.getAllByRole('option')
    act(() => { fireEvent.mouseEnter(options[2]!) })
    expect(screen.getAllByRole('option')[2]!.getAttribute('aria-selected')).toBe('true')
    await act(async () => { fireEvent.click(options[2]!) })
    expect(seen).toEqual([OPTIONS[2]])
    expect(view.container.childElementCount).toBe(0)
  })

  it('renders a gated option as an in-page modal and requires the checkbox before onSelect', async () => {
    /** 中文说明：测试场景的局部值 onSelect，由紧邻初始化决定。 */
    const onSelect = vi.fn()
    /** 中文说明：测试场景的局部值 { popup, consume }，由紧邻初始化决定。 */
    const { popup, consume } = await mountOpen({
      options: () => Promise.resolve([GATED]),
      onSelect,
    })
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Full access' })) })
    expect(screen.queryByLabelText('/theme 选项')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Enable Full access?' })).toBeTruthy()
    /** 中文说明：测试场景的局部值 enable，由紧邻初始化决定。 */
    const enable = screen.getByRole('button', { name: 'Enable Full access' }) as HTMLButtonElement
    expect(enable.disabled).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the risks' }))
    expect(enable.disabled).toBe(false)
    await act(async () => { fireEvent.click(enable) })
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(GATED, 'ctx-A')
    expect(consume).toHaveBeenCalledExactlyOnceWith(SEGMENT)
    expect(popup.state.getSnapshot().open).toBe(false)
  })

  it('canceling a gated option returns to the picker with acknowledgement reset', async () => {
    await mountOpen({ options: () => Promise.resolve([GATED]) })
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Full access' })) })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('/theme 选项')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Full access' })) })
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false)
  })

  it('submitting shows pending, locks the search input, and further Enter/click no-op', async () => {
    /** 中文说明：测试场景的局部值 release!，由紧邻初始化决定。 */
    let release!: () => void
    /** 中文说明：测试场景的局部值 onSelect，由紧邻初始化决定。 */
    const onSelect = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    /** 中文说明：测试场景的局部值 { search, consume }，由紧邻初始化决定。 */
    const { search, consume } = await mountOpen({ onSelect })
    await act(async () => { fireEvent.keyDown(search, { key: 'Enter' }) })
    expect(screen.queryByText('正在应用…')).not.toBeNull()
    expect((search as HTMLInputElement).readOnly).toBe(true)
    await act(async () => {
      fireEvent.keyDown(search, { key: 'Enter' })
      fireEvent.click(screen.getAllByRole('option')[1]!)
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    await act(async () => {
      release()
      await Promise.resolve()
    })
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it('a failed options load shows the error with a retry button that reloads', async () => {
    /** 中文说明：测试场景的局部值 attempts，由紧邻初始化决定。 */
    let attempts = 0
    await mountOpen({
      options: () => {
        attempts += 1
        return attempts === 1 ? Promise.reject(new Error('directory down')) : Promise.resolve(OPTIONS)
      },
    })
    expect(screen.getByRole('alert').textContent).toContain('directory down')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }))
      await Promise.resolve()
    })
    expect(attempts).toBe(2)
    expect(rowLabels()).toEqual(['Dark', 'Light', 'Sepia'])
  })

  it('an onSelect failure keeps the shell open with the error strip and no retry button (re-select is the retry)', async () => {
    /** 中文说明：测试场景的局部值 { search, consume }，由紧邻初始化决定。 */
    const { search, consume } = await mountOpen({ onSelect: () => Promise.reject(new Error('host rejected')) })
    await act(async () => { fireEvent.keyDown(search, { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain('host rejected')
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
    expect(consume).not.toHaveBeenCalled()
    expect(screen.getAllByRole('option').length).toBe(3)
  })

  it('Escape dismisses and restores composer focus', async () => {
    /** 中文说明：测试场景的局部值 解构结果，由紧邻初始化决定。 */
    const { view, search, focusComposer } = await mountOpen()
    act(() => { fireEvent.keyDown(search, { key: 'Escape' }) })
    expect(view.container.childElementCount).toBe(0)
    expect(focusComposer).toHaveBeenCalledTimes(1)
  })

  it('an outside pointerdown dismisses without focusComposer; an inside one does not dismiss', async () => {
    /** 中文说明：测试场景的局部值 { view, focusComposer }，由紧邻初始化决定。 */
    const { view, focusComposer } = await mountOpen()
    act(() => { fireEvent.pointerDown(screen.getAllByRole('option')[0]!) })
    expect(view.container.childElementCount).not.toBe(0)
    act(() => { fireEvent.pointerDown(document.body) })
    expect(view.container.childElementCount).toBe(0)
    expect(focusComposer).not.toHaveBeenCalled()
  })
})
