// Cold boot may issue at most two settings/describe calls regardless of client
// plugin count. No model call or replay fixture is involved.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

/** One eager read plus one first-connection reset closes the pre-subscription commit window. */
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
    await page.goto(scaffold.authenticatedUrl)
    // Boot settles when the workspace picker is interactive; the trailing wait
    // absorbs the first-connection reset wave the budget must include.
    // 中文：工作区输入框可交互表示启动完成，额外等待用于纳入首次连接重置请求。
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(3000)
    const describeCount = calls.filter(method => method === 'settings/describe').length
    expect(describeCount, `startup /api calls:\n${calls.join('\n')}`).toBe(DESCRIBE_BUDGET)
  })
})
