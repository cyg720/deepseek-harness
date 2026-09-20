/** Real Host interaction continuations driven through the QS cards. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import { fixtureUserPrompts, launchWebScaffold, seedSession } from '../scaffold.ts'
import { createChatScrollFixture } from '../chat-scroll-fixture.ts'
import { connectFreshWorkspace, newEnglishPage } from '../support.ts'

it.each([
  ['approval-composer', 'allow'], ['approval-composer', 'reject'],
  ['question-composer', 'answer'], ['question-composer', 'stop'],
] as const)('settles the recorded %s turn through QS %s', async (scenario, action) => {
  const fixture = fileURLToPath(new URL(`../../../../snapshots/web/${scenario}/session.v3.jsonl`, import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), 'qs-interaction-'))
  const original = await readFile(fixture, 'utf8')
  const windowsApproval = process.platform === 'win32' && scenario === 'approval-composer'
  const adapted = join(temporary, 'session.v3.jsonl')
  if (windowsApproval || action === 'stop') {
    // Only the external model recording changes; the real platform tool and approval pipeline execute.
    const events = original.trim().split('\n').map(line => JSON.parse(line, (key: string, value: unknown) =>
      windowsApproval && key === 'name' && value === 'bash' ? 'pwsh' : value) as { type: string; data?: { step?: number } })
      .filter(event => action !== 'stop' || event.type !== 'assistant/message' || event.data?.step === 1)
    await writeFile(adapted, events.map(event => JSON.stringify(event)).join('\n') + '\n')
  }
  const scaffold = await launchWebScaffold({
    replayFixture: windowsApproval || action === 'stop' ? adapted : fixture,
    compareReplaySession: !windowsApproval && action === 'answer', paceMs: 15,
    extraOverlayPath: fileURLToPath(new URL('./interaction-roundtrip.overlay.yml', import.meta.url)),
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  try {
    const events: SessionEvent[] = []
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      if (scenario === 'approval-composer') {
        await page.locator('[aria-label^="Access mode"]').click()
        await page.getByRole('menuitem', { name: 'Read Only', exact: true }).click()
        await page.locator('[aria-label="Access mode, current: Read Only"]').waitFor()
      }
      await page.locator('[data-qs-official-return]').click()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.getByRole('checkbox', { name: 'Keep me signed in' }).check()
      await page.locator('#qs-login-password').press('Enter')
      const prompt = fixtureUserPrompts(original)[0]!
      const settled = scaffold.whenTurnSettled(60_000)
      await page.locator('#qs-composer-input').fill(prompt)
      await page.locator('#qs-composer-input').press('Enter')
      const card = page.locator(scenario === 'approval-composer' ? '[data-qs-approval-card]' : '[data-qs-question-card]')
      await card.waitFor().catch(async (error: unknown) => {
        console.error('QS interaction missing:', await page.locator('[data-qs-transcript]').innerText())
        throw error
      })
      // Switching views leaves the Host request and QS answer draft alive.
      if (scenario === 'question-composer') {
        await card.getByRole('checkbox', { name: /^Blue/ }).check()
        await card.getByRole('textbox').fill('Include accessibility notes')
      }
      await page.locator('[data-qs-switch-official]').click()
      await page.locator('[data-qs-official-return]').click()
      await card.waitFor()
      if (scenario === 'question-composer') expect(await card.getByRole('textbox').inputValue()).toBe('Include accessibility notes')
      expect(await card.ariaSnapshot()).toMatchSnapshot(`${scenario} pending QS card`)
      if (action === 'stop') {
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
        await settled
        await expect.poll(() => card.count()).toBe(0)
        expect(events.filter(event => event.type === 'assistant/message').length).toBe(1)
        expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).not.toBe('completed')
        await expect.poll(() => page.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
        return
      }
      await card.getByRole('button', { name: scenario === 'approval-composer'
        ? action === 'reject' ? 'Reject' : 'Allow once' : 'Submit answers', exact: true }).click()
      await settled
      await expect.poll(() => page.locator('[data-qs-transcript]').innerText()).toContain('DONE')
      expect(await card.count()).toBe(0)
      if (scenario === 'approval-composer') {
        expect(JSON.stringify(events.filter(event => event.type === 'approval/decided'))).toContain(action === 'reject' ? 'rejected' : 'allowed-once')
        if (action === 'reject') {
          await expect(readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
          return
        }
        const expected = await readFile(fileURLToPath(new URL('../../../../snapshots/web/approval-composer/workspace.expected/notes.txt', import.meta.url)), 'utf8')
        const written = await readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')
        expect(written.replaceAll('\r\n', '\n')).toBe(expected.replaceAll('\r\n', '\n'))
      } else {
        const results = events.filter(event => event.type === 'tool/result')
        const text = results.flatMap(event => event.data.message.content.flatMap(block => block.type === 'tool-result'
          ? block.content.filter(item => item.type === 'text').map(item => item.text) : [])).at(-1)
        expect(JSON.parse(text ?? '')).toEqual({ answers: [{ id: 'color', selected: ['Blue'], custom: 'Include accessibility notes' }] })
        await page.setViewportSize({ width: 1440, height: 700 })
        await page.getByRole('tab').nth(2).click()
        const handle = page.locator('[data-qs-resize="left"]')
        const initialWidth = await page.locator('[data-qs-root] aside').first().evaluate(element => element.getBoundingClientRect().width)
        const box = await handle.boundingBox()
        if (box === null) throw new Error('desktop resize handle missing')
        await page.mouse.move(box.x + box.width / 2, box.y + 50)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 50, box.y + 50, { steps: 5 })
        await page.mouse.up()
        const width = initialWidth + 50
        await expect.poll(() => page.locator('[data-qs-root] aside').first().evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0)
        await page.locator('[data-qs-system-prompt] summary').first().click()
        const scroller = page.locator('[data-qs-scroll]')
        await scroller.evaluate((element) => { element.scrollTop = 130; element.dispatchEvent(new Event('scroll')) })
        await page.locator('[data-qs-switch-official]').click()
        await page.locator('[data-qs-official-return]').click()
        await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(130)
        await page.reload()
        await page.locator('[data-qs-official-return]').click()
        await page.locator('#qs-composer-input').waitFor()
        expect(await page.locator('#qs-login-user').count()).toBe(0)
        expect(await page.getByRole('tab').nth(2).getAttribute('aria-selected')).toBe('true')
        await expect.poll(() => page.locator('[data-qs-root] aside').first().evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0)
      }
    } catch (error) { console.error('QS roundtrip primary failure', error); throw error }
    finally { await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
})

it('keeps the first visible historical row anchored while prepending an older page', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
  })
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS pagination', turns: 40 })
    await seedSession(scaffold, history.log, 'qs-pagination')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session="qs-pagination"]').click()
      const older = page.getByRole('button', { name: 'Load earlier records', exact: true })
      await older.waitFor()
      await page.locator('[data-qs-scroll]').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
      const oldRow = page.locator('[data-qs-node]').first()
      const key = await oldRow.getAttribute('data-qs-node')
      const top = await oldRow.evaluate(element => element.getBoundingClientRect().top)
      const count = await page.locator('[data-qs-node]').count()
      await older.click()
      await expect.poll(() => page.locator('[data-qs-node]').count()).toBeGreaterThan(count)
      const held = page.locator(`[data-qs-node="${key}"]`)
      await expect.poll(() => held.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(top, 0)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
