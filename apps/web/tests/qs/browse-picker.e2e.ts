/** 使用真实 Host 文件系统验证目录浏览、创建及会话采纳，不替换目录能力。 */
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-host-directory-picker'
import { launchWebScaffold } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('browses, creates and adopts Host directories through both QS entry points', async () => {
  const scaffold = await launchWebScaffold({ directoryPicker: 'browse',
    extraOverlayPath: fileURLToPath(new URL('./browse-picker.overlay.yml', import.meta.url)) })
  try {
    expect(scaffold.ctx.directoryPicker.capability().kind).toBe('browse')
    const parent = join(scaffold.workspaceCwd, 'browse-parent'), child = join(parent, 'created')
    await mkdir(parent)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1280, height: 820 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const hero = page.locator('[data-qs-workspace-entry="hero"]')
      const sidebar = page.locator('[data-qs-workspace-entry="sidebar"]')
      await hero.getByRole('button', { name: 'Add workspace…', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Choose a directory on the Host' })
      const path = dialog.getByRole('textbox', { name: 'Host path', exact: true })
      await expect.poll(() => dialog.getByRole('button', { name: 'Confirm selection' }).isEnabled()).toBe(true)
      await path.fill(join(parent, 'missing'))
      await dialog.getByRole('button', { name: 'Go', exact: true }).click()
      await dialog.getByRole('alert').waitFor()
      expect(await dialog.getByRole('alert').innerText()).toMatchSnapshot('QS Host directory read error')
      expect(await dialog.getByRole('button', { name: 'Confirm selection' }).isEnabled()).toBe(false)
      await path.fill(parent)
      await dialog.getByRole('button', { name: 'Go', exact: true }).click()
      await expect.poll(() => dialog.getByRole('button', { name: 'Confirm selection' }).isEnabled()).toBe(true)
      await dialog.getByRole('textbox', { name: 'New directory name' }).fill('created')
      await dialog.getByRole('button', { name: 'Create directory', exact: true }).click()
      await expect.poll(() => path.inputValue()).toBe(child)
      expect((await stat(child)).isDirectory()).toBe(true)
      // 新建后取消只能退出选择，不能把已完成的文件系统写入描述为回滚。
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      await dialog.waitFor({ state: 'hidden' })
      expect((await stat(child)).isDirectory()).toBe(true)
      expect((await scaffold.ctx.sessionPersistence.list()).some(item => item.header.cwd === child)).toBe(false)
      await sidebar.getByRole('button', { name: 'Add workspace…', exact: true }).click()
      await expect.poll(() => dialog.getByRole('button', { name: 'Confirm selection' }).isEnabled()).toBe(true)
      await path.fill(child)
      await dialog.getByRole('button', { name: 'Go', exact: true }).click()
      await expect.poll(() => dialog.getByRole('button', { name: 'Confirm selection' }).isEnabled()).toBe(true)
      // 窄屏侧栏是覆盖式抽屉；先打开弹层再验证弹层本身的视口约束。
      await page.setViewportSize({ width: 760, height: 820 })
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(760)
      expect(box!.y + box!.height).toBeLessThanOrEqual(820)
      await dialog.getByRole('button', { name: 'Confirm selection' }).click()
      await dialog.waitFor({ state: 'hidden' })
      await expect.poll(async () => (await scaffold.ctx.sessionPersistence.list()).filter(item => item.header.cwd === child).length).toBe(1)
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(child)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
}, 90_000)
