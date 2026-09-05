// Web e2e scenario: inline-code file mentions in the closing prose. Cold-seeds
// a built write turn (zero model calls) whose closing message names the written
// file three ways: by unique basename (links), ambiguously (stays inert), and
// as a file the turn never touched (stays inert). Package tests cover the
// resolver in isolation; only the assembled application shows a real write's
// locations reaching the prose as an opener. The click itself is not driven
// here: it hands the path to the Host's opener, which would launch a real
// application on the machine running the suite (the produced-files restraint).
// 中文说明：测试只确认可点击文件提及的解析与展示，不实际点击，以免主机在测试机上启动原生应用。
/**
 * 文件职责：验证完成回复中的行内代码文件名只在能唯一对应本轮写入文件时变成打开按钮。
 * 技术维度：使用 Session API 构造写工具事件，并通过 Playwright、Vitest 检查组装 Web 界面。
 * 产品维度：让用户能从回答直接打开刚生成的文件，同时避免歧义名称或未生成文件造成误跳转。
 * 逻辑维度：构造三次写入和包含唯一、歧义、未知提及的结束回复，注入页面后检查按钮集合。
 * 关键边界：不触发真实 Host 文件打开；同名 style.css 必须保持惰性；测试零模型调用。
 * 新手阅读建议：先看 WRITES 与结束回复的三类提及，再读 mentionFixture 中工具事件和最终定位断言。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 注入构造会话时使用的稳定标识。 */
const SEED_ID = 'produced-file-mentions-web-e2e'
/** 确认结束回复完全渲染的尾部标记。 */
const DONE = 'FILE_MENTION_DONE'

/** One-part text content for a built message. */
/* 将 value 包装成单段文本内容，返回消息内容数组。示例：text('done')。 */
function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** The files the built turn writes; `notes.md` is named in prose but never written. */
/* 本轮实际写入的三个相对路径；notes.md 只会在回复中出现。 */
const WRITES = ['site/report.html', 'a/style.css', 'b/style.css']

/** Build a settled write turn whose closing prose mentions files in inline code. */
/* 构造含写入事件与文件提及的已完成会话 JSONL。示例：mentionFixture()。 */
function mentionFixture(): string {
  /** 累积固定写入回合事件的内存会话。 */
  const session = Session.create(SessionId('produced-file-mentions-source'))
  /** 固定事件时间起点，减少运行时间差异。 */
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Write the report page and both stylesheets.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Produced file mentions',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  /** 每个写入路径对应的稳定工具调用元数据。 */
  const calls = WRITES.map((path, index) => ({
    path,
    callId: ToolCallId(`file-mention-${String(index)}`),
    args: JSON.stringify({ file_path: path, content: `content of ${path}\n` }),
  }))
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: calls.map(call => ({
        type: 'tool-call' as const,
        id: call.callId,
        name: 'write',
        arguments: call.args,
      })),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  for (const call of calls) {
    const source = session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: call.callId,
      name: 'write',
      arguments: call.args,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: text(`Created ${call.path}`),
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{
        type: 'text',
        text: [
          'Wrote `report.html` plus two `style.css` copies; `notes.md` untouched.',
          '',
          DONE,
        ].join('\n'),
      }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
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

describe('web e2e: inline-code mentions of produced files', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, mentionFixture(), SEED_ID)
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

  it.skipIf(MODE === 'record')('links the unique mention and leaves ambiguous and unknown code inert', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-produced-file-mentions'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    // Exactly one prose mention links: `report.html` resolves to the written
    // path; the shared `style.css` basename and unwritten `notes.md` stay code.
    const mentions = page.locator('[class*="markdown"] code button')
    await expect.poll(() => mentions.count(), { timeout: 10_000 }).toBe(1)
    expect(await mentions.first().innerText()).toBe('report.html')
    expect(await mentions.first().getAttribute('aria-label')).toBe('Open site/report.html')
    expect(await mentions.first().getAttribute('title')).toBe('site/report.html')
    // The turn still ends with its produced-files row (all three writes).
    expect(await page.getByText('Produced', { exact: true }).count()).toBe(1)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
