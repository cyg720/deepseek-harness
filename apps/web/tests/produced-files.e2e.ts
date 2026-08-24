// Web e2e scenario: the single-line produced-files summary a finished turn
// ends with. Cold-seeds ten writes (zero model calls), then verifies the real
// assembled lane keeps a precise +N and a capability-gated folder handoff.
// The folder request is intercepted so one real browser click can exercise
// the full client carrier without launching a native application in CI.
// 中文说明：拦截文件夹打开请求，使真实浏览器点击覆盖完整客户端链路而不会在 CI 启动原生应用。
/**
 * 文件职责：验证已完成回合末尾生成文件摘要的数量折叠、单行布局和“在文件夹中显示”交接。
 * 技术维度：使用 Session API 构造十次写入，并通过 Playwright、Vitest 与 Host 方法侦听检查界面。
 * 产品维度：让用户快速看到本轮创建的主要文件、剩余数量，并能跳转到输出目录。
 * 逻辑维度：注入十次成功写入，定位摘要行，检查可见文件与 +N，拦截并验证文件夹打开请求。
 * 关键边界：窄布局必须保持单行；原生打开动作必须被侦听替代；全程零模型调用。
 * 新手阅读建议：先看 PRODUCED 的文件顺序，再读 producedFixture，最后看按钮、+N 和几何断言。
 */
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 当前快照运行模式。 */
const MODE = webSnapshotMode()
/** 为场景启用所需 Host 文件打开能力的组合覆盖文件。 */
const OVERLAY = fileURLToPath(new URL('./produced-files.overlay.yml', import.meta.url))
/** 注入构造会话时使用的稳定标识。 */
const SEED_ID = 'produced-files-web-e2e'
/** 确认结束回复渲染完成的尾部标记。 */
const DONE = 'PRODUCED_FILES_DONE'

/** Short leading names plus a long third name make the narrow lane deterministically show two. */
/** 十个生成文件按显示顺序排列，第三个长名称使窄布局稳定只显示前两个。 */
const PRODUCED = [
  '关于我.md',
  'index.html',
  'long-generated-experience-specification-for-produced-files-overflow.md',
  'styles.css',
  'app.ts',
  'schema.json',
  'README.md',
  'preview.svg',
  'notes.txt',
  'manifest.yaml',
] as const

/** Build one settled turn whose successful write calls carry ten locations. */
/** 构造十次成功写入的已完成会话 JSONL。示例：producedFixture()。 */
function producedFixture(): string {
  /** 累积生成文件回合事件的内存会话。 */
  const session = Session.create(SessionId('produced-files-source'))
  /** 固定事件时间起点，减少快照随时间变化。 */
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Create the site files.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Produced files overflow', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  /** 每个生成路径对应的稳定写工具调用元数据。 */
  const calls = PRODUCED.map((path, index) => ({
    path,
    callId: CallId(`produced-files-${String(index)}`),
    args: JSON.stringify({ file_path: path, content: `content of ${path}\n` }),
  }))
  session.append('assistant/message', {
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
      turn: 1, step: 1, callId: call.callId, name: 'write', arguments: call.args,
    })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: call.callId,
        content: [{ type: 'text', text: `Created ${call.path}` }],
        isError: false,
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  }
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1,
    step: 2,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Created the site.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: a finished turn ends with the files it produced', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await seedSession(scaffold, producedFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    // Keep the responsive sidebar available while selecting the cold seed;
    // the assertion itself narrows the conversation after navigation.
    await page.setViewportSize({ width: 1280, height: 900 })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('keeps a narrow ten-file summary on one line with +8 and a folder action', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-produced-files'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    await page.setViewportSize({ width: 780, height: 900 })
    const row = page.locator('[data-produced-files-row]')
    await row.waitFor({ timeout: 15_000 })
    const chips = row.getByRole('button')
    await expect.poll(() => chips.count()).toBe(2)
    expect(await chips.nth(0).innerText()).toBe('关于我.md')
    expect(await chips.nth(1).innerText()).toBe('index.html')
    expect(await row.getByText('+ 8 files', { exact: true }).count()).toBe(1)
    const showFolder = page.getByRole('button', { name: 'Show in folder', exact: true })
    expect(await showFolder.count()).toBe(1)
    expect(await page.getByText('Produced', { exact: true }).count()).toBe(1)

    const openPath = vi.spyOn(scaffold.ctx.apiProxy.host, 'openPath')
      .mockImplementation(async (request, _signal) => ({
        rpcId: request.rpcId,
        result: { ok: true, value: { opened: true as const } },
      }))
    try {
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/host.openPath'),
        showFolder.click({ clickCount: 1 }),
      ])
      expect(response.status()).toBe(200)
      expect(openPath).toHaveBeenCalledTimes(1)
      expect(openPath.mock.calls[0]![0].payload).toEqual({ path: `${scaffold.workspaceCwd}/.` })
    } finally {
      openPath.mockRestore()
    }

    const tops = await row.locator(':scope > *').evaluateAll(elements =>
      elements.map(element => element.getBoundingClientRect().top))
    expect(new Set(tops.map(top => Math.round(top))).size).toBe(1)
    const geometry = await row.evaluate(element => ({
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    }))
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
