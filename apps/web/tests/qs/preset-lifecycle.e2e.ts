/** 真实 Host 提供者热卸载不能让在途预设准备误交接为发送成功。 */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, readPersistedEvents, seedSession, watchConsole } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('retains the QS draft when the real preset provider unloads during preparation', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    await scaffold.ctx.settings.update('agent-presets', { default: 'ptc', modeSelectionEnabled: true })
    const provider = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-presets')
    if (provider === undefined) throw new Error('Preset provider is missing from the real composition')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const errors = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const picker = page.getByRole('combobox', { name: 'Session preset', exact: true })
      await expect.poll(() => picker.inputValue()).toBe('ptc')
      await picker.selectOption('standard')
      const prompts: string[] = []
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/prompt')) prompts.push(request.url()) })
      const arrived = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      await page.route('**/api/agentPresets/select', async (route) => {
        arrived.resolve(undefined); await release.promise; await route.continue()
      })
      try {
        const input = page.locator('#qs-composer-input')
        await input.fill('retain this draft across provider unload')
        await input.press('Enter')
        await arrived.promise
        expect(prompts).toEqual([])
        // 操作真实 Loader 条目；不伪造 RPC 失败或直接修改页面内部状态。
        await provider.update({ disabled: true })
        await scaffold.ctx.loader.await()
        expect(scaffold.ctx.get('agentPresets')).toBeUndefined()
        release.resolve(undefined)
        await page.getByRole('button', { name: 'Cancel this send', exact: true }).waitFor({ state: 'hidden' })
        await expect.poll(() => input.getAttribute('readonly')).toBeNull()
        expect(await input.inputValue()).toBe('retain this draft across provider unload')
        expect(prompts).toEqual([])
        await provider.update({ disabled: false })
        await scaffold.ctx.loader.await()
        expect(scaffold.ctx.get('agentPresets')).toBeDefined()
        // 重新加载目录属于显式恢复操作；页面刷新会销毁在途状态，不能代替热恢复。
        await page.unrouteAll({ behavior: 'wait' })
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
        await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
        await settings.getByRole('button', { name: 'Refresh directory', exact: true }).click()
        await settings.getByRole('listitem').first().waitFor()
        await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
        await expect.poll(() => picker.isEnabled()).toBe(true)
        const [selected] = await Promise.all([
          page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/agentPresets/select'),
          picker.selectOption('standard'),
        ])
        const response: unknown = await selected.json()
        expect(response).toMatchObject({ result: { ok: true, value: 'standard' } })
        await expect.poll(() => picker.isEnabled()).toBe(true)
        await expect.poll(() => picker.inputValue()).toBe('standard')
        const sessionId = await page.locator('[data-qs-session]').first().getAttribute('data-qs-session')
        if (sessionId === null) throw new Error('Prepared session is missing from navigation')
        // Session append 与落盘异步，等待实际文件事件而非固定延时。
        await expect.poll(async () => (await readPersistedEvents(scaffold, SessionId(sessionId)))
          .some(event => event.type === 'agent-preset/selected' && event.data.agentPreset === 'standard')).toBe(true)
        const events = await readPersistedEvents(scaffold, SessionId(sessionId))
        expect(events.filter(event => event.type === 'user/message')).toEqual([])
        expect(await input.inputValue()).toBe('retain this draft across provider unload')
        expect(prompts).toEqual([])
        expect(errors.pageErrors).toEqual([])
      } finally { release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

it('keeps an existing session preset and draft through provider unload and restoration', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    const id = SessionId('qs-existing-preset-lifecycle')
    await seedSession(scaffold, await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8'), id, 'standard')
    await scaffold.ctx.settings.update('agent-presets', { default: 'ptc', modeSelectionEnabled: true })
    const provider = [...scaffold.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-presets')
    if (provider === undefined) throw new Error('Preset provider is missing from the real composition')
    const before = await readPersistedEvents(scaffold, id)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      let prompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/prompt')) prompts++ })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      const label = page.locator('[data-qs-preset-label]'), input = page.locator('#qs-composer-input')
      await label.waitFor()
      const labelBefore = await label.textContent()
      expect(await label.getAttribute('title')).toBe('Existing sessions retain their initial preset.')
      expect(await page.getByRole('combobox', { name: 'Session preset', exact: true }).count()).toBe(0)
      await input.fill('keep the existing session draft')
      // 首次打开种子会话会合法追加 end-seed；生命周期比较从该落盘点开始。
      await expect.poll(async () => (await readPersistedEvents(scaffold, id)).at(-1)?.type).toBe('session/end-seed')
      const opened = await readPersistedEvents(scaffold, id)
      expect(opened.slice(0, before.length)).toEqual(before)
      expect(opened.slice(before.length).map(event => event.type)).toEqual(['session/end-seed'])
      // 已有会话不能随全局默认或提供者重装改变组成；只刷新目录，不刷新页面。
      await provider.update({ disabled: true })
      await scaffold.ctx.loader.await()
      expect(scaffold.ctx.get('agentPresets')).toBeUndefined()
      expect(await input.inputValue()).toBe('keep the existing session draft')
      await provider.update({ disabled: false })
      await scaffold.ctx.loader.await()
      expect(scaffold.ctx.get('agentPresets')).toBeDefined()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.getByRole('button', { name: 'Agent presets', exact: true }).click()
      await settings.getByRole('button', { name: 'Refresh directory', exact: true }).click()
      await settings.getByRole('listitem').first().waitFor()
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
      await label.waitFor()
      expect(await label.textContent()).toBe(labelBefore)
      expect(await input.inputValue()).toBe('keep the existing session draft')
      expect(await page.getByRole('combobox', { name: 'Session preset', exact: true }).count()).toBe(0)
      expect((await scaffold.ctx.sessionPersistence.stat(id))?.header.agentPreset).toBe('standard')
      expect(await readPersistedEvents(scaffold, id)).toEqual(opened)
      expect(prompts).toBe(0)
      expect(errors.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
