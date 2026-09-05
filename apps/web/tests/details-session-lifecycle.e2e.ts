// Keyless browser regression for the details column's default visibility and Session ownership.
// The shipped composition starts closed after selection and reload, retains an explicitly opened width through
// unselected states, and closes it only when a different Session takes ownership.
// 发布组合选中或重载会话后默认关闭详情列，显式宽度可跨未选中状态保留，换会话所有者才关闭。
/**
 * 文件职责：验证详情列默认关闭、侧栏尺寸持久化和会话所有权切换规则。
 * 技术维度：使用 Playwright、真实 AppFrame 网格轨道、拖拽手势、重载和播种会话。
 * 产品维度：详情面板不会意外占据空间，用户调整的侧栏宽度可保留，切换会话时状态可预测。
 * 逻辑维度：完成一轮对话，测量并拖动列把手，重载后依次切换新会话、原会话和播种会话。
 * 关键边界：快照只记录把手语义不固定平台坐标；重载连接丢失警告需按预期确认。
 * 新手阅读建议：先看三个轨道/快照辅助函数，再按首次加载、拖拽、重载和会话切换阅读。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, compareOrRefreshGolden,
  fixtureUserPrompts, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/details-session-lifecycle', import.meta.url))
const HANDLES_EXPECTED = join(SNAPSHOT_DIR, 'handles.expected.md')
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v2.jsonl', import.meta.url))
const SEED_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v2.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()

/** Last AppFrame grid track in CSS pixels. */
/* 返回 AppFrame 最后一列详情轨道的 CSS 像素宽度。 */
async function detailsTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    /** AppFrame 解析后的网格列宽列表。 */
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks.at(-1) ?? 'NaN')
  })
}

/** First AppFrame grid track in CSS pixels. */
/* 返回 AppFrame 第一列侧栏轨道的 CSS 像素宽度。 */
async function sidebarTrack(page: Page): Promise<number> {
  return await appFrame(page).evaluate((element) => {
    /** AppFrame 解析后的网格列宽列表。 */
    const tracks = getComputedStyle(element).gridTemplateColumns.split(' ')
    return Number.parseFloat(tracks[0] ?? 'NaN')
  })
}

/** AppFrame is the only product element with an inline grid track template. */
/* 返回唯一带内联网格列模板的 AppFrame 定位器。 */
function appFrame(page: Page) {
  return page.locator('[style*="grid-template-columns"]').first()
}

/** Render the two column-resize handles without platform-dependent coordinates. */
/* 渲染不含平台坐标的两列尺寸把手 Markdown 快照。 */
async function handleSnapshot(page: Page): Promise<string> {
  /** 每个把手的侧别、光标和伪元素存在性。 */
  const handles = await page.locator('[class*="handle"]').evaluateAll(elements =>
    elements.map(element => ({
      side: element.getAttribute('data-side'),
      cursor: getComputedStyle(element).cursor,
      pillGenerated: getComputedStyle(element, '::after').content !== 'none',
    })))
  return [
    '# AppFrame drag handles',
    '',
    ...handles.flatMap(handle => [
      `## ${handle.side}`,
      '',
      '- hit strip present: true',
      `- cursor: ${handle.cursor}`,
      `- pill generated: ${String(handle.pillGenerated)}`,
      '',
    ]),
  ].join('\n').trimEnd()
}

describe.skipIf(MODE === 'record')('web e2e: details panel follows the current Session lifecycle', () => {
  /** 真实 Web 主机和播种会话夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 驱动列拖拽和会话切换的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    /** 已提交回放夹具的完整日志。 */
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
    await seedSession(scaffold, await readFile(SEED_FIXTURE, 'utf8'), 'details-session-lifecycle-seed')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await appFrame(page).waitFor({ timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('starts and reloads closed, then stays closed across Session ownership changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-details-session-lifecycle'))
    /** 等待当前提示轮次结束的 Promise。 */
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })

    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)
    await compareOrRefreshGolden(HANDLES_EXPECTED, await handleSnapshot(page), MODE)

    /** 拖拽前的侧栏轨道宽度。 */
    const sidebarBefore = await sidebarTrack(page)
    /** 侧栏与中心列之间的拖拽把手。 */
    const sidebarHandle = page.locator('[data-side="sidebar"]')
    /** 侧栏把手的视口矩形。 */
    const sidebarBox = await sidebarHandle.boundingBox()
    expect(sidebarBox).not.toBeNull()
    /** 拖拽手势起始横坐标。 */
    const dragStartX = sidebarBox!.x + sidebarBox!.width / 2
    await page.mouse.move(dragStartX, sidebarBox!.y + 200)
    await page.mouse.down()
    await page.mouse.move(dragStartX + 70, sidebarBox!.y + 200, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => sidebarTrack(page), { timeout: 5_000 }).toBe(sidebarBefore + 70)

    /** 重载前已有控制台警告数量。 */
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await appFrame(page).waitFor({ timeout: 30_000 })
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    await page.getByRole('button', { name: /^(?:New session|新.*会话)$/ }).last().click()
    await page.getByText('Into the Unknown', { exact: false }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    /** 原始 LIGHTHOUSE 会话树行。 */
    const original = page.locator('[role=treeitem]').filter({ hasText: 'Reply with the single word' }).first()
    await original.click()
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(await page.getByText('Details', { exact: true }).isVisible()).toBe(false)

    /** Ungrouped 分组标题。 */
    const ungrouped = page.getByText('Ungrouped', { exact: true })
    /** Ungrouped 的可展开树行。 */
    const ungroupedRow = ungrouped.locator('..').locator('..')
    /** 包含 Ungrouped 子会话的分组区域。 */
    const ungroupedSection = ungroupedRow.locator('..')
    await expect.poll(async () => {
      if (await ungroupedRow.getAttribute('aria-expanded') !== 'true') {
        await ungrouped.click()
        await page.waitForTimeout(50)
      }
      return await ungroupedRow.getAttribute('aria-expanded')
    }, { timeout: 5_000 }).toBe('true')
    /** Ungrouped 下第二个播种会话行。 */
    const seeded = ungroupedSection.locator('[role="treeitem"]').nth(1)
    await seeded.click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => detailsTrack(page), { timeout: 5_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['handles.expected.md'])
  }, 90_000)
})
