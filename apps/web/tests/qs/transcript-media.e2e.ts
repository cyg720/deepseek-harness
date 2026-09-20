/** Local images retain Host file policy in the workbench presentation. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, seedSession } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('loads a workspace image and shows unsupported attachment history without bypassing file policy', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    await writeFile(join(scaffold.workspaceCwd, 'image.png'), Buffer.from(png, 'base64'))
    const session = Session.create(SessionId('qs-media-source'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show these images' }, { type: 'image', attachment: {
        attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: Buffer.from(png, 'base64').length, width: 1, height: 1,
      } }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: '![Workspace image](<{{cwd}}/image.png>)\n\n![Missing image](<{{cwd}}/missing.png>)' }],
    }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const fixture = [
      JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', cwd: '{{cwd}}', createdAt: 0, isSeeded: false, delegationDepth: 0 }),
      ...session.snapshotEvents().map(event => JSON.stringify(event)), '',
    ].join('\n')
    await seedSession(scaffold, fixture, 'qs-media-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const responses: number[] = []
      page.on('response', (response) => { if (new URL(response.url()).pathname === '/api/file') responses.push(response.status()) })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const image = page.getByRole('img', { name: 'Workspace image', exact: true })
      await image.waitFor()
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
      await expect.poll(() => responses.includes(404)).toBe(true)
      const unauthenticated = await fetch(new URL(`/api/file?path=${encodeURIComponent(join(scaffold.workspaceCwd, 'image.png'))}`, scaffold.baseUrl))
      expect(unauthenticated.status).toBe(401)
      await unauthenticated.body?.cancel()
      const notice = page.getByText('This message contains images or other non-text content not supported by this workbench. The original session record is preserved and can be viewed in the official interface.', { exact: true })
      expect(await notice.innerText()).toMatchSnapshot('non-text history notice')
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
