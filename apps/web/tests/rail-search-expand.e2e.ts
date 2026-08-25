// Web e2e scenario: the collapsed rail's search control in the real event
// order. The rail click flips the sidebar wide and mounts WorkspaceBrowser's
// outside-click dismissal listener during its own React dispatch; the same
// click then keeps bubbling to document with the unmounted rail button as its
// target — outside searchRoot. The package-level jsdom test cannot replay
// that continuation (fireEvent does not re-bubble through listeners mounted
// mid-dispatch), so the guard that keeps the gesture alive
// (.agents/notes/implemented/bug-fix/2026-08-18-rail-search-outside-click-self-dismissal.md)
// is pinned here, in the assembled application under a real browser click.
//
// Zero model calls: collapsing the sidebar and expanding the search are pure
// client layout gestures; the scenario needs no session content at all.
// 中文说明：折叠侧栏和展开搜索只是客户端布局操作，无需会话内容或模型调用。
/**
 * 文件职责：验证折叠侧栏中的搜索按钮不会被同一次冒泡到 document 的点击立即关闭。
 * 技术维度：使用 Playwright 真实事件传播、React 挂载时序和 Vitest 轮询焦点状态。
 * 产品维度：保障用户单击窄侧栏搜索后能看到输入框并直接开始输入。
 * 逻辑维度：收起侧栏，单击 rail 搜索，等待宽侧栏与焦点，再用真正的外部点击确认可关闭。
 * 关键边界：必须在真实浏览器中重现中途新增 document 监听器；全程零模型调用。
 * 新手阅读建议：先理解原生事件冒泡，再按“收起—单击—聚焦—外部关闭”的顺序阅读测试。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** WorkspaceBrowser's rail-search focus delay (EXPAND_SLIDE_MS) plus flush headroom. */
/* 搜索展开动画和 React 刷新完成所需的最大聚焦等待毫秒数。 */
const FOCUS_SETTLE_MS = 600

describe('web e2e: rail search click survives its own document-level bubble', () => {
  /** 提供空白真实 Web 应用的脚手架。 */
  let scaffold: WebScaffold
  /** 执行真实事件冒泡的 Chromium 实例。 */
  let browser: Browser
  /** 当前测试页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('expands the search and lands focus in the input from one rail click', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-rail-search-expand'))
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    /** 侧栏收起后出现的窄轨搜索按钮。 */
    const railSearch = page.getByRole('button', { name: 'Search sessions' })
    // The wide chrome stays mounted through the 150ms collapse crossfade; the
    // rail control (no aria-expanded) replaces it at settle.
    await expect.poll(async () => railSearch.getAttribute('aria-expanded'), { timeout: 10_000 }).toBeNull()

    // The one real click under test: it must expand the sidebar AND leave the
    // search expanded after its own bubble reaches document.
    await railSearch.click()

    /** 侧栏展开后控制搜索状态的宽版按钮。 */
    const wideSearch = page.getByRole('button', { name: 'Search sessions' })
    await expect.poll(async () => wideSearch.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('true')
    /** 单击窄轨按钮后应自动获得焦点的搜索输入框。 */
    const input = page.getByPlaceholder('Search sessions...')
    await expect.poll(
      async () => input.evaluate(el => document.activeElement === el),
      { timeout: FOCUS_SETTLE_MS + 10_000 },
    ).toBe(true)

    // The guard ends with the gesture: a genuine outside click on an empty
    // query dismisses the expanded search as before.
    await page.getByRole('button', { name: 'New session' }).first().click()
    await expect.poll(async () => wideSearch.getAttribute('aria-expanded'), { timeout: 10_000 }).toBe('false')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
