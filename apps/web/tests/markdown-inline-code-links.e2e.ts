/**
 * 文件职责：验证 Markdown 行内代码中的安全 URL 可点击，而命令文本与危险协议保持普通代码。
 * 技术维度：使用 Session API 生成固定会话，并通过 Vitest、Playwright 与无障碍快照检查浏览器行为。
 * 产品维度：方便用户直接打开模型给出的本地预览地址，同时避免误把命令或脚本协议变成链接。
 * 逻辑维度：构造含多种代码片段的回复，注入页面，检查链接属性、弹窗行为和稳定快照。
 * 关键边界：只有完整且受支持的 URL 才可链接；javascript 协议和带命令前缀的代码必须惰性显示。
 * 新手阅读建议：先读 markdownFixture 中四种样例，再看浏览器测试如何区分链接和普通 code 元素。
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-inline-code-links', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-inline-code-links/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
/** 注入脚手架时使用的稳定会话标识。 */
const SEED_ID = 'markdown-inline-code-links-web-e2e'
/** 确认整段回复渲染完成的尾部标记。 */
const DONE = 'INLINE_CODE_LINK_DONE'

/** Build a settled assistant reply with linkable URL code and inert code controls. */
/* 用 linkUrl 构造已完成回复并返回 JSONL；示例：markdownFixture('http://127.0.0.1:3000')。 */
function markdownFixture(linkUrl: string): string {
  /** 累积固定事件的内存会话。 */
  const session = Session.create(SessionId('markdown-inline-code-links-source'))
  /** 固定事件时间起点，避免快照随当前时间漂移。 */
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  /** 供会话标题引用的用户消息事件。 */
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show the local preview URL.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Inline code links',
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
          '## Inline code links',
          '',
          `Preview: \`${linkUrl}\``,
          '',
          `Standard: [Open preview](${linkUrl})`,
          '',
          `Command: \`curl ${linkUrl}\``,
          '',
          'Unsafe: `javascript:alert(1)`',
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

describe('web e2e: Markdown inline-code links', () => {
  /** 提供真实 Web 服务和会话注入能力的脚手架。 */
  let scaffold: WebScaffold
  /** 执行链接交互的 Chromium 实例。 */
  let browser: Browser
  /** 当前场景页面。 */
  let page: Page
  /** 注入回复并期望打开的本地预览地址。 */
  let linkUrl: string
  /** 页面错误与警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    linkUrl = new URL('/?demo=1', scaffold.baseUrl).toString()
    await seedSession(scaffold, markdownFixture(linkUrl), SEED_ID)
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

  it.skipIf(MODE === 'record')('opens a complete HTTP URL from inline code and leaves other code inert', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-inline-code-links'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const inlineCodeLink = page.locator('[class*="markdown"] code a')
    await expect.poll(() => inlineCodeLink.count(), { timeout: 10_000 }).toBe(1)
    expect(await inlineCodeLink.getAttribute('href')).toBe(linkUrl)
    expect(await inlineCodeLink.getAttribute('target')).toBe('_blank')
    expect(await inlineCodeLink.getAttribute('rel')).toBe('noopener noreferrer')
    await inlineCodeLink.focus()
    expect(await inlineCodeLink.evaluate(element => document.activeElement === element)).toBe(true)

    const popupPromise = page.waitForEvent('popup')
    await inlineCodeLink.click()
    const popup = await popupPromise
    await popup.waitForURL(linkUrl, { timeout: 15_000 })
    expect(popup.url()).toBe(linkUrl)
    await popup.close()

    expect(await page.getByText(`curl ${linkUrl}`, { exact: true }).locator('a').count()).toBe(0)
    expect(await page.getByText('javascript:alert(1)', { exact: true }).locator('a').count()).toBe(0)
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
      .split(linkUrl).join('{{linkUrl}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
