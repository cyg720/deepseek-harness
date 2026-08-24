// Trusted non-loopback Web access cannot call the loopback-only settings API;
// the notice therefore advances for this browser process and returns on reload.
// 中文：受信任的非回环浏览器不能调用仅限回环的设置 API，因此欢迎提示只在当前进程推进，刷新后再次出现。
/**
 * 中文说明：
 * - 文件职责：验证远程 Web 访问关闭欢迎提示后只在进程内记忆，重新加载仍再次展示。
 * - 技术维度：使用 Playwright、真实 Web Scaffold、中文浏览器区域、对话框定位和控制台监视。
 * - 产品维度：远程用户可继续进入应用，同时不会错误声称已把欢迎状态持久写入本机设置。
 * - 逻辑维度：启动远程权限夹具，打开中文页面，关闭提示并检查 inert，再刷新验证提示回归。
 * - 关键边界：record 模式跳过；非回环权限是核心前提，连接重载警告由专用辅助函数确认。
 * - 新手阅读建议：先看 launchWebScaffold 的两个选项，再跟踪 root.inert 在关闭前后的变化。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

/** 当前 Web 快照运行模式。 */
const MODE = webSnapshotMode()

/** 中文：非录制模式下运行的远程欢迎提示 E2E 测试组。 */
describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  /** 当前测试组的远程 Web Scaffold。 */
  let scaffold: WebScaffold
  /** 当前 Chromium 实例。 */
  let browser: Browser
  /** 当前中文区域页面。 */
  let page: Page
  /** 捕获浏览器警告和页面错误的监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  /** 中文：测试组开始前启动远程 Scaffold、浏览器与中文页面。 */
  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  /** 中文：测试组结束后关闭浏览器和 Scaffold。 */
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** 中文：关闭欢迎提示后 root 恢复交互，刷新后提示再次出现且无意外错误；无参数和返回值。 */
  it('advances process-locally and presents the notice again after reload', async () => {
    /** 以中文标题定位的欢迎对话框。 */
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    /** 刷新前已有的预期警告数量，用于确认本次连接丢失。 */
    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await welcome.waitFor({ timeout: 15_000 })
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
