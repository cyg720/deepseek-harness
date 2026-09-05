// Web e2e scenario for the opt-in Cordis tools. Record mode drives a real
// model through inspect, define, run, and stop; replay pins the same shipped Web
// composition, durable calls, Cordis-owned rows, the define card's own source view,
// and conversation accessibility tree.
//
// The approval is never in the fixture. The fixture pins what the MODEL said;
// tools execute for real, and this test answers the approval before starting the
// stop turn. The package therefore carries a browser half whose only
// job is to be visible (`[data-snapshot-probe]`): its absence before the answer
// and presence after it is the v3 user gate, proven rather than described.
// 浏览器探针在批准前不存在、批准后出现，以实际 DOM 事实证明 v3 用户门禁。
/**
 * 文件职责：端到端验证可选 Cordis 工具的检查、定义、审批运行、停止和专属卡片生命周期。
 * 技术维度：使用真实 Cordis 工具、模型回放、用户审批、动态浏览器插件和 ARIA 快照。
 * 产品维度：用户可安全地让代理定义扩展，明确批准后才在页面运行，并随时停止撤销客户端代码。
 * 逻辑维度：驱动 inspect/define/run，人工点击批准，等待浏览器探针，再发送 stop 并检查日志与卡片。
 * 关键边界：审批动作从不记录进模型夹具；工具真实执行；批准前浏览器代码绝不能下载或挂载。
 * 新手阅读建议：先看 PACKAGE_CODE/CLIENT_CODE，再读日志完整性函数，最后跟随批准前后探针变化。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/cordis-tool-round/session.v2.jsonl', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('../../../snapshots/web/cordis-tool-round/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
/** 一个完整生命周期应按序调用的四个 Cordis 工具。 */
const CORDIS_TOOLS = ['cordis_inspect_self', 'cordis_define', 'cordis_run', 'cordis_stop'] as const
/** 动态包的无操作主机端源码。 */
const PACKAGE_CODE = 'return { name: "snapshot-noop", apply(ctx) {} }'
// The browser half is the PROBE this scenario turns on: it renders a marker into
// the frame-wide overlay, so "did the plugin actually run in this page" becomes a
// DOM fact. A host-only package would sidestep the approval round trip entirely
// (the host runs those immediately), which would drop the v3 user gate out of
// coverage — the one thing this scenario exists to prove.
// 客户端半部只渲染探针；主机专用包会绕过批准，因此不能覆盖本场景要证明的用户门禁。
/** 批准后向全框架覆盖插槽注册可见探针的客户端源码。 */
const CLIENT_CODE = 'return { inject: ["slots"], apply(ctx) { ctx.slots.register('
  + '{ name: "shell.overlay", id: "snapshot-probe" }, '
  + '() => React.createElement("div", { "data-snapshot-probe": "loaded" })) } }'
/** 要求模型完成检查、定义和运行的第一轮提示。 */
const PROMPT = 'Use only Cordis tools. First call cordis_inspect_self with no arguments. '
  + 'Then call cordis_define with plugin kind "new", idPrefix "snap", name "snapshot noop", '
  + 'purpose "does nothing, for the snapshot", '
  + `code.host exactly ${JSON.stringify(PACKAGE_CODE)} and code.client exactly ${JSON.stringify(CLIENT_CODE)}. `
  + 'Read its returned pluginId and packageId, then call cordis_run with those exact IDs and mode "run". '
  + 'After the run request returns, reply exactly CORDIS_UI_READY and stop.'
/** 要求模型停止刚运行插件的第二轮提示。 */
const STOP_PROMPT = 'Use only Cordis tools. Call cordis_stop with pluginId "snap-1". '
  + 'After it succeeds, reply exactly CORDIS_UI_DONE and stop.'

/** 断言持久事件包含按顺序成功完成的整个 Cordis 工具生命周期。 */
function assertCompleteCordisLifecycle(events: readonly SessionEvent[]): void {
  /** 最后一个轮次结束事件。 */
  const turnEnd = events.findLast(
    (event): event is Extract<SessionEvent, { type: 'turn/end' }> => event.type === 'turn/end',
  )
  /** 最终轮次结束原因。 */
  const reason = turnEnd?.data.reason
  expect(reason).toEqual({ kind: 'completed' })

  /** 持久化的全部工具调用事件。 */
  const calls = events.filter(
    (event): event is Extract<SessionEvent, { type: 'tool/call' }> => event.type === 'tool/call',
  )
  expect(calls.map(event => event.data.name)).toEqual(CORDIS_TOOLS)

  /** 用于关联结果的工具调用编号集合。 */
  const callIds = new Set(calls.map(event => String(event.data.callId)))
  /** 与目标调用关联的工具结果事件。 */
  const results = events.filter(
    (event): event is Extract<SessionEvent, { type: 'tool/result' }> =>
      event.type === 'tool/result' && callIds.has(String(event.data.message.source.callId)),
  )
  expect(results).toHaveLength(CORDIS_TOOLS.length)
  expect(results.every(event => !event.data.message.content[0].isError)).toBe(true)
}

describe('web e2e: Cordis tools use their owned cards', () => {
  /** 真实 Web 主机与工作区夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 驱动 Cordis 生命周期的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 本场景捕获的全部持久会话事件。 */
  const sessionEvents: SessionEvent[] = []
  const modelFrames: string[] = []
  const modelChanges: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      cordisTools: true,
      compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    scaffold.ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      if (key === 'modelSelection') modelChanges.push(`${String(seq)}:${JSON.stringify(value)}`)
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        const payload = String(frame.payload)
        if (payload.includes('modelSelection')) modelFrames.push(payload)
      })
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded Cordis lifecycle to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-drive'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT, STOP_PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const runTurnSettled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')

    // The approval is the TEST's action in every mode: the fixture pins what the
    // model said, and the gate is a real round trip through the real panel.
    const approve = page.locator('[data-cordis-approve]').first()
    await approve.waitFor({ timeout: 90_000 })
    // The one assertion this scenario cannot give up: the model asking to run is
    // NOT the plugin running. Until a person answers, the browser half has not
    // been fetched, evaluated, or mounted anywhere on this page.
    expect(await page.locator('[data-snapshot-probe]').count()).toBe(0)
    const sessionId = await runTurnSettled
    // Approving from idle makes the run-outcome steer a distinct continuation
    // turn, matching the recorded replay and keeping turn grouping deterministic.
    const approvalTurnSettled = scaffold.whenTurnSettled()
    await approve.click()
    await expect.poll(() => page.locator('[data-snapshot-probe]').count(), { timeout: 30_000 }).toBe(1)
    await approvalTurnSettled
    await expect.poll(() => page.getByText('The Cordis Plugin is running.', { exact: true }).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)
    await expect.poll(() => input.isEnabled(), { timeout: 15_000 }).toBe(true)
    const stopTurnSettled = scaffold.whenTurnSettled()
    await input.fill(STOP_PROMPT)
    await input.press('Enter')
    await stopTurnSettled
    await expect.poll(() => {
      const stop = sessionEvents.find(
        (event): event is Extract<SessionEvent, { type: 'tool/call' }> =>
          event.type === 'tool/call' && event.data.name === 'cordis_stop',
      )
      return stop !== undefined && sessionEvents.some(
        event => event.type === 'tool/result'
          && String(event.data.message.source.callId) === String(stop.data.callId),
      )
    }, { timeout: 15_000 }).toBe(true)
    if (MODE === 'record') {
      assertCompleteCordisLifecycle(sessionEvents)
      await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1)
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries one complete Cordis lifecycle', () => {
    assertCompleteCordisLifecycle(sessionEvents)
  })

  it.skipIf(MODE === 'record')('renders localized Cordis lifecycle cards', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-rows'))
    await expect.poll(() => page.getByText('CORDIS_UI_DONE', { exact: true }).count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1)

    const inspectRow = page.locator('[data-tool="cordis_inspect_self"]').filter({ hasText: 'Inspect' }).first()
    await expandOwningTurnProcess(page, inspectRow)
    await inspectRow.waitFor({ timeout: 10_000 })

    // cordis_define does NOT go through the generic row: ui-cordis registers a
    // keyed toolview for it, and a keyed hit replaces the generic card. So the
    // title here is the CARD's ("Cordis Plugin"), and the expanded body is the
    // card's own two code sections rather than a generic args dump.
    const defineRow = page.locator('[data-tool="cordis_define"]').filter({ hasText: 'Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, defineRow)
    await defineRow.waitFor({ timeout: 10_000 })
    // The whole summary row is the expand toggle (unified tool-row interaction).
    await defineRow.locator('[aria-expanded]').first().click()
    await expect.poll(() => defineRow.textContent(), { timeout: 10_000 }).toContain('data-snapshot-probe')
    await defineRow.getByRole('tab', { name: 'Host' }).click()
    await expect.poll(() => defineRow.textContent()).toContain(PACKAGE_CODE)

    const runRow = page.locator('[data-tool="cordis_run"]').filter({ hasText: 'Run Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, runRow)
    await runRow.waitFor({ timeout: 10_000 })
    await expect.poll(() => runRow.textContent()).toContain('snap-')

    const stopRow = page.locator('[data-tool="cordis_stop"]').filter({ hasText: 'Stop Cordis Plugin' }).first()
    await expandOwningTurnProcess(page, stopRow)
    await stopRow.waitFor({ timeout: 10_000 })
    await expect.poll(() => stopRow.textContent()).toContain('snap-')
    await expect(stopRow.getAttribute('data-state')).resolves.toBe('ok')
    // Stopping withdraws the browser half from every page, probe included.
    await expect.poll(() => page.locator('[data-snapshot-probe]').count(), { timeout: 15_000 }).toBe(0)
  })

  it.skipIf(MODE === 'record')('matches the conversation aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cordis-aria'))
    console.log('MODEL_TRACE', { modelChanges, frameCount: modelFrames.length, modelFrames })
    // Final Assistant text precedes turn/end. Three footers prove every turn
    // reached the render state covered by the ARIA golden.
    await expect.poll(
      () => page.getByRole('button', { name: 'Branch into a new conversation', exact: true }).count(),
      { timeout: 15_000 },
    ).toBe(3)
    await page.locator('[data-conversation-scroll]').evaluate((host) => { host.scrollTop = host.scrollHeight })
    await expect.poll(
      async () => page.getByRole('button', { name: 'Back to bottom', exact: true }).count(),
      { timeout: 10_000 },
    ).toBe(0)
    await page.mouse.move(0, 0)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors or reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
