// Keyless assembled-browser coverage for the /feedback command over the
// shipped Web bundles and the real host wire. The command plane settles
// without a model turn: the host appends the log-only command/run +
// feedback/record + command/done lifecycle, and the transcript renders the
// acknowledgement — the recorded session id plus the session-sharing
// disclosure — as a persistent command row. The scaffold mounts the shipped
// telemetry row in FULL mode against a local dead endpoint (no record leaves
// the process), so the golden pins the shipped default sentence
// `Session sharing is enabled.`; the per-status sentences are pinned by the
// package and OTel unit tests.
// 本场景固定发布默认共享提示，其他遥测状态文案由包级与 OTel 单测负责。
/**
 * 文件职责：验证 /feedback 命令在无模型轮次下记录反馈并持久展示会话编号与共享状态。
 * 技术维度：使用真实命令平面、反馈事件、FULL 遥测配置、模型回放和 ARIA 快照。
 * 产品维度：用户提交产品反馈后能看到明确确认，以及当前会话是否会共享的透明说明。
 * 逻辑维度：先回放一轮激活会话，再提交 /feedback，等待命令生命周期完成并比较确认行。
 * 关键边界：遥测指向未监听的本地丢弃端口，任何记录都不会离开进程；命令不启动模型轮次。
 * 新手阅读建议：先看 TELEMETRY_URL 的隔离目的，再比较驱动轮次和反馈命令两个阶段。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v2.jsonl')
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const ACK_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ack-expanded.expected.md')
const MODE = webSnapshotMode()
// Discard port: loopback listener never binds, so FULL telemetry discloses
// the shipped default policy without any record reaching a collector.
// 丢弃端口没有监听者，因此可展示 FULL 默认策略但不会向收集器发送记录。
/** 隔离遥测导出的本地未监听日志端点。 */
const TELEMETRY_URL = 'http://127.0.0.1:9/v1/logs'

/** 回放夹具中唯一用户提示。 */
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: /feedback command acknowledgement', () => {
  /** 真实 Web 主机与遥测夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 驱动反馈命令的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      telemetryUrl: TELEMETRY_URL,
      compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 5 }),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connecting a workspace births the blank session whose
    // live composer accepts the slash line.
    // 连接工作区创建空白会话，使实时编辑器可以接收斜杠命令。
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-drive'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      // 漂移防护：已提交夹具必须只含驱动提示。
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    // Arm the turn-boundary waiter BEFORE sending, so a burst replay cannot
    // miss the turn/end that settles the recorded turn.
    // 发送前先安装轮次屏障，避免快速回放错过 turn/end。
    /** 等待回放轮次结束的 Promise。 */
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    /** 已结束轮次对应的会话编号。 */
    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('records feedback and renders the acknowledgement with session id and sharing status', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-command'))
    // The drive test settled the recorded turn: the transcript is active (a
    // command row does not render while a fresh session is still blank) and
    // the replayed reply is on screen.
    // 已结束回放轮次使会话进入活动状态，命令行才能作为持久行渲染。
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const input = page.locator('[data-composer-input]').first()
    await input.fill('/feedback the diff view is unreadable')
    await input.press('Enter')
    // The command plane settles without a model turn: the ack row names the
    // recorded session and the mounted FULL backend's disclosure.
    // 命令平面不启动模型轮次，确认行直接显示会话编号和 FULL 后端共享说明。
    await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
    expect(await page.getByText(/Session sharing is enabled/).count()).toBe(1)
    /** 反馈确认后的中心列 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(ACK_EXPANDED_EXPECTED, expanded, MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v2.jsonl', 'ack.expected.md', 'ack-expanded.expected.md',
    ])
  })
})
