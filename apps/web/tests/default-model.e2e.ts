// Web e2e scenario: switching models in the composer is how this deployment's
// default is chosen. The gesture writes the shared `agent-default-model` settings section, a
// session created afterwards starts from it, and a session that already logged
// a route keeps deriving from its own log — the tier order the gateway
// resolves on every read.
// Zero model calls: the switch is settings/llm-domain traffic only, so there
// is no fixture and a stray stream would fail loud because the adapter registry is empty. Both
// routes are declared host-side (not through the UI, which has its own
// scenario) through the pi-ai adapter the shipped tree already mounts: a
// fixture-less scaffold registers no adapter at all, so the routes the
// picker offers — and the one the composer must start on — have to come from
// somewhere, and settings profiles are the product's own way to add them.
// 路由由主机设置声明；无夹具脚手架没有适配器，设置档案是产品增加模型线路的正式方式。
/**
 * 文件职责：验证编辑器模型切换会保存共享默认值，同时已记录线路的会话保持自身选择。
 * 技术维度：使用 Playwright、真实设置服务、会话模型 RPC、请求头日志和中文界面。
 * 产品维度：用户切换模型后新会话自动采用它，旧会话仍可按历史线路重现，不被全局改变覆盖。
 * 逻辑维度：声明起始和目标线路，创建已记录会话，界面切换后检查设置、新会话和旧会话。
 * 关键边界：删除提供方后编辑器必须禁用但模型选择入口保持可用；全程无模型调用。
 * 新手阅读建议：先看 createSession/currentOf 两个 RPC 辅助函数，再读默认优先级与失效恢复用例。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Points the shipped shared Agent default at this scenario's own route. */
/* 把发布共享代理默认值指向本场景起始线路的覆盖配置。 */
const OVERLAY = fileURLToPath(new URL('./default-model.overlay.yml', import.meta.url))

/** The route this scenario starts on, patched over the shipped default. */
/* 场景开始时的提供方线路编号。 */
const START_ROUTE = 'origin-gateway'
/** 场景开始时的模型编号。 */
const START_MODEL = 'origin-large'
/** The route the switch lands on, which then becomes the saved default. */
/* 用户切换后保存为默认值的提供方线路编号。 */
const ROUTE = 'acme-gateway'
/** 用户切换后保存为默认值的模型编号。 */
const MODEL = 'acme-large'

describe('web e2e: the composer model switch is the default for later sessions', () => {
  /** 真实 Web 主机与设置夹具。 */
  let scaffold: WebScaffold
  /** 本场景使用的 Chromium 实例。 */
  let browser: Browser
  /** 使用中文模型选择界面的页面。 */
  let page: Page
  /** 页面错误和警告监视器。 */
  let tripwire: ReturnType<typeof watchConsole>

  /** Create one session and its agent through the same wire face the browser uses. */
  /* 通过浏览器使用的同一 RPC 创建会话和代理，并返回会话编号。 */
  const createSession = async (sessionId: string): Promise<string> => {
    /** session.create RPC 响应。 */
    const response = await scaffold.ctx.apiProxy.sessions.create({
      rpcId: `default-model-create-${sessionId}` as never,
      payload: { sessionId: SessionId(sessionId), cwd: scaffold.workspaceCwd },
    })
    if (!response.result.ok) throw new Error(`session.create failed: ${response.result.error.message}`)
    return response.result.value.sessionId
  }

  /** The route the gateway reports for one session, through the real wire face. */
  /* 通过真实 session.models RPC 读取一个会话当前解析出的模型线路。 */
  const currentOf = async (sessionId: string): Promise<unknown> => {
    /** session.models RPC 响应。 */
    const response = await scaffold.ctx.apiProxy.sessions.models({
      rpcId: `default-model-${sessionId}` as never,
      payload: { sessionId: SessionId(sessionId) },
    })
    if (!response.result.ok) throw new Error(`session.models failed: ${response.result.error.message}`)
    return response.result.value.current
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // Two routes so the picker has somewhere to start and somewhere to go.
    // Declared through the settings seam rather than the Models page: this
    // scenario is about the composer, and the declaring flow is covered by
    // models-settings.e2e.
    // 这里通过设置服务声明两条线路，模型设置页面的声明交互由独立场景覆盖。
    await scaffold.ctx.settings.update(settingsNamespace('llm-pi-ai'), {
      providers: {
        [START_ROUTE]: {
          displayName: 'Origin Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.origin.example/v1',
          models: [{ id: START_MODEL, name: 'Origin Large' }],
        },
        [ROUTE]: {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{ id: MODEL, name: 'Acme Large' }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The composer's seats only exist once a workspace is connected: without
    // one the input is the locked placeholder and no session scope is open.
    // 连接工作区后才创建编辑器席位和会话作用域。
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('writes the switched model as the default and leaves a logged session alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model'))
    // A session that has already run a turn, spelled as the fact a turn
    // leaves behind: its own logged route.
    // 先创建并记录请求头，代表已经运行过一轮、拥有自身线路事实的会话。
    /** 已写入起始线路请求头的会话编号。 */
    const loggedId = await createSession('default-model-logged')
    scaffold.ctx.sessions.get(SessionId(loggedId))?.append('request/header', {
      header: { config: { provider: START_ROUTE, model: START_MODEL } },
      reason: 'initial',
    })

    /** 打开模型菜单的编辑器按钮。 */
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio', { name: 'Acme Large' }).click()

    // The switch is what sets the default: the shared Agent-route settings section
    // now names it, beside the provider profiles the Models page writes.
    // 切换动作更新共享代理默认线路设置，与模型页面保存的提供方档案并列。
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('agent-default-model:')
    /** 模型切换后写入磁盘的完整设置文档。 */
    const document = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(document).toContain(`provider: ${ROUTE}`)
    expect(document).toContain(`model: ${MODEL}`)

    // A session created after the switch starts from it...
    expect(await currentOf(await createSession('default-model-after')))
      .toEqual({ provider: ROUTE, model: MODEL })
    // ...while the one holding a logged route keeps deriving from its log.
    // 切换后创建的会话采用新默认值，已有请求头的会话继续从日志解析旧线路。
    expect(await currentOf(loggedId)).toEqual({ provider: START_ROUTE, model: START_MODEL })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('goes inert when the route the default names stops being served', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-default-model-blocked'))
    /** 当前编辑器 textarea；线路失效后应禁用。 */
    const box = page.locator('textarea[data-input-phase], textarea').first()
    await expect.poll(async () => box.isEnabled(), { timeout: 10_000 }).toBe(true)

    // What removing the provider on the Models page leaves behind: the saved
    // default still names the route, and nothing serves it any more.
    // `replace`, not `update`: a merge patch of `{providers: {}}` leaves every
    // stored profile in place.
    // 模拟模型页面删除提供方：必须 replace，空对象的 merge update 不会删除已有档案。
    await scaffold.ctx.settings.replace(settingsNamespace('llm-pi-ai'), { providers: {} })

    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(false)
    expect(await box.getAttribute('placeholder')).toBe('当前模型不可用，请先选择模型')

    // The block is an affordance; the refusal is the Host's. A client that
    // never disabled anything still cannot start a turn on a dead route.
    // 禁用是客户端提示，主机仍需独立拒绝不可用线路上的提示请求。
    /** 主机对失效默认线路提示请求的拒绝响应。 */
    const refused = await scaffold.ctx.apiProxy.sessions.prompt({
      rpcId: 'default-model-refused' as never,
      payload: {
        sessionId: SessionId(await createSession('default-model-refusal')),
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
      },
    })
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })

    // The way out stays open. Locking the model seat with everything else
    // would leave the composer asking for the one thing it prevents.
    // 模型选择席位必须保持可用，否则用户无法解除当前不可用模型造成的锁定。
    /** 即使编辑器被锁定仍可操作的模型选择按钮。 */
    const seat = page.getByRole('button', { name: /^选择模型/ })
    expect(await seat.isEnabled()).toBe(true)
    await seat.click()
    await page.getByRole('menuitem', { name: /模型/ }).click()
    await page.getByRole('menuitemradio').first().click()
    await expect.poll(async () => box.isEnabled(), { timeout: 15_000 }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
