/** 真实 Loader/Gateway/工作区登记；仅 OS 原生对话框结果由能力替身提供。 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-directory-picker'
import { launchWebScaffold } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('adopts a native directory and ignores a cancelled older picker through the real QS entries', async () => {
  const scaffold = await launchWebScaffold({ directoryPicker: 'native',
    extraOverlayPath: fileURLToPath(new URL('./native-picker.overlay.yml', import.meta.url)) })
  const old = Promise.withResolvers<string | null>()
  try {
    const chosen = join(scaffold.workspaceCwd, 'native-selected'), obsolete = join(scaffold.workspaceCwd, 'native-obsolete')
    await mkdir(chosen); await mkdir(obsolete)
    expect(scaffold.ctx.directoryPicker.capability().kind).toBe('native')
    const pick = vi.fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('private native failure'))
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce(chosen)
    // 只替换 OS 对话框边界；路径登记、Remote 调用及会话创建均保持真实。
    const capability = vi.spyOn(scaffold.ctx.directoryPicker, 'capability').mockReturnValue({ kind: 'native', pick })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const hero = page.locator('[data-qs-workspace-entry="hero"]')
      const sidebar = page.locator('[data-qs-workspace-entry="sidebar"]')
      const addHero = hero.getByRole('button', { name: 'Add workspace…', exact: true })
      await addHero.click()
      await expect.poll(() => pick.mock.calls.length).toBe(1)
      await expect.poll(() => addHero.isEnabled()).toBe(true)
      expect((await scaffold.ctx.sessionPersistence.list()).some(value => value.header.cwd === chosen)).toBe(false)
      await addHero.click()
      await hero.getByRole('alert').waitFor()
      expect(await hero.getByRole('alert').innerText()).toMatchSnapshot('QS native picker failure')
      expect(await hero.innerText()).not.toContain('private native failure')
      await addHero.click()
      await expect.poll(() => pick.mock.calls.length).toBe(3)
      expect(await sidebar.getByRole('button', { name: 'Add workspace…', exact: true }).isEnabled()).toBe(false)
      await hero.getByRole('button', { name: 'Cancel directory selection', exact: true }).click()
      await sidebar.getByRole('button', { name: 'Add workspace…', exact: true }).click()
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(chosen)
      await expect.poll(async () => (await scaffold.ctx.sessionPersistence.list())
        .filter(value => value.header.cwd === chosen).length).toBe(1)
      // 先订阅真实 RPC 完成，再放行旧 OS 对话框，避免时间延迟冒充请求完成证据。
      const response = page.waitForResponse(value => value.url().includes('/api/directoryPicker/pick'))
      old.resolve(obsolete)
      await response
      expect(await sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(chosen)
      expect((await scaffold.ctx.sessionPersistence.list()).some(value => value.header.cwd === obsolete)).toBe(false)
      expect(pick).toHaveBeenCalledTimes(4)
    } finally { old.resolve(null); await browser.close(); capability.mockRestore() }
  } finally { old.resolve(null); await scaffold.close() }
}, 60_000)

// 不替换平台解析器；只验证当前 Host 实际选择的分支，不把一个平台当作全部平台矩阵。
it('mounts the QS native surface only when the shipped auto resolver selects native', async () => {
  const scaffold = await launchWebScaffold({ directoryPicker: 'auto' })
  try {
    const kind = scaffold.ctx.directoryPicker.capability().kind
    console.info('QS auto directory backend:', kind)
    const entries = [...scaffold.ctx.loader.entries()].filter(entry => !entry.disabled).map(entry => entry.options.name)
    expect(entries.filter(name => name === `@deepseek-ai/dsh-host-directory-picker-${kind}`)).toHaveLength(1)
    expect(entries.filter(name => name === '@deepseek-ai/dsh-qs-ui-directory-picker-native')).toHaveLength(kind === 'native' ? 1 : 0)
    expect(entries.filter(name => name === '@deepseek-ai/dsh-qs-ui-directory-picker-browse')).toHaveLength(kind === 'browse' ? 1 : 0)
    expect(entries.filter(name => name === '@deepseek-ai/dsh-host-directory-picker-browse'
      || name === '@deepseek-ai/dsh-host-directory-picker-native')).toHaveLength(1)
  } finally { await scaffold.close() }
}, 60_000)
