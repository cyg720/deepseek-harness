// Web e2e scenario: the plan-review takeover. The shipped composition mounts
// plan mode and its client seat, so `/plan <task>` enters plan mode for real
// and the recorded turn ends on exit_plan_mode blocking against the live
// userInteraction seam. The composer is then occupied by the plan decision
// card — not the generic question flow — and approving it through the card
// completes the turn with the approval in the log.
// Replay is deterministic: the plan content arrives from replayed chunks, the
// review wait is real, and the approve click is the test's own gesture (the
// turn cannot complete without it, in record and replay alike).
// 中文说明：计划内容可回放，但等待审批是真实交互；无论录制还是回放，必须由测试点击批准才能完成回合。
/**
 * 文件职责：验证 /plan 任务进入计划复审接管界面，并通过决策卡批准后完成同一回合。
 * 技术维度：使用 Playwright、Vitest、模型回放、用户交互服务、会话事件和无障碍快照。
 * 产品维度：让用户在执行前明确审阅计划，并把批准结果可靠记录到会话历史。
 * 逻辑维度：提交带任务的 /plan，等待复审卡，比较等待界面，点击批准，再核对结果事件与完成快照。
 * 关键边界：批准前回合不能结束；录制模式可调用真实模型；任务禁止读写文件以保持 fixture 稳定。
 * 新手阅读建议：先读 TASK 与 LINE，再跟踪 settled 在批准前后的变化，最后查看 tool/result 断言。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/plan-review', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v2.jsonl')
// The waiting golden owns the decision card; the approved golden owns the
// transcript the approval leaves behind — the state the card cannot see.
// 中文说明：等待快照固定决策卡，批准快照固定卡片消失后留在会话中的结果。
/** 等待用户决定时的计划卡快照。 */
const REVIEW_EXPECTED = join(SNAPSHOT_DIR, 'review.expected.md')
/** 计划等待期间侧栏状态的预期快照。 */
const SIDEBAR_EXPECTED = join(SNAPSHOT_DIR, 'sidebar.expected.md')
/** 批准后会话主体的预期快照。 */
const APPROVED_EXPECTED = join(SNAPSHOT_DIR, 'approved.expected.md')
const APPROVED_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'approved-expanded.expected.md')
const MODE = webSnapshotMode()

// One command line: /plan enters plan mode and submits the rest as the turn's
// message. The task is deliberately self-contained (nothing to explore in a
// fresh workspace) so the recorded turn is a plan and its review, and the
// approved continuation is one word.
// 中文说明：命令余下内容直接作为本轮消息，任务自包含且批准后只需回复一个单词。
/** 要求模型生成短计划并在批准后结束的固定任务。 */
const TASK = 'Plan a small change: add a --greeting flag to a CLI. Do not read or write any files. '
  + 'Call exit_plan_mode with a short plan of at most five bullet points. '
  + 'Once the plan is approved, reply with the single word DONE and stop.'
/** 实际填入编辑器的完整 /plan 命令行。 */
const LINE = `/plan ${TASK}`

describe('web e2e: plan review takeover round trip', () => {
  /** 提供计划模式、回放模型和交互服务的脚手架。 */
  let scaffold: WebScaffold
  /** 执行真实决策卡交互的 Chromium 实例。 */
  let browser: Browser
  /** 当前测试页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 本轮写入的会话事件，用于确认审批结果。 */
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15, compareReplaySession: true })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    // English page: the decision copy is the surface under test, and the
    // golden pins one language.
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

  it('reviews the plan on a decision card and approves through it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-plan-review'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([TASK])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(MODE === 'record' ? 180_000 : 30_000)
    await input.fill(LINE)
    await input.press('Enter')

    // The card takes over the input area while exit_plan_mode blocks. Its
    // presence is a STABLE waiting state (it stays until answered), so a plain
    // waitFor is race-free.
    const card = page.locator('[data-plan-review-key]')
    await card.waitFor({ timeout: MODE === 'record' ? 120_000 : 30_000 })
    // The plan-review request must NOT land on the generic question flow.
    expect(await page.locator('[data-question-key]').count()).toBe(0)
    await expect.poll(() => card.getByText('Plan review').count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const selectedRow = page.locator('[role="treeitem"][aria-selected="true"]')
    await expect.poll(() => selectedRow.locator('[data-state="warning"]').count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => selectedRow.getByText('Plan awaiting review', { exact: true }).count(), { timeout: 10_000 }).toBe(1)

    if (MODE !== 'record') {
      const snapshot = await captureStableAria(page, '[data-plan-review-key]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(REVIEW_EXPECTED, snapshot, MODE)
      const sidebar = await captureStableAria(page, '[role="treeitem"][aria-selected="true"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(SIDEBAR_EXPECTED, sidebar, MODE)
    }

    await card.getByRole('button', { name: 'Approve' }).click()

    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
      return
    }
    // World state: the approval reached the tool, and plan mode is left behind.
    const results = sessionEvents.filter(e => e.type === 'tool/result')
    expect(JSON.stringify(results.at(-1))).toContain('Plan approved')
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // Card gone; regular input restored.
    expect(await page.locator('[data-plan-review-key]').count()).toBe(0)
    expect(await selectedRow.locator('[data-state="warning"]').count()).toBe(0)
    await expect.poll(() => page.locator('[data-composer-input]').first().isEnabled(), { timeout: 10_000 }).toBe(true)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(APPROVED_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(APPROVED_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v2.jsonl', 'review.expected.md', 'sidebar.expected.md',
      'approved.expected.md', 'approved-expanded.expected.md',
    ])
  })
})
