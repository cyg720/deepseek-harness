// Keyless assembled-browser coverage for the goal bar over the shipped Web
// bundles and the fixture Connection RPC. The command creates a real projected
// goal in the fixture session; the golden pins the active strip, while the
// clear gesture proves the acknowledged tombstone leaves neither stale chrome
// nor a duplicate-mutation error.
// 清除动作证明已确认的墓碑会移除目标条，不留下旧界面或重复变更错误。
/**
 * 文件职责：验证 /goal 创建的真实投影目标显示在顶部目标条，并可安全应对快速重复清除。
 * 技术维度：使用 Playwright、Fixture API、目标事件投影、ARIA 快照和双击式 DOM 手势。
 * 产品维度：用户能持续看到当前目标，清除后界面立即收敛且不会暴露内部重复操作错误。
 * 逻辑维度：在夹具空白会话提交 /goal，保存活动目标条快照，连续点击清除并等待目标条消失。
 * 关键边界：启动复用夹具工作区空白会话，避免与其他运行中回放和待回答问题相互影响。
 * 新手阅读建议：先看目标覆盖配置，再比较目标创建后的快照和连续两次 control.click 后的状态。
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/goal-bar', import.meta.url))
const ACTIVE_EXPECTED = join(SNAPSHOT_DIR, 'active.expected.md')
/** 为夹具启用目标能力的附加配置。 */
const OVERLAY = fileURLToPath(new URL('./goal-bar.overlay.yml', import.meta.url))
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()

describe('web e2e: goal bar clear convergence', () => {
  /** 真实 Web 主机与目标投影夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 创建和清除目标的页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, welcomeNoticePending: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    const login = await page.context().request.get(scaffold.authenticatedUrl, { maxRedirects: 0 })
    expect(login.status()).toBe(303)
    await page.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders one active goal and clears it without exposing a stale error', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-bar-clear'))
    // Startup reuses the fixture workspace's blank session, keeping this
    // command independent of alpha's running replay and pending question.
    const input = page.locator('[data-composer-input][data-placeholder="Describe what you want to build... / commands, @ files or sessions"]')
    await input.waitFor({ timeout: 10_000 })
    await input.fill('/goal guard rapid clear clicks')
    await input.press('Enter')

    /** 创建后出现的活动目标条。 */
    const bar = page.locator('[data-goal-bar]')
    await bar.waitFor({ timeout: 10_000 })
    /** 活动目标条的归一化 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[data-goal-bar]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACTIVE_EXPECTED, snapshot, MODE)

    /** 目标条中的清除按钮。 */
    const clear = bar.getByRole('button', { name: 'Clear goal' })
    await clear.evaluate((button) => {
      /** 需要模拟两次快速原生点击的按钮元素。 */
      const control = button as HTMLButtonElement
      control.click()
      control.click()
    })
    await expect.poll(() => page.locator('[data-goal-bar]').count(), { timeout: 10_000 }).toBe(0)
    expect(await page.getByText(/no current goal/iu).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['active.expected.md'])
  })
})
