// Web e2e scenario: absolute HTTP(S) Markdown images. A validated session
// assembled through the Session API is seeded cold into the real web
// composition, then a separate image origin proves that the browser receives
// a real network image while local-path Markdown remains inert alt text.
// 中文说明：独立图片服务器证明远程图片会真实加载，而本地路径只保留为不可执行的替代文本。
/**
 * 文件职责：验证 Markdown 远程图片加载与本地路径图片隔离的浏览器行为。
 * 技术维度：使用 Node HTTP 服务、Session API、Vitest、Playwright 和无障碍快照。
 * 产品维度：让用户能安全查看网络图片，同时避免模型输出的本地路径被浏览器擅自读取。
 * 逻辑维度：启动确定性图片源，注入含两类图片的会话，检查请求、渲染和快照后关闭资源。
 * 关键边界：仅允许绝对 HTTP(S) 图片发起请求；测试图片是一像素 PNG，服务只监听本机。
 * 新手阅读建议：先读 ImageOrigin 和 startImageOrigin，再看 markdownImageFixture 与最终浏览器断言。
 */
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
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

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-images', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/markdown-images/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
/** 注入测试会话时使用的稳定标识。 */
const SEED_ID = 'markdown-images-web-e2e'
/** 远程图片的替代文本，用作浏览器定位条件。 */
const REMOTE_ALT = 'Remote test image'
/** 本地路径图片的替代文本，用于确认其保持惰性。 */
const LOCAL_ALT = 'Local test image'
/** 图片服务器返回的一像素 PNG 字节。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** 描述测试图片源的服务器、访问地址和收到的请求记录。 */
interface ImageOrigin {
  /** 可在清理阶段关闭的 HTTP 服务器。 */
  server: Server
  /** 注入 Markdown 的绝对图片 URL。 */
  url: string
  /** 服务器收到的路径与来源页头，用于证明真实网络访问。 */
  requests: Array<{ path: string | undefined; referer: string | undefined }>
}

/** Start the deterministic remote image origin used by this browser scenario. */
/* 启动确定性远程图片源，无参数，返回服务器及请求记录。示例：await startImageOrigin()。 */
async function startImageOrigin(): Promise<ImageOrigin> {
  /** 保存服务器收到的所有图片请求。 */
  const requests: ImageOrigin['requests'] = []
  /** 监听本机随机端口并始终返回固定 PNG 的服务器。 */
  const server = createServer((request, response) => {
    requests.push({ path: request.url, referer: request.headers.referer })
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': PNG.length,
      'content-type': 'image/png',
    })
    response.end(PNG)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  /** 服务器开始监听后暴露的实际套接字地址。 */
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('image origin did not expose an IP socket')
  }
  return {
    server,
    url: `http://127.0.0.1:${String(address.port)}/image.png`,
    requests,
  }
}

/** Stop one image origin after the browser and host release their requests. */
async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

/** Build one closed, invariant-checked session fixture with remote and local image Markdown. */
function markdownImageFixture(remoteUrl: string): string {
  const session = Session.create(SessionId('markdown-image-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show the Markdown image policy.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Markdown image policy',
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
          '## Markdown images',
          '',
          `![${REMOTE_ALT}](${remoteUrl})`,
          '',
          `![${LOCAL_ALT}](./local-image.png)`,
          '',
          'REMOTE_IMAGE_DONE',
        ].join('\n'),
      }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  const header = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: '{{sessionId}}',
    createdAt: 0,
    cwd: '{{cwd}}',
    isSeeded: false,
    delegationDepth: 0,
  }
  return [
    JSON.stringify(header),
    // Spaced event times, exactly as the sibling markdown fixtures pin them:
    // the stats line renders its LLM segment only while the step's measured
    // milliseconds exceed zero, so a fixture that leaves the times unset lets
    // the replay's own speed decide whether the golden matches.
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: remote Markdown image rendering', () => {
  let scaffold: WebScaffold
  let imageOrigin: ImageOrigin
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    imageOrigin = await startImageOrigin()
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, markdownImageFixture(imageOrigin.url), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await stopServer(imageOrigin.server)
  })

  it.skipIf(MODE === 'record')('loads only the remote image and matches the conversation golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-images'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText('REMOTE_IMAGE_DONE', { exact: true }).count(), {
      timeout: 15_000,
    }).toBe(1)

    const image = page.getByRole('img', { name: REMOTE_ALT })
    await image.waitFor({ timeout: 10_000 })
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth), {
      timeout: 10_000,
    }).toBeGreaterThan(0)
    expect(await image.evaluate((element) => {
      const computed = getComputedStyle(element)
      return {
        borderRadius: computed.borderRadius,
        decoding: element.getAttribute('decoding'),
        loading: element.getAttribute('loading'),
        maxWidth: computed.maxWidth,
        referrerPolicy: element.getAttribute('referrerpolicy'),
      }
    })).toEqual({
      borderRadius: '8px',
      decoding: 'async',
      loading: 'lazy',
      maxWidth: '100%',
      referrerPolicy: 'no-referrer',
    })
    expect(await page.getByRole('img', { name: LOCAL_ALT }).count()).toBe(0)
    expect(await page.getByText(LOCAL_ALT, { exact: true }).count()).toBe(1)
    expect(imageOrigin.requests).toEqual([{ path: '/image.png', referer: undefined }])

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)
})
