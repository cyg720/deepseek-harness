/** Cold replay through the shipped workbench must keep metadata out of message prose. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('contains recorded metadata in disclosures at desktop and narrow widths', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
  })
  try {
    const fixture = await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8')
    await seedSession(scaffold, fixture, 'qs-disclosure-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const transcript = page.locator('[data-qs-transcript]')
      await transcript.locator('[data-qs-turn-tail]').waitFor()
      const prompts = transcript.locator('[data-qs-system-prompt]')
      const contexts = transcript.locator('[data-qs-context]')
      expect(await prompts.count()).toBeGreaterThan(0)
      expect(await contexts.count()).toBeGreaterThan(0)
      expect(await transcript.locator('[data-qs-process]').count()).toBeGreaterThan(0)
      expect(await prompts.first().getAttribute('open')).toBeNull()
      expect(await contexts.first().getAttribute('open')).toBeNull()
      expect(await transcript.innerText()).not.toContain('controlAnchorSeq')
      expect(await transcript.innerText()).not.toContain('finalNode')
      expect(await transcript.locator('[data-qs-turn-tail]').last().innerText()).toMatchSnapshot('closed turn footer')
      for (const width of [1771, 760]) {
        await page.setViewportSize({ width, height: 1000 })
        await prompts.first().locator('summary').click()
        expect(await prompts.first().getAttribute('open')).not.toBeNull()
        const body = prompts.first().locator('div')
        expect(await body.innerText()).not.toBe('')
        expect(await body.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(241)
        expect(await transcript.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await prompts.first().locator('summary').click()
      }
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
