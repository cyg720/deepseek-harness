/**
 * 文件职责：验证助手 Markdown 中各类数学公式分隔符在真实浏览器中正确渲染。
 * 技术维度：使用 Session API、Vitest、Playwright、数学渲染插件和无障碍快照。
 * 产品维度：保障技术与科研回答中的行内公式、块级公式和表格内公式保持可读。
 * 逻辑维度：构造覆盖所有支持分隔符的固定回复，注入页面后检查公式节点与快照。
 * 关键边界：只验证项目声明支持的分隔符，不执行真实模型请求；动态种子标识会被归一化。
 * 新手阅读建议：先看 mathFixture 的公式样例，再看测试对渲染数量、文本和快照的断言。
 */
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/math-rendering', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/math-rendering/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
/** 注入测试会话时使用的稳定标识。 */
const SEED_ID = 'math-rendering-web-e2e'
/** 确认回复完整渲染的尾部标记。 */
const DONE = 'MATH_RENDERING_DONE'

/** Build a settled assistant reply that exercises every supported math delimiter. */
/* 构造覆盖全部受支持公式分隔符的已完成回复并返回 JSONL。示例：mathFixture()。 */
function mathFixture(): string {
  /** 累积数学回复事件的内存会话。 */
  const session = Session.create(SessionId('math-rendering-source'))
  /** 固定事件时间起点，减少快照变化。 */
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', {
    turn: 1,
  })
  /** 供会话标题来源引用的用户消息事件。 */
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Render this mathematical proof.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Math rendering',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: [
          '## Math rendering',
          '',
          'Inline dollar $\\theta$ and backslash \\(\\frac{1}{5}\\).',
          '',
          '\\[\\frac{\\pi}{4} < \\theta < \\frac{\\pi}{2}\\]',
          '',
          '$$\\theta \\in \\left(\\frac{\\pi}{4}, \\frac{\\pi}{2}\\right). \\tag{1}$$',
          '',
          '| Symbol | Value |',
          '| --- | --- |',
          '| $\\theta$ | \\(\\frac{1}{5}\\) |',
          '',
          DONE,
        ].join('\n'),
      }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
      isSeeded: false,
      delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: settled Markdown math rendering', () => {
  /** 提供 Web 服务与会话注入的脚手架。 */
  let scaffold: WebScaffold
  /** 执行真实公式布局的 Chromium 实例。 */
  let browser: Browser
  /** 当前场景页面。 */
  let page: Page
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, mathFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders the settled reply without KaTeX errors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-math-rendering'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    await expect.poll(() => page.locator('.katex').count(), { timeout: 10_000 }).toBe(6)
    await expect.poll(() => page.locator('.katex-display').count(), { timeout: 10_000 }).toBe(2)
    expect(await page.locator('.katex-error').count()).toBe(0)
    await expect.poll(
      () => page.getByText('1 turns · 1 steps', { exact: false }).count(),
      { timeout: 10_000 },
    ).toBe(1)

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
