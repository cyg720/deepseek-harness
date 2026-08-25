// Web e2e scenario: startup auto-selection keeps the hero on screen.
//
// A page load with a workspace already registered runs
// `WorkspaceRuntime.startInitialSelection`: it connects the most recent
// workspace and opens its blank session. `openState` flips to `loading` the
// moment `open()` lands; driving `data-phase=settling` on the conversation
// root from that flip would hide the composer seat and the header
// (`visibility:hidden`) for the whole `session.history` round-trip — the
// center column blanks and repaints like a full-page refresh on every launch.
//
// The unit spec pins the phase condition over hand-built stores. What only the
// assembled application can show is that the path a user actually takes
// reaches it: the real selection service, the real client session opening over
// the real /api transport, and a real browser deciding what is painted.
// The initial Workspace pick also records the resident Hero/composer nodes and
// proves that opening the first blank Session fills the strict outlets without
// replacing those nodes.
//
// The round-trip against a loopback host is far too fast to observe, so this
// scenario HOLDS the `session.history` response open in the browser's network
// handler and asserts the visible frame while it is in flight. That wait is
// what makes the assertions non-vacuous: without the phase exemption, the held
// window is exactly when `settling` would be painted and the composer hidden.
//
// Zero model calls: registering a workspace and opening its blank session are
// host RPCs with no model involvement. A stray stream would fail loud with
// NO_ADAPTER.
// 中文说明：通过故意挂起 session.history 响应，真实观察自动选择工作区期间 Hero 与编辑器是否持续可见。
/**
 * 文件职责：验证启动自动选择最近工作区并打开空会话时不会短暂隐藏 Hero、编辑器和页头。
 * 技术维度：使用 Playwright 网络路由挂起、真实 Host RPC、DOM 身份记录、Vitest 和相位追踪。
 * 产品维度：避免每次启动出现类似整页刷新的空白闪烁，保持首屏稳定。
 * 逻辑维度：先注册工作区，重载页面并拦截 history 响应，在请求悬挂期间检查可见性与节点身份。
 * 关键边界：必须挂起真实网络往返才能形成可观察窗口；零模型调用；重载连接警告需显式确认。
 * 新手阅读建议：先理解 HISTORY_ROUTE 与 ROOT_PHASE，再读 recordedPhases，最后看路由挂起和释放顺序。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** Wire path of the history round-trip the conversation root waits out (POST /api/session.history). */
/* 会话根节点启动时等待的 history RPC 路由匹配式。 */
const HISTORY_ROUTE = '**/api/session.history'

/**
 * The conversation root's own phase attribute. `div` disambiguates it from the
 * composer textarea, which carries an unrelated `data-phase` of its own.
 */
/* 中文说明：用 div 限定会话根，避免匹配同样带 data-phase 的编辑器文本框。 */
/** 定位会话根自身阶段属性的选择器。 */
const ROOT_PHASE = 'div[data-phase]'

/** Every distinct `data-phase` the conversation root shows, in order, across one page load. */
/* 读取 page 一次加载期间记录的全部不同会话阶段并返回数组。 */
function recordedPhases(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __conversationPhases: string[] }).__conversationPhases)
}

describe('web e2e: startup auto-selection', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the resident Hero and composer nodes when the first Workspace session appears', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-first-workspace-stable-tree'))
    await page.locator(`${ROOT_PHASE}[data-phase="hero"]`).waitFor({ timeout: 15_000 })
    const headline = page.getByText('Into the Unknown', { exact: true })
    const fishHitbox = headline.locator('xpath=preceding-sibling::span[1]')
    const fish = fishHitbox.locator('svg')
    expect(await fish.evaluate(node => getComputedStyle(node).color))
      .toBe(await headline.evaluate(node => getComputedStyle(node).color))
    await fishHitbox.hover()
    expect(await fish.evaluate(node => getComputedStyle(node).animationName)).not.toBe('none')
    await page.evaluate(() => {
      const refs = {
        root: document.querySelector('div[data-phase="hero"]'),
        workspaceChip: document.querySelector('[aria-label="Choose workspace"]'),
        scrollBody: document.querySelector('[data-conversation-scroll]'),
        composerSeat: document.querySelector('[data-composer-seat]'),
        textarea: document.querySelector('textarea'),
      }
      if (Object.values(refs).some(node => node === null)) throw new Error('incomplete initial Hero tree')
      ;(window as unknown as { __heroTree: typeof refs }).__heroTree = refs
    })

    // A registered Workspace is the precondition for the reload case below;
    // this first connection is also the no-Workspace → Workspace path.
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'startup-auto-selection')

    expect(await page.evaluate(() => {
      const before = (window as unknown as { __heroTree: Record<string, Element> }).__heroTree
      return {
        phase: document.querySelector('div[data-phase]')?.getAttribute('data-phase'),
        root: document.querySelector('div[data-phase="hero"]') === before.root,
        workspaceChip: document.querySelector('[aria-label="Choose workspace"]') === before.workspaceChip,
        scrollBody: document.querySelector('[data-conversation-scroll]') === before.scrollBody,
        composerSeat: document.querySelector('[data-composer-seat]') === before.composerSeat,
        textarea: document.querySelector('textarea') === before.textarea,
        textareaEnabled: !(document.querySelector('textarea') as HTMLTextAreaElement).disabled,
      }
    })).toEqual({
      phase: 'hero',
      root: true,
      workspaceChip: true,
      scrollBody: true,
      composerSeat: true,
      textarea: true,
      textareaEnabled: true,
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('keeps the hero and the composer on screen while the auto-selected blank session opens', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-startup-auto-selection'))
    // Runs before any page script on the reload below, so the first phase the
    // root ever renders is recorded, not just the ones after a listener attaches.
    await page.addInitScript(() => {
      const phases: string[] = []
      ;(window as unknown as { __conversationPhases: string[] }).__conversationPhases = phases
      setInterval(() => {
        const phase = document.querySelector('div[data-phase]')?.getAttribute('data-phase')
        if (phase === null || phase === undefined) return
        if (phases[phases.length - 1] !== phase) phases.push(phase)
      }, 8)
    })

    let releaseHistory = (): void => {}
    const historyHeld = new Promise<void>((resolve) => { releaseHistory = resolve })
    let historyRequested = (): void => {}
    const historyInFlight = new Promise<void>((resolve) => { historyRequested = resolve })
    let gated = false
    await page.route(HISTORY_ROUTE, async (route) => {
      // Only the auto-selection's own round-trip is held; later pages must not
      // deadlock behind a gate this test has already released.
      if (gated) { await route.continue(); return }
      gated = true
      historyRequested()
      await historyHeld
      await route.continue()
    })

    const warningsBefore = tripwire.warnings.length
    await page.reload({ waitUntil: 'commit' })
    await historyInFlight

    // The frame a user sees while the session is still opening: hero phase, the
    // hero title, and a composer that is actually painted (`settling` hides the
    // seat with `visibility:hidden`, which Playwright reports as not visible).
    await page.waitForSelector(ROOT_PHASE, { timeout: 15_000 })
    expect(await page.locator(ROOT_PHASE).first().getAttribute('data-phase')).toBe('hero')
    expect(await page.getByText('Into the Unknown').isVisible()).toBe(true)
    expect(await page.locator('textarea').first().isVisible()).toBe(true)

    releaseHistory()
    await page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
      .waitFor({ timeout: 15_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningsBefore)

    // Settling is not merely absent from the frame sampled above: the root
    // never entered it at any point of the load.
    expect(await recordedPhases(page)).toEqual(['hero'])
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
