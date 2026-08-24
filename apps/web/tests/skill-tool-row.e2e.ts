// Web e2e scenario: the real skill-load recording, seeded cold through the
// persistence seam, renders through ui-skill's keyed toolview without a model
// call. The disclosure proves replay-stable naming and exact durable output.
// 中文说明：真实技能加载记录经冷持久化恢复后由专用工具行呈现，无需模型调用即可验证名称和指令输出。
/**
 * 文件职责：验证 skill 工具调用在 Web 中使用专用可展开行，并展示精确的已记录技能指令。
 * 技术维度：使用 Playwright、Vitest、冷注入 ACP fixture、真实 ui-skill 工具视图和无障碍快照。
 * 产品维度：让用户清楚看到智能体加载了哪个技能，并可展开审阅实际注入的说明。
 * 逻辑维度：读取现有技能加载记录，冷注入会话，打开技能工具行，展开后比较名称、内容与快照。
 * 关键边界：录制模式跳过；不调用模型；fixture 用户提示必须与场景常量完全一致。
 * 新手阅读建议：先看 FIXTURE 与 PROMPT 的对应关系，再看 beforeAll 打开历史会话，最后读展开断言。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 借用 ACP 示例中真实录制的技能加载会话。 */
const FIXTURE = fileURLToPath(new URL('../../../examples/acp-agent/tests/snapshots/skill-load/session.jsonl', import.meta.url))
/** 专用技能工具行的快照目录。 */
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/skill-tool-row', import.meta.url))
/** 技能行展开后的预期无障碍快照。 */
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/skill-tool-row/ui.expected.md', import.meta.url))
/** 当前快照模式。 */
const MODE = webSnapshotMode()
/** 冷注入会话时使用的稳定标识。 */
const SEED_ID = 'skill-tool-row-web-e2e'
/** 录制技能工具调用的固定用户提示。 */
const PROMPT = 'Load the editing-cordis-compositions skill with the skill tool, then reply DONE.'

describe.skipIf(MODE === 'record')('web e2e: dedicated Skill tool row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.locator('[data-tool="skill"]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('expands the loaded skill to its exact recorded instructions', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-tool-row'))
    const call = page.locator('[data-tool="skill"]')
    const row = call.getByRole('button', { name: 'Skill editing-cordis-compositions' })
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
    expect(await call.getByText('editing-cordis-compositions', { exact: true }).count()).toBe(1)

    await row.click()
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
    await call.getByText('Instructions', { exact: true }).waitFor()
    const output = call.locator('pre')
    await output.waitFor()
    expect(await output.textContent()).toContain('<skill_content name="editing-cordis-compositions">')
    expect(await output.textContent()).toContain('Each Bundle registers its dormant default provider and exclusively uses its pinned package-local platform CLI')
    expect(await output.evaluate(element => getComputedStyle(element.parentElement!).maxHeight)).toBe('260px')

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
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
