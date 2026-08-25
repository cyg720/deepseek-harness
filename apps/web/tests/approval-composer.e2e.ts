// Web e2e scenario: the composer-takeover approval panel under a long
// command. The shipped composition confines bash through the sandbox policy
// and routes its escalation through the approval seam, so a read-only session
// asked to write a file produces a REAL pending approval — the panel renders
// in the browser, the test measures its geometry, answers through it, and the
// escalated command then runs. Replay is deterministic: the denial, the
// escalation retry and its command text arrive from replayed chunks, and the
// answer click is the test's own gesture (the same sanctioned reaction to
// model content as the question composer: the turn cannot complete without it).
//
// Geometry is the point of the scenario. The command is unbounded model text,
// and an uncapped card grows with it until the refuse/allow buttons leave the
// viewport — an approval the user could see and not answer.
// 命令文本无长度上限，若卡片不限制高度，操作按钮可能被推到视口外而无法回答。
/**
 * 文件职责：端到端验证长命令审批接管编辑器时的高度限制、操作可达性和批准执行结果。
 * 技术维度：使用 Playwright、真实沙箱审批链、模型回放夹具、几何测量和 ARIA 快照。
 * 产品维度：即使模型生成很长命令，用户仍能看到并操作拒绝/允许按钮，批准后命令正常执行。
 * 逻辑维度：发起只读写文件请求，等待真实审批，比较面板快照，在两种视口测量后允许一次。
 * 关键边界：记录模式会重录模型夹具；跨平台拒绝文本不同，因此完成态用文件和事件验证。
 * 新手阅读建议：先看 TOKENS 为何必须足够长，再读编辑器高度探针与审批面板几何对比。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import: carries the approval package's session-event merge, so
// the decided-outcome assertion below type-checks against the real union.
// 空类型导入让审批包的会话事件声明合并生效，下面可按真实联合类型检查结果。
import type {} from '@deepseek-ai/dsh-user-approval'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** 本场景夹具和黄金文件目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/approval-composer', import.meta.url))
/** 确定性模型回放会话夹具。 */
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
// The scenario's one golden: the waiting panel. Everything the answered state
// proves is asserted directly — see the world-state block at the end.
// 唯一黄金文件只固定等待面板；回答后的状态由文件、事件和 DOM 直接验证。
/** 等待用户回答时的审批面板 ARIA 快照。 */
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
/** 当前快照运行模式。 */
const MODE = webSnapshotMode()

// Irreducible payload: the command has to be long enough to pass the card's
// height cap, which is the only command length that reproduces an action row pushed off
// screen. Unrelated tokens, not a repeated word — a repeated word is what the
// model compressed into `printf 'alpha %.0s' {1..400}` while recording, and a
// short command proves nothing here. The formula keeps the source small; the
// model receives the expanded literal it has to put in the command.
// 载荷必须超过卡片高度上限，且使用不同词元避免模型把重复词压缩成短命令。
/** 生成足够长且不易压缩的命令文本内容。 */
const TOKENS = Array.from({ length: 220 }, (_, index) => `tok${((index + 1) * 7919 % 99991).toString(36)}`).join(' ')
/** 要求模型用单条 Bash 命令写入长文本的用户提示。 */
const PROMPT = `Write a file named notes.txt in the workspace containing exactly this text on one line: ${TOKENS}. Use one bash command with the literal text inline. Then reply with the single word DONE and stop.`

/** Draft used to measure the composer's own text cap: enough lines to pass it. */
/* 用于测量普通编辑器文本上限的多行草稿。 */
const CAP_PROBE = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')

describe('web e2e: approval takeover keeps its actions reachable', () => {
  /** 真实 Web 主机与工作区夹具。 */
  let scaffold: WebScaffold
  /** 本场景的 Chromium 实例。 */
  let browser: Browser
  /** 执行审批交互的页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>
  /** 本场景捕获的会话事件，用于验证批准结果已持久化。 */
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('caps the long command, answers through the panel, and runs the escalated command', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-approval'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })

    // The composer's own text cap, measured on the live draft scrollport before
    // the takeover replaces it — the box that carries the cap, while the
    // textarea inside it is as tall as the whole draft. The panel's scroll
    // region must stop at the same height (the designer's requirement: one cap
    // for the composer seat), and measuring it here keeps the assertion free of
    // the px value itself.
    await input.fill(CAP_PROBE)
    const composerCap = await input.evaluate(el => el.closest('[data-input-scroll]')?.clientHeight ?? 0)
    expect(composerCap).toBeGreaterThan(0)
    await input.fill('')

    // Read-only: the mode whose denial the model escalates from. Switched
    // through the shipped access-mode chip, not a test-only override.
    await page.locator('[aria-label^="Access mode"]').click()
    await page.getByRole('menuitem', { name: 'Read Only' }).click()
    await expect.poll(
      () => page.locator('[aria-label="Access mode, current: Read Only"]').count(),
      { timeout: 15_000 },
    ).toBe(1)

    const settled = scaffold.whenTurnSettled(MODE === 'record' ? 240_000 : 60_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    // The panel takes over the input area while the tool blocks. Its presence
    // is a STABLE waiting state (it stays until answered), so waitFor is
    // race-free.
    const panel = page.locator('[data-approval-key]')
    await panel.waitFor({ timeout: MODE === 'record' ? 180_000 : 60_000 })
    const scroll = panel.locator('[data-approval-scroll]')
    await expect.poll(() => scroll.getByText(/tok/).count(), { timeout: 15_000 }).toBeGreaterThan(0)

    if (MODE !== 'record') {
      // This golden owns the stable waiting surface; the answered golden below
      // owns the resulting transcript.
      const snapshot = await captureStableAria(page, '[data-approval-key]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

      // The uncapped-card hazard the header names, measured at the lane
      // baseline and at a short viewport, on the live panel.
      const original = page.viewportSize() ?? { width: 1680, height: 1000 }
      for (const height of [1000, 700]) {
        await page.setViewportSize({ width: 900, height })
        const geometry = await panel.evaluate((root) => {
          const region = root.querySelector<HTMLElement>('[data-approval-scroll]')
          const card = region?.parentElement ?? null
          // Role/text, not the CSS-module class names: the built client hashes those.
          const buttons = [...root.querySelectorAll<HTMLElement>('button')]
          const rows = buttons.map(button => button.getBoundingClientRect())
          return {
            buttons: buttons.length,
            capped: region === null ? 0 : region.clientHeight,
            // A scrolling region proves the cap is genuinely engaged; without
            // it every assertion below would hold vacuously.
            scrolls: region === null ? false : region.scrollHeight > region.clientHeight,
            cardBottom: card === null ? Number.NaN : card.getBoundingClientRect().bottom,
            actionsTop: Math.min(...rows.map(rect => rect.top)),
            actionsBottom: Math.max(...rows.map(rect => rect.bottom)),
            viewport: window.innerHeight,
          }
        })
        expect(geometry.buttons).toBe(2)
        expect(geometry.scrolls).toBe(true)
        // One cap for the seat: the panel's text region stops where the
        // composer draft does (sub-pixel tolerance for the shared padding).
        expect(Math.abs(geometry.capped - composerCap)).toBeLessThan(1)
        // Both buttons stay inside the card AND inside the viewport — the
        // answerable state the cap exists to guarantee.
        expect(geometry.actionsTop).toBeGreaterThan(0)
        expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.viewport)
        expect(geometry.actionsBottom).toBeLessThanOrEqual(geometry.cardBottom)
      }
      await page.setViewportSize(original)
    }

    await panel.getByRole('button', { name: 'Allow once' }).click()

    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
      return
    }
    // World state: the granted escalation is what let the command run, and the
    // panel leaves with the regular composer restored. Asserted on the world
    // and the DOM rather than through a transcript golden — the denied first
    // attempt renders the OS's own refusal ("Operation not permitted" on
    // macOS, "Read-only file system" on Linux), so the answered transcript is
    // not a platform-neutral golden surface.
    expect(JSON.stringify(sessionEvents.filter(e => e.type === 'approval/decided').at(-1)))
      .toContain('allowed-once')
    const written = await readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')
    expect(written).toContain(TOKENS.slice(0, 64))
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(1)
    expect(await page.locator('[data-approval-key]').count()).toBe(0)
    await expect.poll(() => page.locator('textarea').first().isEnabled(), { timeout: 10_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 300_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ui.expected.md'])
  })
})
