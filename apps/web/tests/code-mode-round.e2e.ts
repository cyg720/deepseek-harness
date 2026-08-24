// Web e2e scenario: a Code Mode round trip. The scaffold boots the SAME
// shipped tree with the tools row patched to mode: code (the run_code-only
// wire), a real chromium sends a prompt engineered to elicit one run_code
// program with several sub-calls, and the UI must render the code-variant
// parent row with its always-visible nested sub-rows — each sub-row the same
// component a native call renders through — plus details-panel resolution for
// a clicked sub-row. Drive steps wait only on generic completion
// (whenTurnSettled); assertion steps run in replay/refresh only.
// Record: DSH_SNAPSHOT=record rewrites session.jsonl, then a keyless
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
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** Code Mode 回放会话日志。 */
const FIXTURE = fileURLToPath(new URL('./snapshots/code-mode-round/session.jsonl', import.meta.url))
/** Code Mode 聊天区域 ARIA 黄金文件。 */
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/code-mode-round/ui.expected.md', import.meta.url))
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()

// The scenario's one drive prompt: elicits one program with a bash sub-call
// and a failing read the program tolerates — the sub-row set the assertions
// need. Never asserted against model prose.
// 唯一驱动提示制造 Bash 成功和 read 失败两个子行，不对模型自然语言措辞做断言。
/** 诱导一个包含成功 Bash 与容错失败读取的 run_code 程序。 */
const PROMPT = 'Using ONE run_code program: run bash `echo CODE_ROUND_OK`, then read the file missing.txt '
  + 'catching its error in the program. Return an object with both outcomes. Then reply DONE and stop.'

describe('web e2e: Code Mode round renders nested sub-calls', () => {
  /** 真实 Web 主机与工作区夹具。 */
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
      toolsMode: 'code',
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connect a Workspace so the composer scenarios start live.
    // 连接全新工作区，使编辑器从真实空白会话开始。
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-drive'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      // 漂移防护：已提交夹具必须只包含这一条驱动提示。
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    /** 当前可用的聊天编辑器。 */
    const input = page.locator('textarea').first()
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
    // Wire discipline: code mode collapsed the call surface to run_code.
    // 线协议约束：代码模式把模型可见调用面收敛到 run_code。
    /** 持久日志中的全部模型工具调用事件。 */
    const calls = sessionEvents.filter(event => event.type === 'tool/call')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(new Set(calls.map(call => (call.data as { name: string }).name))).toEqual(new Set(['run_code']))
    // Sub-dispatches logged with the complete tool/result vocabulary.
    // 每次子分发用完整工具结果词汇记录，便于恢复相同 UI。
    /** run_code 内部持久化的子工具分发事件。 */
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
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-rows'))
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // The parent run_code row wears the code variant with the model-authored
    // description as its summary (the presentCall contract).
    // run_code 父行使用 code 变体，并以模型提供的 description 作为摘要。
    /** run_code 的 code 变体父行。 */
    const codeRow = page.locator('[data-variant="code"]').first()
    await codeRow.waitFor({ timeout: 10_000 })
    // Nested rows are visible WITHOUT any expand interaction, inside the
    // sub-call nest, each rendered by the same components as native rows:
    // the bash sub-call landed in the bash sample registration.
    // 子行无需展开即可显示，并复用原生工具组件；Bash 子调用进入同一注册表。
    /** 始终可见的 run_code 子调用容器。 */
    const nest = page.locator('[data-subcalls]').first()
    await nest.waitFor({ timeout: 10_000 })
    expect(await nest.locator('[data-sample="bash"]').count()).toBeGreaterThanOrEqual(1)
    // The failing read sub-call wears the same error state a native failed
    // row wears (the recorded program tolerates a read of missing.txt).
    // 失败 read 子调用使用与原生失败工具行相同的错误状态。
    expect(await nest.locator('[data-state="error"]').count()).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it.skipIf(MODE === 'record')('a bash sub-row click leaves the default details panel closed', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-details'))
    /** run_code 子调用容器。 */
    const nest = page.locator('[data-subcalls]').first()
    /** 带详情列折叠状态的应用框架。 */
    const frame = page.locator('[style*="grid-template-columns"]').first()
    expect(await frame.getAttribute('data-details-collapsed')).toBe('true')
    await nest.locator('[data-sample="bash"]').first().click()
    // Tool rows do not drive layout geometry; the Session's default panel stays closed.
    // 工具行点击不负责改变布局几何，会话默认详情面板保持关闭。
    await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
  })

  it.skipIf(MODE === 'record')('matches the conversation aria golden with stable anchors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-code-mode-aria'))
    /** 归一化后的聊天中心列 ARIA 树。 */
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors, no reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
