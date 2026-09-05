// Web e2e scenario: a user invokes a disable-model-invocation skill through
// the composer (issue #1470). The entered `/name args` line claims into
// skill.invoke: the real host forwards the gesture as an ordinary user
// prompt, injects the rendered body as instructions context named after the
// skill, and starts a turn answered by the replay adapter. The transcript shows
// the gesture bubble, the collapsed context-injection row, and the reply.
// 中文说明：用户输入 /name args 后，真实主机把技能正文作为指令上下文注入，并由回放模型完成普通回合。
/**
 * 文件职责：验证用户可通过编辑器显式调用禁止模型自主调用的技能，并把参数与技能正文送入回合。
 * 技术维度：使用 Playwright、Vitest、临时 SKILL.md、回放覆盖、真实 skill.invoke 和无障碍快照。
 * 产品维度：允许用户主动使用模型不可自行选择的敏感或专用技能，同时保留透明的上下文记录。
 * 逻辑维度：写入仅用户技能，生成固定回放响应，输入斜杠命令，等待完成并检查消息、上下文行和回复。
 * 关键边界：技能必须标记 disable-model-invocation；录制模式跳过；临时目录和脚手架必须清理。
 * 新手阅读建议：先读 seedUserOnlySkill 的 frontmatter，再看 REPLAY，最后跟踪斜杠命令产生的三类会话行。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import {
  assertFixtureInventory,
  captureExpandedTurnProcessAria,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/skill-user-invoke', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const UI_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'ui-expanded.expected.md')
const MODE = webSnapshotMode()

/** 临时仅用户技能的调用名称。 */
const SKILL_NAME = 'user-invoke-demo'
/** 斜杠命令传给技能的附加参数文本。 */
const ARGS_TEXT = 'and confirm the fixture wiring'
/** 回放模型返回的固定确认文本。 */
const REPLY = 'USER_INVOKE_REPLY acknowledged; following the injected skill.'

/** 在 workspaceCwd 下写入仅用户可调用的技能，无返回值。 */
async function seedUserOnlySkill(workspaceCwd: string): Promise<void> {
  const directory = join(workspaceCwd, 'workspace', '.agents', 'skills', SKILL_NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Prove user-explicit invocation of a model-hidden skill',
    'disable-model-invocation: true',
    '---',
    '',
    'Reply with the fixture acknowledgement line.',
    '',
  ].join('\n'))
}

/** 为一次技能调用回合提供完整固定文本响应的回放脚本。 */
const REPLAY: ReplayOverrideDoc = [{
  kind: 'chunks',
  chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: REPLY },
    { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } },
    { type: 'usage', usage: { inputTokens: 256, outputTokens: 16 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
}]

describe.skipIf(MODE === 'record')('web e2e: user-explicit skill invocation through the composer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let replayDir: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-skill-user-invoke-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(REPLAY))
    scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'),
      replayOverride,
      // Paced replay keeps the timing-derived chrome (TTFT / tok/s) present
      // deterministically; instant playback races it in and out of the golden.
      paceMs: 10,
    })
    await seedUserOnlySkill(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (replayDir !== undefined) {
      await rm(replayDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'skill-user-invoke e2e cleanup failed')
  })

  it('claims /name args into a gesture bubble, an injection row, and a replayed answer', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-user-invoke'))
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    await composer.waitFor({ timeout: 15_000 })

    // The menu lists the user-only skill (its only entry point) before enter.
    await composer.fill(`/${SKILL_NAME}`)
    const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
    await expect.poll(
      () => menu.getByRole('option', { name: new RegExp(SKILL_NAME) }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    const settled = scaffold.whenTurnSettled()
    await composer.fill(`/${SKILL_NAME} ${ARGS_TEXT}`)
    await composer.press('Enter')

    // The gesture stays an ordinary user bubble (decorated /name token plus
    // the trailing text), ahead of the injected context.
    const bubble = page.locator('[data-ref-chip="skill"]').first()
    await bubble.waitFor({ timeout: 15_000 })
    expect(await bubble.textContent()).toBe(`/${SKILL_NAME}`)

    // The rendered body arrives as a context-injection row named after the
    // skill. Context plus the final answer contributes no summary count, so
    // the Turn uses the fallback title while the row's own disclosure remains usable.
    const injectionFlow = page.locator('[data-chat-flow-kind="context"]').filter({ hasText: SKILL_NAME })
    await injectionFlow.waitFor({ state: 'attached', timeout: 15_000 })
    await page.getByText('USER_INVOKE_REPLY', { exact: false }).first().waitFor({ timeout: 20_000 })
    await settled
    const process = page.getByRole('button', { name: 'Thought for a while', exact: true })
    await process.waitFor({ state: 'visible', timeout: 10_000 })
    // The chip derives from the step's logged injection, so it must survive
    // every later Node rebuild of the Turn (process publication, turn close).
    expect(await bubble.count()).toBe(1)
    expect(await bubble.textContent()).toBe(`/${SKILL_NAME}`)
    await expandOwningTurnProcess(page, injectionFlow)
    const injectionRow = page.getByRole('button', { name: `Context injection ${SKILL_NAME}` })
    await injectionRow.click()
    const injectionBody = page
      .locator('[data-context-injection-body]')
      .filter({ hasText: `<skill_content name="${SKILL_NAME}">` })
    await injectionBody.waitFor({ timeout: 10_000 })
    const injected = await injectionBody.textContent()
    expect(injected).toContain('Reply with the fixture acknowledgement line.')
    expect(injected).not.toContain(ARGS_TEXT)
    await injectionRow.click()
    await process.click()

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md', 'ui-expanded.expected.md'])
  })
})
