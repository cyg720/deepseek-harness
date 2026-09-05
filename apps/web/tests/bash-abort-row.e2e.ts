// Web e2e scenario: a cancelled Bash call can settle without terminal-card
// material. Borrow the real cancellation fixture and prove the keyed Bash row
// still exposes the recorded command and full error without any model call.
// 复用真实取消夹具，证明没有终端卡片材料时，Bash 行仍能展示命令和完整错误且不调用模型。
/**
 * 文件职责：端到端验证被取消且缺少终端卡片材料的 Bash 调用仍可展开查看详情。
 * 技术维度：使用 Playwright、真实会话夹具、ARIA 快照和键控工具行渲染链路。
 * 产品维度：用户能从取消的命令中查看输入、输出、说明和完整错误，便于诊断中断原因。
 * 逻辑维度：播种真实取消会话，打开目标行，验证折叠/展开状态和文本，再保存稳定快照。
 * 关键边界：记录模式跳过；借用夹具日期需归一化，避免运行器时区改变黄金文件。
 * 新手阅读建议：先看 beforeAll 如何打开播种会话，再比较点击前后的 aria-expanded 与错误数量。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/acp/cancel-tool-calls/session.v2.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/bash-abort-row', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 播种会话的固定编号。 */
const SEED_ID = 'bash-abort-row-web-e2e'
/** 夹具中应存在的唯一用户提示。 */
const PROMPT = 'Run two shell commands: wait for cancellation, then write skipped.txt.'

describe.skipIf(MODE === 'record')('web e2e: cancelled Bash row disclosure', () => {
  /** 真实 Web 主机与工作区夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 打开取消会话的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    /** 从真实取消夹具读取的会话日志。 */
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    /** 左侧会话树的分组行。 */
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    /** 播种会话对应的树行。 */
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.locator('[data-sample="bash"]').nth(1).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('expands the aborted row to its command and full error', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-bash-abort-row'))
    /** 被取消的第一条 Bash 摘要行。 */
    const row = page.locator('[data-sample="bash"]').first()
    /** 包含摘要、详情和错误的完整工具调用容器。 */
    const call = row.locator('xpath=..')
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
    await expect.poll(() => call.getByText('Error: tool call aborted', { exact: true }).count()).toBe(1)
    await row.click()

    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
    await call.getByText('IN', { exact: true }).waitFor()
    await call.getByText('OUT', { exact: true }).waitFor()
    await call.getByText('Wait until cancellation', { exact: false }).waitFor()
    await call.getByText('setInterval(() => {}, 1000)', { exact: false }).waitFor()
    await expect.poll(() => call.getByText('Error: tool call aborted', { exact: true }).count()).toBe(2)

    /** 归一化日期和播种编号后的聊天区域 ARIA 树。 */
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      // The borrowed fixture's UTC date is still the previous day in PDT;
      // the disclosure golden must not depend on the runner timezone.
      // 借用夹具的 UTC 日期在 PDT 仍是前一天，黄金文件不能依赖运行器时区。
      .replace(/\b\d{1,2}\/\d{1,2}(?= \{\{clock\}\})/g, '{{date}}')
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
