// Web e2e scenario: every visible permission picker gates Full access behind
// the same locale-aware, in-page risk confirmation. Zero model calls: the
// scenario boots the shipped Web composition and exercises the real
// permission projection, client command path, HTTP RPC, and pushed update.
// 本场景无模型调用，贯穿真实权限投影、客户端命令、HTTP RPC 与推送更新链路。
/**
 * 文件职责：端到端验证所有访问模式选择器在启用 Full access 前要求中文风险确认。
 * 技术维度：使用 Playwright、真实 Web 脚手架、ARIA 快照和控制台监视器测试完整权限链路。
 * 产品维度：阻止用户误触最高权限，同时保证确认后界面和主机状态立即同步。
 * 逻辑维度：启动中文页面，打开权限菜单，检查确认框与几何位置，勾选风险声明后启用权限。
 * 关键边界：不调用模型；确认框必须挂在 document.body，且快照清单只允许一个预期文件。
 * 新手阅读建议：先看 beforeAll 的真实页面准备，再按菜单、对话框、确认勾选和状态回推阅读。
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
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/access-confirmation', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
/** 当前快照运行模式：比较、刷新或记录。 */
const MODE = webSnapshotMode()

describe('web e2e: Full access confirmation', () => {
  /** 真实 Web 主机和工作区夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 使用中文本地化的浏览器页面。 */
  let page: Page
  /** 收集页面错误与警告的控制台监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // CI uses Playwright's pinned browser. A developer may point this one
    // scenario at an installed Chromium when the matching browser download
    // is temporarily unavailable.
    // CI 使用固定 Playwright 浏览器，本地可临时指定已安装 Chromium。
    /** 可选的本地 Chromium 可执行文件路径。 */
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    // Keep the Chinese surface via {@link ZH_BROWSER_LOCALE}: the golden pins
    // the actual registered dictionary rather than a test-local translation
    // callback.
    // 使用真实中文词典而非测试翻译回调，使快照覆盖正式本地化注册。
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('requires acknowledgement before the composer picker can enable Full access', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-full-access-confirmation'))
    /** 页面中第一个访问模式选择按钮。 */
    const access = page.locator('button[aria-label^="访问模式"]').first()
    await access.waitFor({ timeout: 10_000 })

    expect(await access.getAttribute('aria-label')).toBe('访问模式，当前：Workspace Write')

    await access.click()
    await page.getByRole('menuitem', { name: 'Full access' }).click()
    /** 启用最高权限前显示的风险确认对话框。 */
    const dialog = page.getByRole('dialog', { name: '确认启用 Full access？' })
    await dialog.waitFor({ timeout: 10_000 })
    /** 勾选风险声明前保持禁用的确认按钮。 */
    const enable = dialog.getByRole('button', { name: '启用 Full access' })
    expect(await enable.isDisabled()).toBe(true)

    // The modal is in this page's body (not a native/new window) and escapes
    // the sticky composer's stacking context.
    // 对话框位于当前页面 body 中，并脱离粘性编辑器的层叠上下文，不会打开原生新窗口。
    expect(await dialog.evaluate(node => node.parentElement?.parentElement === document.body)).toBe(true)
    /** 归一化后的风险对话框 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    await dialog.getByRole('checkbox', { name: '我已了解风险，并愿意继续' }).check()
    expect(await enable.isEnabled()).toBe(true)
    await enable.click()
    await expect.poll(() => access.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('访问模式，当前：Full access')
    expect(await dialog.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
