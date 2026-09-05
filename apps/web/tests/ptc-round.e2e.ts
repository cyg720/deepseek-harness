// PTC mode browser round trip with nested sub-calls and details selection.
// Record: DSH_SNAPSHOT=record writes session.v2.jsonl, then a keyless
// DSH_SNAPSHOT=refresh regenerates ui.expected.md.
// 记录模式重写会话夹具，随后无密钥刷新模式重新生成 UI 黄金文件。
/**
 * 文件职责：端到端验证 Code Mode 的 run_code 父行、嵌套子调用、日志和详情面板行为。
 * 技术维度：使用真实 Chromium、代码模式工具线、模型回放、会话事件和 ARIA 快照。
 * 产品维度：用户能在单个代码程序中查看每个子工具结果，失败子调用清晰标记且不扰动布局。
 * 逻辑维度：驱动一轮含 Bash 和失败读取的 run_code，检查持久日志、嵌套行、面板与快照。
 * 关键边界：驱动步骤所有模式执行，语义断言只在回放/刷新运行；记录内容不依赖模型措辞。
 * 新手阅读建议：先看 PROMPT 构造两个子调用，再依次读日志断言、DOM 子行和面板断言。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  captureExpandedTurnProcessAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/ptc-round/session.v2.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('../../../snapshots/web/ptc-round/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()

// Elicits the successful and failed sub-rows this scenario asserts.
const PROMPT = 'Using ONE run_code program: run bash `echo CODE_ROUND_OK`, then read the file missing.txt '
  + 'catching its error in the program. Return an object with both outcomes. Then reply DONE and stop.'

describe('web e2e: PTC mode round renders nested sub-calls', () => {
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 驱动 Code Mode 一轮的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 本轮产生的全部会话事件。 */
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      agentPresets: { roots: [], default: 'ptc' },
      compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
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

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-drive'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    /** 等待当前提交轮次完成的 Promise。 */
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    /** 完成轮次对应的会话编号。 */
    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries run_code with full-content sub-dispatches', () => {
    const calls = sessionEvents.filter(event => event.type === 'tool/call')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(new Set(calls.map(call => (call.data as { name: string }).name))).toEqual(new Set(['run_code']))
    const dispatches = sessionEvents.filter(event => (event.type as string) === 'tool/code-dispatch')
    expect(dispatches.length).toBeGreaterThanOrEqual(2)
    for (const dispatch of dispatches) {
      /** 当前子分发所需的完整关联与内容字段。 */
      const data = dispatch.data as unknown as {
        parentCallId: string
        subCallId: string
        name: string
        isError: boolean
        content: { type: string }[]
      }
      expect(data.subCallId.startsWith(`${data.parentCallId}:code:`)).toBe(true)
      expect(Array.isArray(data.content)).toBe(true)
      expect(typeof data.isError).toBe('boolean')
    }
    /** 名为 bash 的子分发。 */
    const bash = dispatches.find(dispatch => (dispatch.data as { name: string }).name === 'bash')
    expect(bash).toBeDefined()
    /** Bash 子分发的完整内容块。 */
    const bashContent = (bash!.data as { content: { type: string; text?: string }[] }).content
    expect(bashContent.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('CODE_ROUND_OK')
  })

  it.skipIf(MODE === 'record')('renders the code parent row with always-visible nested sub-rows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-rows'))
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // The parent run_code row wears the code variant with the model-authored
    // description as its summary (the presentCall contract).
    // run_code 父行使用 code 变体，并以模型提供的 description 作为摘要。
    /** run_code 的 code 变体父行。 */
    const codeRow = page.locator('[data-variant="code"]').first()
    await expandOwningTurnProcess(page, codeRow)
    await codeRow.waitFor({ timeout: 10_000 })
    const nest = page.locator('[data-subcalls]').first()
    await nest.waitFor({ timeout: 10_000 })
    expect(await nest.locator('[data-sample="bash"]').count()).toBeGreaterThanOrEqual(1)
    expect(await nest.locator('[data-state="error"]').count()).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it.skipIf(MODE === 'record')('a bash sub-row click leaves the default details panel closed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-details'))
    const nest = page.locator('[data-subcalls]').first()
    /** 带详情列折叠状态的应用框架。 */
    const frame = page.locator('[style*="grid-template-columns"]').first()
    expect(await frame.getAttribute('data-details-collapsed')).toBe('true')
    await expandOwningTurnProcess(page, nest)
    await nest.locator('[data-sample="bash"]').first().click()
    await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
  })

  it.skipIf(MODE === 'record')('matches the expanded conversation aria golden with stable anchors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-aria'))
    const snapshot = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors, no reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
