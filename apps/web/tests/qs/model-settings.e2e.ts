/** 奇术首次配置使用真实 Web 装配与 Host 持久化，不向模型发送请求。 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_VERSION } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('keeps remote QS preferences local and exposes persistent settings limitations without writes', async () => {
  // 非回环域名使用官方连接判定；不拦截响应或伪造 settingsScope 状态。
  const scaffold = await launchWebScaffold({ remoteAuthority: 'remote.localhost',
    extraOverlayPath: fileURLToPath(new URL('./model-settings.overlay.yml', import.meta.url)),
  })
  try {
    const before = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), settingsRequests: string[] = []
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path.startsWith('/api/settings/')) settingsRequests.push(path)
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      // 远端欢迎确认只在当前浏览器生效，不能读取 Host 的本机确认记录。
      const welcome = page.getByRole('dialog', { name: 'Internal Testing Notice' })
      await welcome.getByRole('button', { name: 'Continue', exact: true }).click()
      await welcome.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.locator('[data-qs-settings]')
      await dialog.getByText('Persistent settings are unavailable on this connection. Local feature preferences do not write to the Host.', { exact: true }).waitFor()
      expect(await dialog.getByRole('button', { name: 'Open local settings document', exact: true }).count()).toBe(0)
      const busyEnter = dialog.getByRole('combobox', { name: 'Enter while busy', exact: true })
      await busyEnter.selectOption('steer')
      await expect.poll(() => busyEnter.inputValue()).toBe('steer')
      await dialog.getByRole('button', { name: 'Plugin settings', exact: true }).click()
      await dialog.getByText('Persistent plugin configuration is unavailable on this connection.', { exact: true }).waitFor()
      // 预设目录能力查询是只读请求；不允许 describe、更新或打开本机文件等其他调用。
      expect(settingsRequests).toEqual(['/api/settings/canOpenAgentPresetDirectory'])
      expect(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toBe(before)
      // 官方 memory 偏好属于当前页面；刷新恢复默认，不能读取 Host 冒充远端持久化。
      settingsRequests.length = 0
      await page.reload()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await welcome.getByRole('button', { name: 'Continue', exact: true }).click()
      await welcome.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect.poll(() => busyEnter.inputValue()).toBe('queue')
      expect(settingsRequests).toEqual(['/api/settings/canOpenAgentPresetDirectory'])
      expect(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toBe(before)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

it('configures QS models through the shared Host and restores acknowledged onboarding after reload', async () => {
  const scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, welcomeNoticePending: true,
    extraOverlayPath: fileURLToPath(new URL('./model-settings.overlay.yml', import.meta.url)),
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors: string[] = [], consoleLines: string[] = []
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => consoleLines.push(message.text()))
      let prompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/prompt')) prompts++ })
      const login = async (): Promise<void> => {
        await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.goto(scaffold.authenticatedUrl); await login()
      const welcome = page.getByRole('dialog', { name: 'Internal Testing Notice' })
      await welcome.waitFor()
      expect(await welcome.ariaSnapshot()).toMatchSnapshot('QS versioned welcome')
      await welcome.getByRole('button', { name: 'Continue' }).click()
      await welcome.waitFor({ state: 'detached' })
      const step = page.getByRole('dialog', { name: 'Set up DeepSeek', exact: true })
      await step.waitFor()
      expect(await step.ariaSnapshot()).toMatchSnapshot('QS first credential step')
      await step.screenshot({ path: 'qishu/PRD/1-AI工作台/复核测试/logs/repair-v1-model-settings-onboarding.png' })
      const secret = `qs_onboarding_${randomBytes(12).toString('hex')}`
      await step.getByLabel('API key', { exact: true }).fill(secret)
      await step.getByRole('button', { name: 'Save and check', exact: true }).click()
      await step.waitFor({ state: 'detached' })
      const stored = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
      expect(stored.includes(`DEEPSEEK_API_KEY: ${secret}`)).toBe(true)
      const settings = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
      expect(settings).toContain(`${WELCOME_NOTICE_ACK_FIELD}: ${WELCOME_NOTICE_VERSION}`)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.locator('[data-qs-settings]')
      // 通过真实设置 RPC 保存忙碌发送偏好，再用刷新和官方呈现交叉验证。
      await dialog.getByRole('button', { name: 'General', exact: true }).click()
      const busyEnter = dialog.getByRole('combobox', { name: 'Enter while busy', exact: true })
      await expect.poll(() => busyEnter.inputValue()).toBe('queue')
      await busyEnter.selectOption('steer')
      await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toContain('busyEnter: steer')
      // 转写偏好必须真正落盘；刷新后读取同一个 Host 设置，而非组件临时状态。
      const transcriptView = dialog.getByRole('combobox', { name: 'Transcript view', exact: true })
      await expect.poll(() => transcriptView.inputValue()).toBe('compact')
      await transcriptView.selectOption('normal')
      await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toContain('transcriptView: normal')
      await dialog.getByRole('button', { name: 'Models and providers', exact: true }).click()
      const models = page.locator('[data-qs-model-settings]')
      const provider = models.locator('article').filter({ has: page.getByRole('heading', { name: 'DeepSeek', exact: true }) })
      await provider.getByText('Credential configured', { exact: true }).waitFor()
      await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
      const key = provider.getByLabel('API key', { exact: true })
      expect(await key.inputValue()).toBe('')
      const endpoint = provider.getByLabel('Service URL', { exact: true })
      await endpoint.fill('https://example.invalid/v1')
      await provider.getByRole('button', { name: 'Save', exact: true }).click()
      await endpoint.waitFor({ state: 'detached' })
      await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')).toContain('https://example.invalid/v1')
      // 记录实际打开过的引导，防止最终 DOM 已消失却掩盖刷新时短暂抢焦点。
      await page.addInitScript(() => {
        const sightings: string[] = []
        Object.assign(window, { qsOnboardingSightings: sightings })
        new MutationObserver(() => {
          for (const node of document.querySelectorAll('dialog[open][aria-label="Internal Testing Notice"], dialog[open][aria-label="Set up DeepSeek"]')) {
            sightings.push(node.getAttribute('aria-label') ?? '')
          }
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
      })
      await page.reload(); await login()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await dialog.getByRole('button', { name: 'General', exact: true }).click()
      await expect.poll(() => busyEnter.inputValue()).toBe('steer')
      await expect.poll(() => transcriptView.inputValue()).toBe('normal')
      // 窄屏检查真实控件边界，避免截图看似可用却出现横向裁切。
      const viewport = page.viewportSize()!
      await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(() => busyEnter.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0
      })).toBe(true)
      await expect.poll(() => transcriptView.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0
      })).toBe(true)
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await busyEnter.scrollIntoViewIfNeeded()
      await dialog.screenshot({ path: 'qishu/PRD/1-AI工作台/复核测试/logs/repair-v1-enter-setting-narrow.png' })
      await page.setViewportSize(viewport)
      await dialog.getByRole('button', { name: 'Models and providers', exact: true }).click()
      await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
      expect(await endpoint.inputValue()).toBe('https://example.invalid/v1')
      await dialog.screenshot({ path: 'qishu/PRD/1-AI工作台/复核测试/logs/repair-v1-model-settings-dialog.png' })
      // 顶部截图保留设置标题及分区导航，底部表单截图不能单独代表整体布局。
      await dialog.evaluate((node) => { node.scrollTop = 0 })
      await dialog.screenshot({ path: 'qishu/PRD/1-AI工作台/复核测试/logs/repair-v1-model-settings-top.png' })
      expect(await key.inputValue()).toBe('')
      expect(await welcome.count()).toBe(0); expect(await step.count()).toBe(0)
      expect(await page.evaluate(() => (window as unknown as { qsOnboardingSightings: string[] }).qsOnboardingSightings)).toEqual([])
      // 两轮根界面装卸使用同一 Host；两边保存的端点都必须立即进入另一边。
      for (let cycle = 0; cycle < 2; cycle++) {
        const qsValue = `https://qs-${cycle}.invalid/v1`, officialValue = `https://official-${cycle}.invalid/v1`
        await endpoint.fill(qsValue)
        await provider.getByRole('button', { name: 'Save', exact: true }).click()
        await endpoint.waitFor({ state: 'detached' })
        await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
        await page.locator('[data-qs-switch-official]').click()
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const official = page.getByRole('dialog', { name: 'Settings', exact: true })
        await official.getByRole('button', { name: 'General', exact: true }).click()
        // 官方读取 QS 已保存的模式，再反向写入；回到 QS 后不能沿用装卸前的值。
        await official.getByRole('button', { name: cycle === 0 ? 'Normal' : 'Compact', exact: true }).click()
        await page.getByRole('menuitem', { name: cycle === 0 ? 'Compact' : 'Normal', exact: true }).click()
        await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))
          .toContain(`transcriptView: ${cycle === 0 ? 'compact' : 'normal'}`)
        await official.getByRole('button', { name: cycle === 0 ? 'Steer' : 'Queue', exact: true }).click()
        await page.getByRole('menuitem', { name: cycle === 0 ? 'Queue' : 'Steer', exact: true }).click()
        await expect.poll(async () => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))
          .toContain(`busyEnter: ${cycle === 0 ? 'queue' : 'steer'}`)
        await official.getByRole('button', { name: 'Models', exact: true }).click()
        await official.getByRole('button', { name: 'Edit DeepSeek (deepseek-official)', exact: true }).click()
        await official.getByText('Customized settings', { exact: true }).click()
        const officialEndpoint = official.getByLabel('Base URL', { exact: true })
        expect(await officialEndpoint.inputValue()).toBe(qsValue)
        await officialEndpoint.fill(officialValue)
        await official.getByRole('button', { name: 'Apply', exact: true }).click()
        await officialEndpoint.waitFor({ state: 'detached' })
        await official.getByRole('button', { name: 'Close', exact: true }).click()
        await page.locator('[data-qs-official-return]').click()
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await dialog.getByRole('button', { name: 'General', exact: true }).click()
        await expect.poll(() => busyEnter.inputValue()).toBe(cycle === 0 ? 'queue' : 'steer')
        await expect.poll(() => transcriptView.inputValue()).toBe(cycle === 0 ? 'compact' : 'normal')
        await dialog.getByRole('button', { name: 'Models and providers', exact: true }).click()
        await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
        expect(await endpoint.inputValue()).toBe(officialValue)
        expect(await key.inputValue()).toBe('')
      }
      // 另一页面通过官方 UI 写入后，旧 QS 编辑器必须以旧 revision 被拒绝，不能覆盖新值。
      const concurrent = await newEnglishPage(browser)
      try {
        await concurrent.goto(scaffold.authenticatedUrl)
        await concurrent.locator('#qs-login-user').fill('admin')
        await concurrent.locator('#qs-login-password').fill('Demo@2026')
        await concurrent.locator('#qs-login-password').press('Enter')
        await concurrent.locator('[data-qs-switch-official]').click()
        await concurrent.getByRole('button', { name: 'Settings', exact: true }).click()
        const remoteSettings = concurrent.getByRole('dialog', { name: 'Settings', exact: true })
        await remoteSettings.getByRole('button', { name: 'Models', exact: true }).click()
        await remoteSettings.getByRole('button', { name: 'Edit DeepSeek (deepseek-official)', exact: true }).click()
        await remoteSettings.getByText('Customized settings', { exact: true }).click()
        await remoteSettings.getByLabel('Base URL', { exact: true }).fill('https://concurrent.invalid/v1')
        await remoteSettings.getByRole('button', { name: 'Apply', exact: true }).click()
        await remoteSettings.getByLabel('Base URL', { exact: true }).waitFor({ state: 'detached' })
        await endpoint.fill('https://stale-draft.invalid/v1')
        await provider.getByRole('button', { name: 'Save', exact: true }).click()
        await provider.getByText('Another operation changed the settings. Close and reload before editing.', { exact: true }).waitFor()
        expect(await endpoint.inputValue()).toBe('https://stale-draft.invalid/v1')
        const latest = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
        expect(latest).toContain('https://concurrent.invalid/v1'); expect(latest).not.toContain('https://stale-draft.invalid/v1')
        await provider.getByRole('button', { name: 'Close', exact: true }).click()
        await models.getByRole('button', { name: 'Reload', exact: true }).click()
        await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
        expect(await endpoint.inputValue()).toBe('https://concurrent.invalid/v1')
      } finally { await concurrent.close() }
      expect((await page.content()).includes(secret)).toBe(false)
      expect(consoleLines.some(line => line.includes(secret))).toBe(false)
      expect(prompts).toBe(0); expect(errors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 自定义路线在真实适配器中注册，检查失败草稿、刷新和两种凭据删除策略。
it('creates edits and removes a QS custom provider without losing failed drafts or unrelated credentials', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const secret = `qs_custom_${randomBytes(12).toString('hex')}`
      await scaffold.ctx.credentials.set(credentialRef('QS_UNRELATED_KEY'), 'unrelated-fixture')
      const login = async (): Promise<void> => {
        await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      const openModels = async (): Promise<void> => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.locator('[data-qs-settings]').getByRole('button', { name: 'Models and providers', exact: true }).click()
      }
      await page.goto(scaffold.authenticatedUrl); await login(); await openModels()
      const models = page.locator('[data-qs-model-settings]')
      const create = async (): Promise<void> => {
        await models.getByRole('button', { name: 'Add custom provider', exact: true }).click()
        await models.getByLabel('Provider ID', { exact: true }).fill('qs-browser')
        await models.getByLabel('Provider name', { exact: true }).fill('QS Browser Provider')
        await models.getByLabel('Service URL', { exact: true }).fill('https://example.invalid/v1')
        await models.getByRole('combobox', { name: 'API protocol', exact: true }).selectOption('openai-completions')
        await models.getByLabel('API key', { exact: true }).fill(secret)
        await models.getByRole('button', { name: 'Add model', exact: true }).click()
        await models.getByLabel('Model ID 1', { exact: true }).fill('qs-model')
        await models.getByLabel('Model name 1', { exact: true }).fill('QS Model')
        await models.getByLabel('Context capacity 1', { exact: true }).fill('128K')
        await models.getByLabel('Maximum output tokens 1', { exact: true }).fill('8K')
      }
      await create()
      await page.route('**/mutate', route => route.abort('connectionfailed'), { times: 1 })
      await models.getByRole('button', { name: 'Save', exact: true }).click()
      await models.getByText('Settings could not be saved. Your draft is retained.', { exact: true }).waitFor()
      expect(await models.getByLabel('Provider ID', { exact: true }).inputValue()).toBe('qs-browser')
      expect(await models.getByLabel('API key', { exact: true }).inputValue()).toBe(secret)
      await models.getByRole('button', { name: 'Save', exact: true }).click()
      const provider = models.locator('article').filter({ has: page.getByText('qs-browser', { exact: true }) })
      await provider.getByText('Credential configured', { exact: true }).waitFor()
      const settingsDocument = (): Promise<string> => readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
      const credentialsDocument = (): Promise<string> => readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
      expect(await settingsDocument()).toContain('contextWindow: 128000')
      expect(await settingsDocument()).toContain('maxTokens: 8000')
      expect(await credentialsDocument()).toContain(`QS_BROWSER_API_KEY: ${secret}`)
      // 凭据只落专用 Host 存储，不能混入普通配置或浏览器持久偏好。
      expect(await settingsDocument()).not.toContain(secret)
      expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage].map(storage =>
        Object.keys(storage).map(key => [key, storage.getItem(key)]),
      )))).not.toContain(secret)
      await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
      await provider.getByLabel('Provider name', { exact: true }).fill('QS Renamed Provider')
      await provider.getByLabel('Model name 1', { exact: true }).fill('QS Renamed Model')
      await provider.getByRole('button', { name: 'Save', exact: true }).click()
      await provider.getByRole('heading', { name: 'QS Renamed Provider', exact: true }).waitFor()
      await page.reload(); await login(); await openModels()
      await provider.getByRole('heading', { name: 'QS Renamed Provider', exact: true }).waitFor()
      await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
      expect(await provider.getByLabel('Model name 1', { exact: true }).inputValue()).toBe('QS Renamed Model')
      expect(await provider.getByRole('combobox', { name: 'API protocol', exact: true }).inputValue()).toBe('openai-completions')
      expect(await provider.getByLabel('API key', { exact: true }).inputValue()).toBe('')
      await provider.getByRole('button', { name: 'Close', exact: true }).click()
      await provider.getByRole('button', { name: 'Remove configuration', exact: true }).click()
      const removal = provider.getByRole('form', { name: 'Confirm provider configuration removal' })
      expect(await removal.getByRole('checkbox').isChecked()).toBe(false)
      await removal.getByRole('button', { name: 'Confirm removal', exact: true }).click()
      await provider.waitFor({ state: 'detached' })
      expect(await credentialsDocument()).toContain(`QS_BROWSER_API_KEY: ${secret}`)
      expect(await settingsDocument()).not.toContain('qs-browser:')
      await create(); await models.getByRole('button', { name: 'Save', exact: true }).click()
      await provider.getByText('Credential configured', { exact: true }).waitFor()
      await provider.getByRole('button', { name: 'Remove configuration', exact: true }).click()
      await removal.getByRole('checkbox').check()
      await removal.getByRole('button', { name: 'Confirm removal', exact: true }).click()
      await provider.waitFor({ state: 'detached' })
      expect(await credentialsDocument()).not.toContain('QS_BROWSER_API_KEY')
      expect(await credentialsDocument()).toContain('QS_UNRELATED_KEY: unrelated-fixture')
      expect(await settingsDocument()).not.toContain('qs-browser:')
      expect((await page.content()).includes(secret)).toBe(false)
      expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage].map(storage =>
        Object.keys(storage).map(key => [key, storage.getItem(key)]),
      )))).not.toContain(secret)
      expect(errors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 本地端口由操作系统分配，只替代外部模型列表服务；UI、RPC 和适配器解析均为真实实现。
it('discovers models through the actual adapter and keeps long candidates usable on a narrow screen', async () => {
  const requests: Array<{ path: string | undefined; authorization: string | undefined }> = []
  const longName = 'Long-model-' + 'unbroken'.repeat(40)
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization })
    response.writeHead(requests.length === 1 ? 503 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(requests.length === 1 ? { error: 'private provider diagnostic' } : {
      data: [{ id: 'qs-alpha', name: 'QS Alpha', context_window: 64000, max_output_tokens: 4000 },
        { id: 'qs-beta', name: longName, context_window: 128000, max_output_tokens: 8000 }],
    }))
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing fixture listener')
    const endpoint = `http://127.0.0.1:${address.port}/v1`
    const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
    try {
      const browser = await chromium.launch()
      try {
        const page = await newEnglishPage(browser)
        await page.setViewportSize({ width: 390, height: 844 })
        const login = async (): Promise<void> => {
          await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
        }
        const openModels = async (): Promise<void> => {
          const toggle = page.locator('header').getByRole('button', { name: /the left navigation$/ }).first()
          await toggle.waitFor()
          if (await toggle.getAttribute('aria-label') === 'Expand the left navigation') await toggle.click()
          await page.getByRole('button', { name: 'Settings', exact: true }).click()
          await page.locator('[data-qs-settings]').getByRole('button', { name: 'Models and providers', exact: true }).click()
        }
        await page.goto(scaffold.authenticatedUrl); await login(); await openModels()
        const dialog = page.locator('[data-qs-settings]'), models = page.locator('[data-qs-model-settings]')
        await models.getByRole('button', { name: 'Add custom provider', exact: true }).click()
        await models.getByLabel('Provider ID', { exact: true }).fill('qs-discovery')
        await models.getByLabel('Provider name', { exact: true }).fill('QS Discovery')
        await models.getByLabel('Service URL', { exact: true }).fill(endpoint)
        await models.getByRole('combobox', { name: 'API protocol', exact: true }).selectOption('openai-completions')
        await models.getByLabel('API key', { exact: true }).fill('discovery-fixture-key')
        const query = models.getByRole('button', { name: 'Query provider models', exact: true })
        await query.click()
        await models.getByText('Model discovery failed. Retry or add models manually.', { exact: true }).waitFor()
        expect((await models.innerText()).includes('private provider diagnostic')).toBe(false)
        await query.click()
        await models.getByText(longName, { exact: true }).waitFor()
        expect(requests).toEqual([
          { path: '/v1/models', authorization: 'Bearer discovery-fixture-key' },
          { path: '/v1/models', authorization: 'Bearer discovery-fixture-key' },
        ])
        await models.getByLabel('Filter candidate models', { exact: true }).fill('missing-candidate')
        await models.getByText('No candidate models match.', { exact: true }).waitFor()
        await models.getByLabel('Filter candidate models', { exact: true }).fill('')
        const geometry = await dialog.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth,
          left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1)
        expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(390)
        await dialog.screenshot({ path: 'qishu/PRD/1-AI工作台/复核测试/logs/repair-v1-model-discovery-narrow.png' })
        await models.getByRole('button', { name: 'Add selected models', exact: true }).click()
        expect(await models.getByLabel('Model ID 1', { exact: true }).inputValue()).toBe('qs-alpha')
        expect(await models.getByLabel('Model ID 2', { exact: true }).inputValue()).toBe('qs-beta')
        expect(await models.getByLabel('Context capacity 1', { exact: true }).inputValue()).toBe('64000')
        await models.getByRole('button', { name: 'Save', exact: true }).click()
        const provider = models.locator('article').filter({ has: page.getByText('qs-discovery', { exact: true }) })
        await provider.getByText('Credential configured', { exact: true }).waitFor()
        await page.reload(); await login(); await openModels()
        await provider.getByRole('button', { name: 'Edit connection', exact: true }).click()
        expect(await provider.getByLabel('Model ID 2', { exact: true }).inputValue()).toBe('qs-beta')
        expect(await provider.getByLabel('Model name 2', { exact: true }).inputValue()).toBe(longName)
        expect(await provider.getByLabel('Maximum output tokens 2', { exact: true }).inputValue()).toBe('8000')
        await provider.getByRole('button', { name: 'Query provider models', exact: true }).click()
        await provider.getByText('Already in the catalog', { exact: true }).first().waitFor()
        const candidates = provider.getByRole('group', { name: 'Query provider models', exact: true })
        expect(await candidates.getByRole('checkbox').count()).toBe(2)
        for (const checkbox of await candidates.getByRole('checkbox').all()) expect(await checkbox.isDisabled()).toBe(true)
        expect(await candidates.getByRole('button', { name: 'Add selected models', exact: true }).isDisabled()).toBe(true)
        expect(requests).toHaveLength(3)
        expect(requests[2]?.authorization).toBe('Bearer discovery-fixture-key')
      } finally { await browser.close() }
    } finally { await scaffold.close() }
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
})
