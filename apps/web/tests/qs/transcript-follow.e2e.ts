/** User submissions restore workbench following through the real Web assembly. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('returns to the latest message after sending from a scrolled historical session', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
    replayFixture: fixture, compareReplaySession: false, paceMs: 15,
  })
  try {
    await seedSession(scaffold, await readFile(fixture, 'utf8'), 'qs-follow-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1200, height: 650 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      await page.locator('[data-qs-turn-tail]').waitFor()
      await page.locator('[data-qs-system-prompt] summary').first().click()
      const scroller = page.locator('[data-qs-scroll]')
      await scroller.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
      expect(await scroller.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(40)
      const prompt = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'
      const settled = scaffold.whenTurnSettled()
      await page.locator('#qs-composer-input').fill(prompt)
      await page.locator('#qs-composer-input').press('Enter')
      await settled
      await expect.poll(() => scroller.evaluate(
        element => element.scrollHeight - element.clientHeight - element.scrollTop,
      )).toBeLessThan(40)
      const transcript = page.locator('[data-qs-transcript]')
      expect(await transcript.innerText()).toContain('DONE')
      expect(await transcript.locator('[data-qs-turn-tail]').last().innerText()).toMatchSnapshot('submitted turn footer')
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
