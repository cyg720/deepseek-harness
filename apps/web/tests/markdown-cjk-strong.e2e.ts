/**
 * 文件职责：验证 Markdown 粗体后紧邻中英文标点与中文文本时仍能正确解析和显示。
 * 技术维度：使用 Vitest、Playwright、会话事件模型和无障碍快照构造并检查真实 Web 渲染。
 * 产品维度：避免中文回答中的重点文字因标点相邻而丢失粗体或拆坏段落。
 * 逻辑维度：生成固定会话日志，注入 Web 脚手架，再逐项核对粗体文本、段落和快照。
 * 关键边界：只覆盖 CASES 中列出的标点组合，且回放模式不会调用真实模型。
 * 新手阅读建议：先看 CASES 的输入与期望三元组，再读 markdownFixture 如何写入会话事件。
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-cjk-strong', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-cjk-strong/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
/** 注入脚手架时使用的稳定会话标识。 */
const SEED_ID = 'markdown-cjk-strong-web-e2e'
/** 用于确认助手回复完整渲染的尾部标记。 */
const DONE = 'CJK_STRONG_DONE'
/** 每项依次包含 Markdown 输入、粗体文本和完整段落期望。 */
const CASES = [
  ['**注意：**内容', '注意：', '注意：内容'],
  ['**Notice:**内容', 'Notice:', 'Notice:内容'],
  ['**事件中间件（waterfall）**实现', '事件中间件（waterfall）', '事件中间件（waterfall）实现'],
  ['**事件中间件(waterfall)**实现', '事件中间件(waterfall)', '事件中间件(waterfall)实现'],
  ['**句号。**后续', '句号。', '句号。后续'],
  ['**Period.**后续', 'Period.', 'Period.后续'],
  ['**提醒！**继续', '提醒！', '提醒！继续'],
  ['**Warning!**继续', 'Warning!', 'Warning!继续'],
] as const

/** Build one settled assistant reply covering CJK-adjacent strong punctuation boundaries. */
/* 构造覆盖中日韩文本相邻粗体标点的已完成助手回复，并返回可注入的 JSONL。 */
function markdownFixture(): string {
  /** 在内存中累积测试事件的源会话。 */
  const session = Session.create(SessionId('markdown-cjk-strong-source'))
  /** 固定事件时间的当天中午起点，减少快照随运行时间变化。 */
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  /** 写入会话并供标题来源引用的用户消息事件。 */
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Render adjacent CJK strong emphasis.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'CJK strong emphasis',
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
          '## CJK strong emphasis',
          '',
          ...CASES.flatMap(([markdown]) => [markdown, '']),
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

describe('web e2e: CJK-adjacent Markdown strong emphasis', () => {
  /** 承载注入会话和 Web 服务的测试脚手架。 */
  let scaffold: WebScaffold
  /** 执行真实页面渲染的 Chromium 实例。 */
  let browser: Browser
  /** 当前测试操作的英文界面页面。 */
  let page: Page
  /** 收集页面错误与警告的控制台监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, markdownFixture(), SEED_ID)
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

  it.skipIf(MODE === 'record')('renders punctuation-terminated strong spans before adjacent CJK text', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-cjk-strong'))
    /** 会话侧栏中的工作区树项。 */
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    /** 工作区展开后出现的固定会话树项。 */
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    /** 回复 Markdown 区域中解析出的全部粗体元素。 */
    const strong = page.locator('[class*="markdown"] strong')
    await expect.poll(() => strong.count(), { timeout: 10_000 }).toBe(CASES.length)
    expect(await strong.allTextContents()).toEqual(CASES.map(([, expected]) => expected))
    for (const [, , paragraph] of CASES) {
      expect(await page.getByText(paragraph, { exact: true }).count()).toBe(1)
    }

    /** 将动态种子标识归一化后的会话主体快照。 */
    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
