/** 界面启动配置与官方回退文件必须通过真实 Loader 和浏览器生效。 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-directory-picker'
import { launchWebScaffold, watchConsole } from '../scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from '../support.ts'

/**
 * 等待选中界面的实际输入入口；静态登录只作用于 QS。
 * @param page - 当前浏览器页面。
 * @param ui - 期望呈现的界面。
 * @returns 界面可交互时完成。
 */
async function waitForUi(page: Page, ui: 'official' | 'workbench'): Promise<void> {
  if (ui === 'official') {
    await page.getByRole('textbox', { name: 'Choose workspace' }).waitFor()
    expect(await page.locator('[data-qs-root]').count()).toBe(0)
    return
  }
  await page.locator('[data-qs-root]').waitFor()
  // 登录态只在当前文档保存；往返可已登录，刷新则必须重新通过静态入口。
  await expect.poll(async () => await page.locator('#qs-login-user').count()
    + await page.locator('#qs-composer-input').count()).toBeGreaterThan(0)
  if (await page.locator('#qs-login-user').count() > 0) {
    await page.locator('#qs-login-user').fill('admin')
    await page.locator('#qs-login-password').fill('Demo@2026')
    await page.locator('#qs-login-password').press('Enter')
  }
  await page.locator('#qs-composer-input').waitFor()
}

for (const defaultUi of ['official', 'workbench'] as const) {
  for (const showOfficialUiEntry of [false, true]) {
    it(`boots and reloads ${defaultUi} with developer entry ${showOfficialUiEntry}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'qs-ui-config-'))
      try {
        const overlay = join(directory, 'config.yml')
        await writeFile(overlay, JSON.stringify([{ id: 'qs-shell', config: { defaultUi, showOfficialUiEntry } }]))
        const scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
        try {
          const browser = await chromium.launch()
          try {
            const page = await newEnglishPage(browser)
            const errors = watchConsole(page)
            const consoleErrors: string[] = []
            page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
            await page.goto(scaffold.authenticatedUrl)
            await waitForUi(page, defaultUi)
            const entry = defaultUi === 'official' ? '[data-qs-official-return]' : '[data-qs-switch-official]'
            expect(await page.locator(entry).count()).toBe(showOfficialUiEntry ? 1 : 0)
            if (showOfficialUiEntry) {
              await page.locator(entry).click()
              await waitForUi(page, defaultUi === 'official' ? 'workbench' : 'official')
            }
            // 刷新必须回到部署默认值，不沿用当前文档内的切换状态。
            await page.reload()
            await waitForUi(page, defaultUi)
            expect(await page.locator(entry).count()).toBe(showOfficialUiEntry ? 1 : 0)
            expect(errors.pageErrors).toEqual([])
            expect(consoleErrors).toEqual([])
          } finally { await browser.close() }
        } finally { await scaffold.close() }
      } finally { await rm(directory, { recursive: true, force: true }) }
    })
  }
}

for (const file of ['01-switch-to-official.patch.yml', '02-disable-qs-rows.patch.yml']) {
  it.each(['auto', 'browse'] as const)(`uses shipped ${file} with %s directory selection`, async (directoryPicker) => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL(`../../../../qishu/dev-components/switch/${file}`, import.meta.url)),
      // 保留生产自动分支，防止测试夹具关闭目录选择器而掩盖残留 QS 动态插件。
      directoryPicker,
    })
    try {
      if (file.startsWith('02-')) {
        expect(scaffold.ctx.clientModules.graph().entries.filter(entry => entry.id.startsWith('@deepseek-ai/dsh-qs-'))).toEqual([])
      }
      const browser = await chromium.launch()
      try {
        const page = await newEnglishPage(browser)
        const errors = watchConsole(page)
        const consoleErrors: string[] = []
        page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
        await page.goto(scaffold.authenticatedUrl)
        await waitForUi(page, 'official')
        expect(await page.locator('[data-qs-official-return]').count()).toBe(0)
        // 自动分支验证生产装配；原生弹窗不在浏览器 DOM 内，目录采用由 browse 用例执行。
        if (scaffold.ctx.directoryPicker.capability().kind === 'browse') {
          await connectFreshWorkspace(page, scaffold.workspaceCwd, 'official-fallback')
          const input = page.locator('[data-composer-input][contenteditable="true"]').first()
          await writeComposerDraft(page, input, 'Official fallback remains usable')
          await expect.poll(() => input.innerText()).toBe('Official fallback remains usable')
        } else {
          expect(directoryPicker).toBe('auto')
          expect(scaffold.ctx.clientModules.graph().entries.some(entry => entry.id.startsWith('@deepseek-ai/dsh-client-ui-directory-picker-native'))).toBe(true)
        }
        expect(errors.pageErrors).toEqual([])
        expect(consoleErrors).toEqual([])
      } finally { await browser.close() }
    } finally { await scaffold.close() }
  })
}
