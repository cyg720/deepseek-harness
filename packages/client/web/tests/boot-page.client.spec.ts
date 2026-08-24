// @vitest-environment jsdom
// 本测试使用 jsdom 提供 document 和 DOM 查询能力。
/**
 * 文件职责：验证无框架启动页在加载、进度、失败和销毁阶段呈现正确 DOM。
 * 技术维度：使用 Vitest、jsdom 和真实 BootPage 类进行浏览器端单元测试。
 * 产品维度：确保用户在 Web 应用启动期间持续看到准确状态，而不是白屏或陈旧提示。
 * 逻辑维度：每个测试挂载独立容器，驱动总数或插件状态，再检查文本、进度弧和清理结果。
 * 关键边界：测试结束必须清空 document.body，避免上一个用例残留节点影响查询。
 * 新手阅读建议：先看 mount 返回的容器与页面实例，再按加载到失败、销毁的顺序阅读用例。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

/** 每个用例结束后清空测试文档，隔离 DOM 状态。 */
afterEach(() => { document.body.innerHTML = '' })

/**
 * 在 document.body 中挂载新的启动页。
 * @returns 启动页宿主元素和对应 BootPage 实例。
 * @example `const { el, page } = mount()`
 */
function mount() {
  /** 当前测试的启动页宿主元素。 */
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('draws the loading skeleton before any plugin state arrives', () => {
    /** 尚未接收插件状态的启动页宿主。 */
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('HARNESS')
    expect(el.textContent).toContain('Loading plugins…')
  })

  it('keeps loading while entries are active or loading', () => {
    /** 用于驱动插件进度并检查 DOM 的启动页。 */
    const { el, page } = mount()
    page.setTotal(2)
    /** 代表启动进度的旋转指示器元素。 */
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('72deg')
    page.setState('a', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('180deg')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBe(spinner)
    page.setState('b', 'active')
    expect(spinner?.style.getPropertyValue('--dsh-boot-arc')).toBe('288deg')
    expect(el.textContent).toContain('Loading plugins…')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries', () => {
    /** 用于验证只列出失败插件的启动页。 */
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    /** 用于验证完整扫描报告优先显示的启动页。 */
    const { el, page } = mount()
    /** 模拟启动扫描生成的多行失败报告。 */
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('detaches on disposal', () => {
    /** 用于验证销毁时移除全部子节点的启动页。 */
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
