// Web e2e: /goal opts its command input into the human transcript while the
// command remains log-only. The shipped composition runs with no model adapter,
// so an accidental turn fails loud in addition to the event-level assertions.
// 发布组合不挂载模型适配器，因此任何意外模型轮次都会在事件断言之外立即失败。
/**
 * 文件职责：验证 /goal 命令输入和结果进入人类可见聊天，而命令生命周期保持日志专用。
 * 技术维度：使用 Playwright、真实命令事件、持久化重载、排版测量和 ARIA 快照。
 * 产品维度：用户能在对话中看见自己执行的 /goal 与结果，又不会把命令误当模型消息或轮次。
 * 逻辑维度：从空白会话提交裸 /goal，检查气泡、结果与事件类型，再重载确认相同投影可重建。
 * 关键边界：不得产生 user/message、turn/start、step/start 或请求头；全程没有模型适配器。
 * 新手阅读建议：先看首次提交后的事件负断言，再看重载从 command/run/done 恢复相同界面。
 */
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-commands/types'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria,
  compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/goal-command-presentation', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL(
  './expected/goal-command-presentation/ui.expected.md', import.meta.url,
))
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()

describe('web e2e: /goal human transcript presentation', () => {
  /** 真实 Web 主机与命令夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 提交并重载目标命令的页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 本场景捕获的全部会话事件。 */
  const events: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { events.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the bare input and result from a fresh session without a model turn', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-command-presentation'))
    await expect.poll(() => page.getByText('Into the Unknown', { exact: false }).count(), {
      timeout: 15_000,
    }).toBe(1)
    const input = page.locator('[data-composer-input]').first()
    await input.fill('/goal')
    await input.press('Enter')
    await expect.poll(() => input.textContent()).toBe('/goal ')
    await input.press('Enter')

    /** 人类可见的 /goal 命令输入气泡。 */
    const commandInput = page.locator('[data-command-input]')
    await commandInput.waitFor({ timeout: 10_000 })
    await expect.poll(() => commandInput.textContent()).toBe('/goal')
    expect(await commandInput.getAttribute('role')).toBe('group')
    expect(await commandInput.getAttribute('aria-label')).toBe('Command input')
    expect(await commandInput.getByRole('button').count()).toBe(0)
    /** 命令气泡与父行的排版指标。 */
    const typography = await commandInput.evaluate((element) => {
      /** 命令文本的内部气泡元素。 */
      const bubble = element.firstElementChild?.firstElementChild
      if (!(bubble instanceof HTMLElement)) throw new Error('command input bubble is missing')
      /** 命令输入行根元素的最终样式。 */
      const rootStyle = getComputedStyle(element)
      /** 内部命令气泡的最终样式。 */
      const bubbleStyle = getComputedStyle(bubble)
      return {
        fontFamily: bubbleStyle.fontFamily,
        parentFontFamily: rootStyle.fontFamily,
        fontSize: bubbleStyle.fontSize,
        lineHeight: bubbleStyle.lineHeight,
      }
    })
    expect(typography).toMatchObject({ fontSize: '14px', lineHeight: '22px' })
    expect(typography.fontFamily).not.toBe(typography.parentFontFamily)
    /** 显示当前没有目标的命令结果行。 */
    const resultRow = page.locator('[data-variant="others"]').filter({ hasText: 'No goal is currently set.' })
    await expect.poll(() => resultRow.count(), { timeout: 10_000 }).toBe(1)
    expect(await resultRow.getByText('goal', { exact: true }).count()).toBe(1)
    await expect.poll(() => page.locator('[data-phase="active"]').count()).toBe(1)
    expect(await page.getByText('Into the Unknown', { exact: false }).count()).toBe(0)

    /** 持久日志中唯一 command/run 事件。 */
    const run = events.find(event => event.type === 'command/run')
    expect(run).toMatchObject({
      type: 'command/run',
      data: { name: 'goal', args: ' ', source: { kind: 'user' } },
    })
    expect(events.some(event => event.type === 'command/done')).toBe(true)
    expect(events.some(event => event.type === 'user/message')).toBe(false)
    expect(events.some(event => event.type === 'turn/start')).toBe(false)
    expect(events.some(event => event.type === 'step/start')).toBe(false)
    expect(events.some(event => event.type === 'request/header')).toBe(false)

    /** 首次执行后中心列的归一化 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  }, 60_000)

  it('reloads the same bubble and result from the persisted command lifecycle', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-command-presentation-reload'))
    /** 重载前的控制台警告数量。 */
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)

    await expect.poll(() => page.locator('[data-command-input]').textContent(), { timeout: 15_000 }).toBe('/goal')
    /** 重载后恢复的命令结果行。 */
    const resultRow = page.locator('[data-variant="others"]').filter({ hasText: 'No goal is currently set.' })
    await expect.poll(() => resultRow.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => page.locator('[data-phase="active"]').count()).toBe(1)

    /** 主机当前持有的会话列表。 */
    const sessions = scaffold.ctx.sessions.list()
    expect(sessions).toHaveLength(1)
    /** 唯一会话重载后的持久事件列表。 */
    const persisted = sessions[0]?.events ?? []
    expect(persisted.filter(event => event.type === 'command/run' || event.type === 'command/done')
      .map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(persisted.some(event => event.type === 'user/message')).toBe(false)
    expect(persisted.some(event => event.type === 'turn/start')).toBe(false)
    expect(persisted.some(event => event.type === 'step/start')).toBe(false)
    expect(persisted.some(event => event.type === 'request/header')).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 90_000)
})
