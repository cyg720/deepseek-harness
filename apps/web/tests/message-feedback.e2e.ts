// Keyless browser regression for durable per-message feedback. Cold-seeds a
// settled two-turn transcript (zero model calls), rates one assistant message,
// attaches a note, proves both survive a full page reload from the Host's
// message-feedback sidecar, then retracts the rating.
// 中文说明：测试无模型调用地验证评分与备注经主机持久化后可在整页重载中恢复，并可撤销评分。
/**
 * 文件职责：验证单条助手消息的评分和备注可以持久化、重载恢复并撤销。
 * 技术维度：使用 Playwright、Vitest、冷注入会话和 Host 消息反馈存储。
 * 产品维度：保障用户反馈不会因刷新页面丢失，并能随时删除已有评分。
 * 逻辑维度：打开固定会话，添加评分与备注，重载页面验证恢复，再撤销评分并检查编辑入口消失。
 * 关键边界：复用会话必须含已完成助手消息；录制模式跳过断言；重载连接丢失需显式确认。
 * 新手阅读建议：先读 openSeededSession 的树结构处理，再按评分、备注、重载、撤销顺序阅读主测试。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold,
  seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

// Borrowed read-only: this scenario needs any settled assistant message to
// address, not a new recording (message-actions / sidebar-scrollbar pattern).
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v2.jsonl', import.meta.url))
const MODE = webSnapshotMode()
/** 注入借用会话时使用的稳定标识。 */
const SEED_ID = 'message-feedback-web-e2e'
/** 测试保存并在重载后恢复的固定备注内容。 */
const NOTE = 'Read both files before answering.'

describe('web e2e: durable per-message feedback', () => {
  /** 提供真实 Web 服务与反馈持久化的脚手架。 */
  let scaffold: WebScaffold
  /** 执行真实页面交互的 Chromium 实例。 */
  let browser: Browser
  /** 当前测试页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Open the seeded transcript. The first treeitem is the collapsible group
   * row; the session itself is the row beneath it. The group is already
   * expanded on a fresh load, so clicking it unconditionally would collapse it
   * and hide the session row.
   */
  /* 中文说明：仅在工作区未展开时点击它，再打开其下方固定会话；完成后无返回值。 */
  async function openSeededSession(): Promise<void> {
    /** 会话侧栏的工作区树项。 */
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    /** 工作区下方的固定会话树项。 */
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
  }

  it.skipIf(MODE === 'record')('persists a rating and its note across a reload, then retracts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-message-feedback'))
    await openSeededSession()

    // The controls live in the assistant message's IconActions row, which the
    // transcript reveals on hover/focus like copy and branch. Wait for the
    // settled closing text first: the strip mounts with that turn's tail.
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 30_000 })
    /** 首条助手消息的点赞按钮。 */
    const like = page.getByRole('button', { name: 'Good response' }).first()
    await like.waitFor({ timeout: 30_000 })
    await like.scrollIntoViewIfNeeded()
    await like.hover()
    await like.click()
    // A recorded rating relabels the button to what the next click would do,
    // so the pressed control is addressed by the retract label from here on.
    /** 已评分状态下的撤销评分按钮。 */
    const rated = page.getByRole('button', { name: 'Remove rating' }).first()
    await expect.poll(() => rated.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true')

    // A rated message offers the note editor; an unrated one does not.
    await page.getByRole('button', { name: 'Add a note' }).first().click()
    /** 输入并保存反馈备注的文本框。 */
    const editor = page.getByRole('textbox', { name: 'Feedback note' })
    await editor.fill(NOTE)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => editor.count(), { timeout: 10_000 }).toBe(0)
    await page.getByText(NOTE, { exact: true }).waitFor({ timeout: 10_000 })

    // The durable assertion: a cold browser re-reads the sidecar over the wire.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 30_000 })

    // The controller defers its list read to the first hover or focus, so a
    // cold reload shows the unrated label until the strip is touched. Hovering
    // the unrated control is what triggers the authoritative re-read.
    const cold = page.getByRole('button', { name: 'Good response' }).first()
    await cold.waitFor({ timeout: 30_000 })
    await cold.scrollIntoViewIfNeeded()
    await cold.hover()

    const restored = page.getByRole('button', { name: 'Remove rating' }).first()
    await restored.waitFor({ timeout: 30_000 })
    await restored.scrollIntoViewIfNeeded()
    await restored.hover()
    await expect.poll(() => restored.getAttribute('aria-pressed'), { timeout: 15_000 }).toBe('true')
    await page.getByText(NOTE, { exact: true }).waitFor({ timeout: 10_000 })

    // Re-clicking the active rating retracts it, and the note goes with it.
    await restored.click()
    await expect.poll(
      () => page.getByRole('button', { name: 'Good response' }).first().getAttribute('aria-pressed'),
      { timeout: 10_000 },
    ).toBe('false')
    await expect.poll(() => page.getByText(NOTE, { exact: true }).count(), { timeout: 10_000 }).toBe(0)
  }, 90_000)

  it.skipIf(MODE === 'record')('kept the console clean', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
