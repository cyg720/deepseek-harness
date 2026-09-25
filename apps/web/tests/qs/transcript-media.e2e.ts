import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'
/** Local images retain Host file policy in the workbench presentation. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Request } from 'playwright'
import { expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, seedSession } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'

it('loads workspace and durable images while retaining unsupported history and file policy', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    await writeFile(join(scaffold.workspaceCwd, 'image.png'), Buffer.from(png, 'base64'))
    // 真实附件仓库保存字节，持久引用仍由当前会话历史授权读取。
    const stored = await scaffold.ctx.attachments.saveImage({ data: Buffer.from(png, 'base64'), mediaType: 'image/png', name: 'stored.png' })
    const session = Session.create(SessionId('qs-media-source'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Show these images' }, { type: 'image', attachment: {
        attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), mediaType: 'image/png', bytes: Buffer.from(png, 'base64').length, width: 1, height: 1,
      } }, { type: 'image', attachment: stored }, { type: 'file', attachment: {
        attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`), name: 'report.bin', bytes: 1,
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
    const mediaId = await seedSession(scaffold, fixture, 'qs-media-history')
    const other = Session.create(SessionId('qs-media-other-source'))
    other.append('turn/start', { turn: 1 })
    other.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Separate history without attachments' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    other.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const otherId = await seedSession(scaffold, [fixture.split('\n')[0],
      ...other.snapshotEvents().map(event => JSON.stringify(event)), ''].join('\n'), 'qs-media-other-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      let attachmentRequest: Request | undefined
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/session/attachment')
          && request.postData()?.includes(String(stored.attachmentId))) attachmentRequest = request
      })
      const responses: number[] = []
      page.on('response', (response) => { if (new URL(response.url()).pathname === '/api/file') responses.push(response.status()) })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${mediaId}"]`).click()
      const image = page.getByRole('img', { name: 'Workspace image', exact: true })
      await image.waitFor()
      await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
      await expect.poll(() => responses.includes(404)).toBe(true)
      const storedImage = page.getByRole('img', { name: 'stored.png', exact: true })
      await expect.poll(() => storedImage.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
      await page.getByRole('button', { name: 'View original image: stored.png', exact: true }).click()
      const original = page.getByRole('dialog', { name: 'stored.png', exact: true })
      await original.waitFor()
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Close original image')
      expect(await original.evaluate(el => el.parentElement === document.body)).toBe(true)
      const bounds = await original.boundingBox()
      expect(bounds?.width).toBe(page.viewportSize()?.width)
      expect(bounds?.height).toBe(page.viewportSize()?.height)
      await page.getByRole('button', { name: 'Close original image', exact: true }).click()
      await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
      expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('View original image: stored.png')
      const retry = page.getByRole('button', { name: 'Image failed to load. Retry', exact: true })
      await retry.waitFor()
      await retry.click()
      await retry.waitFor()
      const unauthenticated = await fetch(new URL(`/api/file?path=${encodeURIComponent(join(scaffold.workspaceCwd, 'image.png'))}`, scaffold.baseUrl))
      expect(unauthenticated.status).toBe(401)
      await unauthenticated.body?.cancel()
      const file = page.locator('[data-qs-file-card]')
      expect(await file.innerText()).toMatchSnapshot('ordinary file history')
      expect(await file.locator('a,button').count()).toBe(0)
      // 同一持久图片在轨迹中仍走会话授权加载器；折叠记录不挂载附件。
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      const history = page.locator('[data-qs-trajectory-history]')
      expect(await history.getByRole('img').count()).toBe(0)
      await history.locator('details').filter({ has: page.locator('summary', { hasText: /^User message/ }) }).locator('summary').click()
      const trajectoryFile = history.locator('[data-qs-trajectory-file]')
      await expect.poll(() => trajectoryFile.count()).toBe(1)
      expect(await trajectoryFile.innerText()).toMatchSnapshot('trajectory file metadata and access limitation')
      expect(await trajectoryFile.locator('a,button').count()).toBe(0)
      const trajectoryImage = history.getByRole('img', { name: 'stored.png', exact: true })
      await expect.poll(() => trajectoryImage.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
      await history.getByRole('button', { name: 'View original image: stored.png', exact: true }).click()
      await page.getByRole('dialog', { name: 'stored.png', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Close original image', exact: true }).click()
      await history.getByRole('button', { name: 'Image failed to load. Retry', exact: true }).waitFor()
      await history.locator('details').filter({ has: page.locator('summary', { hasText: /^User message/ }) }).locator('summary').click()
      await expect.poll(() => history.getByRole('img').count()).toBe(0)
      // 使用已成功读取的实际请求地址和认证头，仅更换会话身份，验证 Host 拒绝越权附件读取。
      if (attachmentRequest === undefined) throw new Error('authorized attachment request was not observed')
      const denied = await page.request.post(attachmentRequest.url(), {
        headers: await attachmentRequest.allHeaders(),
        data: { type: 'client-request', rpcId: 'qs-image-isolation', method: 'session/attachment',
          payload: { args: { request: { sessionId: otherId, attachmentId: stored.attachmentId } } } },
      })
      expect(denied.status()).toBe(200)
      expect(await denied.json()).toMatchObject({ result: { ok: false, error: {
        code: 'session/attachment-invalid', details: { reason: 'ATTACHMENT_NOT_REFERENCED' },
      } } })
      await denied.dispose()
      await page.locator(`[data-qs-session="${otherId}"]`).click()
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      await page.locator(`[data-qs-trajectory="${otherId}"]`).waitFor()
      expect(await page.getByRole('img', { name: 'stored.png', exact: true }).count()).toBe(0)
      expect(await page.getByRole('dialog').count()).toBe(0)
      await page.locator('[data-qs-trajectory-history] summary').first().click()
      await expect.poll(() => page.locator('[data-qs-trajectory-history]').innerText()).toContain('Separate history without attachments')


    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})


/** 压缩历史沿用真实 Host 投影与已构建插件，不请求模型。 */
it('手动压缩只有一条落地记录，摘要可展开，原历史保留且 checkpoint 信封不显示', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const meter: TokenMeter | undefined = scaffold.ctx.get('tokenMeter')
    if (meter === undefined) throw new Error('token meter missing')
    const session = Session.create(SessionId('qs-compaction-source'))
    session.append('turn/start', { turn: 1 })
    const message = createUserMessage({ content: [{ type: 'text', text: 'Original history remains readable' }], source: { kind: 'user' } })
    const original = session.append('user/message', message, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // 与官方 seeded-history 场景一致：按原消息的实际估值记录被替换上下文，不能填假 token 数。
    const events: Array<Record<string, unknown>> = session.snapshotEvents().map(event => ({ ...event }))
    let seq = session.snapshotEvents().at(-1)!.seq + 1
    const add = (type: string, data: unknown, extra: Record<string, unknown> = {}): number => {
      const id = seq++
      events.push({ type, seq: id, time: id, data, ...extra })
      return id
    }
    const commandId = 'qs-compact-command', compactionId = 'qs-compact-transaction'
    add('command/run', { commandId, name: 'compact', args: '', source: { kind: 'user' } })
    const start = add('compaction/start', { compactionId, sourceCommandId: commandId, turn: null })
    const summary = add('compaction/summary', { compactionId, sourceCommandId: commandId,
      summary: [{ type: 'text', text: 'Summary from the durable compaction event' }],
      rawOutput: [{ type: 'reasoning', text: 'Recorded compaction reasoning' }, { type: 'text', text: 'Recorded provider summary' }],
      shadowedRange: { start: original.seq, end: original.seq }, shadowedSeqs: [original.seq],
      shadowedTokenCount: meter.estimateMessage(message), provider: 'fixture', model: 'fixture' })
    add('user/message', createUserMessage({ content: [{ type: 'text', text: '<context_checkpoint>PRIVATE MODEL ENVELOPE</context_checkpoint>' }],
      source: { kind: 'plugin', plugin: 'compact', compactionId, sourceCommandId: commandId } }),
    { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [start, summary, original.seq] })
    add('compaction/end', { compactionId, sourceCommandId: commandId, turn: null })
    add('command/done', { commandId, kind: 'success', text: 'Compaction finished', sourceEventSeq: summary })
    // 独立命令失败与手动压缩不合并；完整错误作为普通文本显示。
    add('command/run', { commandId: 'qs-failed-command', name: 'permission', args: 'private-argument', source: { kind: 'user' } })
    add('command/done', { commandId: 'qs-failed-command', kind: 'error', text: 'Permission update rejected\nHost diagnostic remains readable' })
    add('turn/start', { turn: 2 })
    add('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const log = [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', cwd: '{{cwd}}',
      createdAt: 0, isSeeded: false, delegationDepth: 0 }), ...events.map(event => JSON.stringify(event)), ''].join('\n')
    await seedSession(scaffold, log, 'qs-compaction-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session="qs-compaction-history"]').click()
      const marker = page.locator('[data-qs-compaction]')
      await marker.waitFor()
      expect(await marker.count()).toBe(1)
      expect(await page.locator('[data-qs-manual-compaction]').count()).toBe(1)
      const transcript = page.locator('[data-qs-transcript]')
      expect(await transcript.innerText()).toContain('Original history remains readable')
      expect(await transcript.innerText()).not.toContain('PRIVATE MODEL ENVELOPE')
      expect(await transcript.innerText()).not.toContain('Summary from the durable compaction event')
      await marker.getByRole('button', { name: 'View compaction summary', exact: true }).click()
      expect(await marker.innerText()).toContain('Summary from the durable compaction event')
      expect(await marker.innerText()).toMatchSnapshot('landed manual compaction')
      const command = page.locator('[data-qs-command]')
      expect(await command.count()).toBe(1)
      expect(await command.innerText()).toContain('Command failed')
      expect(await command.innerText()).not.toContain('private-argument')
      await command.getByRole('button', { name: 'View complete command result' }).click()
      expect(await command.innerText()).toContain('Permission update rejected\nHost diagnostic remains readable')
      expect(await command.innerText()).toMatchSnapshot('failed command result')
      // 轨迹请求详情读取同一持久化压缩投影，原始输出默认不挂载。
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      const request = page.locator('[data-qs-trajectory-request]').first()
      await request.waitFor()
      expect(await request.innerText()).not.toContain('Recorded provider summary')
      await request.locator('summary').click()
      await expect.poll(() => request.innerText()).toContain('Recorded provider summary')
      expect(await request.innerText()).toContain('Summary from the durable compaction event')
      expect(await request.innerText()).toContain('Recorded compaction reasoning')
      expect(await request.locator('details').innerText()).toMatchSnapshot('trajectory compaction recorded outputs')


    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
