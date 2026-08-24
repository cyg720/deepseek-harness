// Cold-boot RPC budget. The describe mirror (packages/client/ui-settings) is
// the one `settings.describe` reader in the browser, so startup describe
// traffic stays bounded no matter how many client plugins own a preference.
// A regression here means a consumer bypassed the mirror — grep for
// `settings.describe(` outside ui-settings' client sources.
//
// Zero model calls: the lane only boots chrome, so no replay fixture mounts.
// 中文：冷启动 RPC 预算只启动浏览器外壳，不调用模型，也不挂载回放夹具。
/**
 * 中文说明：
 * - 文件职责：验证 Web 冷启动期间 settings.describe 调用不超过设置镜像所需的固定两次。
 * - 技术维度：使用 Playwright Chromium、网络请求监听、Vitest 生命周期和真实 Web Scaffold。
 * - 产品维度：防止每个设置插件各自请求描述信息，控制远程启动延迟和服务器负载。
 * - 逻辑维度：启动服务与浏览器，收集 /api 请求，等待界面及首次连接重置后统计 describe。
 * - 关键边界：预算包含绑定时读取和首次连接重置读取；用例不触发任何模型请求。
 * - 新手阅读建议：先理解 DESCRIBE_BUDGET 为何是 2，再看 request 监听如何只记录 API 方法。
 */
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/**
 * Both reads are the mirror's: once eagerly at bind time over HTTP, and once
 * on the first-connection reset — that second read closes the window where a
 * document commit lands between the eager read and the SSE subscription and
 * its invalidation is lost. Every settings consumer derives from these two.
 */
/** 中文：设置镜像允许的 describe 调用数：绑定时一次，首次连接重置再一次。 */
const DESCRIBE_BUDGET = 2

/** 当前 E2E 的本地 Web 服务夹具。 */
let scaffold: WebScaffold
/** 当前 Playwright Chromium 实例。 */
let browser: Browser
/** 当前测试页面。 */
let page: Page

/** 中文：测试组开始前启动 Web Scaffold 和 Chromium。 */
beforeAll(async () => {
  scaffold = await launchWebScaffold()
  browser = await chromium.launch()
})

/** 中文：测试组结束后依次关闭页面、浏览器和 Scaffold。 */
afterAll(async () => {
  await page?.close()
  await browser?.close()
  await scaffold?.close()
})

/** 中文：Web 冷启动 RPC 预算测试组。 */
describe('startup RPC budget', () => {
  /** 中文：冷启动 settings.describe 次数应恰好等于镜像预算；无参数和返回值。 */
  it('keeps cold-boot settings.describe at the mirror count', async () => {
    page = await newEnglishPage(browser)
    watchConsole(page)
    /** 捕获到的 /api/ 后缀方法名列表。 */
    const calls: string[] = []
    page.on('request', (request) => {
      /** 当前网络请求的已解析 URL。 */
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) calls.push(url.pathname.slice('/api/'.length))
    })
    await page.goto(scaffold.baseUrl)
    // Boot settles when the workspace picker is interactive; the trailing wait
    // absorbs the first-connection reset wave the budget must include.
    // 中文：工作区输入框可交互表示启动完成，额外等待用于纳入首次连接重置请求。
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    /** 收集列表中 settings.describe 的调用次数。 */
    const describeCount = calls.filter(method => method === 'settings.describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})
