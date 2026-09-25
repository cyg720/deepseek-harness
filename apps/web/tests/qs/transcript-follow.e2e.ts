/** User submissions restore workbench following through the real Web assembly. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type WebSocket, type WebSocketRoute } from 'playwright'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from '../scaffold.ts'
import { newEnglishPage } from '../support.ts'
import { pdfFixture } from '../../../../packages/client/ui-sidebar-documentpreview/tests/pdf-fixture.ts'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-token-meter'

it('retains a slash draft when the command directory fails and executes it after recovery', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const fixture = fileURLToPath(new URL('../../../../snapshots/web/present/session.v3.jsonl', import.meta.url))
    const id = await seedSession(scaffold, await readFile(fixture, 'utf8'), 'qs-command-directory-failure')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      let failing = true, refused = 0, prompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/session/prompt') prompts++ })
      // 只中断目录 RPC，命令执行及普通消息提交仍使用真实 Host。
      await page.route('**/api/commands/list', async (route) => {
        if (failing) { refused++; await route.abort('connectionfailed') } else await route.continue()
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      const editor = page.locator('#qs-composer-input')
      await editor.fill('/permission read-only')
      await editor.press('Escape')
      await editor.press('Enter')
      await page.locator('[role="alert"]').first().waitFor()
      expect(refused).toBeGreaterThan(0)
      expect(await editor.inputValue()).toBe('/permission read-only')
      expect(prompts).toBe(0)
      failing = false
      await editor.press('Enter')
      await expect.poll(() => page.locator('[data-qs-command]').last().innerText()).toContain('Command completed')
      await expect.poll(() => editor.inputValue()).toBe('')
      expect(prompts).toBe(0)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

it('hot-reloads every assembled QS plugin twice without duplicating styles or losing the draft', async () => {
  const scaffold = await launchWebScaffold({ directoryPicker: 'auto', extraOverlayPath: fileURLToPath(new URL('../../../../qishu/config/schedule.patch.yml', import.meta.url)) })
  const release = Promise.withResolvers<undefined>()
  const arrived = Promise.withResolvers<undefined>()
  try {
    const id = SessionId('qs-family-reload')
    await seedSession(scaffold, await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8'), id)
    const entries = scaffold.ctx.clientModules.graph().entries.filter(entry => entry.id.startsWith('@deepseek-ai/dsh-qs-'))
    const shell = entries.find(entry => entry.id === '@deepseek-ai/dsh-qs-shell')
    if (!shell) throw new Error('QS shell is absent from the real module graph')
    expect(entries).toHaveLength(33)
    expect(entries.some(entry => entry.id === '@deepseek-ai/dsh-qs-ui-schedule')).toBe(true)
    const ordered = [...entries.filter(entry => entry !== shell), shell]
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      const consoleErrors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      let sent = false
      // 仅替换构建通知，模块字节、Loader、Cordis与业务服务保持真实；每轮以外壳完成重载收尾。
      await page.route('**/plugins/events', async (route) => {
        if (sent) { await route.continue(); return }
        sent = true
        arrived.resolve(undefined)
        await release.promise
        const frames = [...ordered, ...ordered].map(entry => `data: ${JSON.stringify({ type: 'rebuilt', id: entry.id, rev: entry.rev })}\n\n`).join('')
        await route.fulfill({ contentType: 'text/event-stream', body: frames })
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.getByRole('checkbox', { name: 'Keep me signed in' }).check()
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      await page.locator('#qs-composer-input').fill('Draft retained across the QS plugin family reload')
      await arrived.promise
      const marker = await page.evaluate(() => {
        const watched = document.querySelector('style[data-plugin="@deepseek-ai/dsh-qs-shell"]')
        if (!watched) throw new Error('QS shell style is not materialized')
        const cssId = watched.getAttribute('data-plugin-css')
        const identity = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
        document.documentElement.dataset.qsFamilyDocument = identity
        document.documentElement.dataset.qsFamilyReloads = '0'
        let added = 0
        const observer = new MutationObserver((records) => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof HTMLStyleElement && node.getAttribute('data-plugin') === '@deepseek-ai/dsh-qs-shell'
              && node.getAttribute('data-plugin-css') === cssId) added++
          }
          document.documentElement.dataset.qsFamilyReloads = String(added)
          if (added >= 2) observer.disconnect()
        })
        observer.observe(document.head, { childList: true })
        return identity
      })
      release.resolve(undefined)
      await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.qsFamilyReloads)), { timeout: 30_000 }).toBe(2)
      await page.locator(`[data-qs-session="${id}"]`).click()
      await expect.poll(() => page.locator('#qs-composer-input').inputValue()).toBe('Draft retained across the QS plugin family reload')
      expect(await page.locator('[data-qs-root]').count()).toBe(1)
      expect(await page.evaluate(() => document.documentElement.dataset.qsFamilyDocument)).toBe(marker)
      const styleIds = await page.locator('style[data-plugin]').evaluateAll(styles => styles.map(style => `${style.getAttribute('data-plugin')}:${style.getAttribute('data-plugin-css')}`))
      expect(new Set(styleIds).size).toBe(styleIds.length)
      await page.locator('[data-qs-switch-official]').click()
      await page.locator('[data-qs-official-return]').click()
      await expect.poll(() => page.locator('#qs-composer-input').inputValue()).toBe('Draft retained across the QS plugin family reload')
      expect(errors.pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
      process.stdout.write(JSON.stringify({ scenario: 'qs-family-reload', cycles: 2, plugins: entries.map(entry => entry.id) }) + '\n')
    } finally { release.resolve(undefined); await browser.close() }
  } finally { release.resolve(undefined); await scaffold.close() }
})

it('shows real Host job transitions in the independent Qishu header contribution', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  const producers: ReturnType<typeof Promise.withResolvers<JobOutcome>>[] = []
  const waiters: Promise<unknown>[] = []
  try {
    const sessionId = SessionId('qs-jobs-history')
    await seedSession(scaffold, await readFile(fixture, 'utf8'), sessionId)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 980, height: 700 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const jobs = page.locator('[data-qs-jobs]')
      await jobs.getByRole('button', { name: 'Background jobs (0)' }).click()
      await jobs.getByText('No jobs in this session.', { exact: true }).waitFor()
      const resolved = await scaffold.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw new Error(resolved.error.message)
      // 只控制非确定性的生产者完成时机；注册、权限、控制流和界面均使用实际装配。
      for (const outcome of ['completed', 'failed', 'killed'] as const) {
        const producer = Promise.withResolvers<JobOutcome>()
        producers.push(producer)
        const id = scaffold.ctx.jobs.start({
          kind: 'bash', label: `QS ${outcome} ${'long-label-'.repeat(18)}`, owner: resolved.agent,
          run: () => ({ done: producer.promise, cancel: () => {} }),
        })
        // 等待方认领结果，避免完成通知意外发起模型请求。
        waiters.push(scaffold.ctx.jobs.wait(id, 60_000, resolved.agent))
        const row = jobs.locator(`[data-qs-job="${id}"]`)
        await row.getByText('Running', { exact: true }).waitFor()
        if (outcome === 'killed') {
          expect(scaffold.ctx.jobs.kill(id, resolved.agent, 'test cancellation')).toBe('requested')
          await row.getByText('Stopping', { exact: true }).waitFor()
        }
        producer.resolve({ status: outcome })
        await row.getByText({ completed: 'Completed', failed: 'Failed', killed: 'Terminated' }[outcome], { exact: true }).waitFor()
        // 通知须由真实 Host 转换触发，原始作业标签及结果不自动进入 toast。
        const notification = page.locator('[data-qs-overlay] [data-visible="true"]').filter({ hasText:
          { completed: 'completed.', failed: 'failed. Check', killed: 'was terminated.' }[outcome],
        })
        await notification.waitFor()
        expect(await notification.count()).toBe(1)
        expect(await notification.innerText()).not.toContain('long-label-')
        expect(await notification.ariaSnapshot()).toMatchSnapshot(`QS ${outcome} job notification`)
        expect(await row.getByText('This job provided no detail.', { exact: true }).count()).toBe(1)
      }
      expect(await jobs.getByRole('button').allTextContents()).toEqual(['Background jobs (3)', 'Return to session'])
      expect(await jobs.locator('li > div > span:last-child').allTextContents()).toMatchInlineSnapshot(`
        [
          "Terminated",
          "Failed",
          "Completed",
        ]
      `)
      await jobs.getByText('No result body is provided; completion does not guarantee a file or answer.', { exact: true }).waitFor()
      const panel = jobs.getByRole('region')
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      const box = await panel.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(980)
      await jobs.getByRole('button', { name: 'Return to session' }).click()
      expect(await panel.count()).toBe(0)
      await expect.poll(() => jobs.getByRole('button').evaluate(element => element === document.activeElement)).toBe(true)
      await page.reload()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      await jobs.getByRole('button', { name: 'Background jobs (3)' }).waitFor()
      expect(await page.locator('[data-qs-overlay] [data-visible="true"]').count()).toBe(0)
    } finally { await browser.close() }
  } finally {
    for (const producer of producers) producer.resolve({ status: 'killed' })
    await Promise.allSettled(waiters)
    await scaffold.close()
  }
})

it('keeps offline job completion silent after reconnect and notifies subsequent live work', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  const producers: ReturnType<typeof Promise.withResolvers<JobOutcome>>[] = []
  const waiters: Promise<unknown>[] = []
  try {
    const id = SessionId('qs-jobs-reconnect')
    await seedSession(scaffold, await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8'), id)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const sockets: WebSocketRoute[] = []
      const tripwire = watchConsole(page)
      await page.routeWebSocket('**/api/remote.mux', (route) => {
        sockets.push(route)
        route.connectToServer()
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      const jobs = page.locator('[data-qs-jobs]')
      await jobs.getByRole('button', { name: 'Background jobs (0)' }).click()
      const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw new Error(resolved.error.message)
      for (const offline of [true, false]) {
        const producer = Promise.withResolvers<JobOutcome>()
        producers.push(producer)
        const jobId = scaffold.ctx.jobs.start({ kind: 'bash', label: 'Synthetic reconnect job', owner: resolved.agent,
          run: () => ({ done: producer.promise, cancel: () => {} }),
        })
        const waiter = scaffold.ctx.jobs.wait(jobId, 60_000, resolved.agent)
        waiters.push(waiter)
        const row = jobs.locator(`[data-qs-job="${jobId}"]`)
        await row.getByText('Running', { exact: true }).waitFor()
        if (offline) {
          // 浏览器离线不保证关闭已有 WebSocket；同时断开真实载体，生产流自行恢复。
          await page.context().setOffline(true)
          await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
          await page.locator('[data-qs-status="disconnected"]').waitFor({ timeout: 10_000 })
          for (const socket of sockets) await socket.close({ code: 1001, reason: 'synthetic network loss' })
          await jobs.getByText('Reconnecting; existing records may be stale.', { exact: true }).waitFor({ timeout: 15_000 })
        }
        producer.resolve({ status: 'completed' })
        await waiter
        if (offline) await page.context().setOffline(false)
        await row.getByText('Completed', { exact: true }).waitFor({ timeout: 30_000 })
        const notices = page.locator('[data-qs-overlay] [data-visible="true"]')
        if (offline) {
          await expect.poll(() => jobs.getByRole('status').count()).toBe(0)
          expect(await notices.count()).toBe(0)
        } else {
          await notices.waitFor()
          expect(await notices.count()).toBe(1)
          expect(await notices.innerText()).toContain('completed.')
        }
      }
      expect(tripwire.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally {
    for (const producer of producers) producer.resolve({ status: 'killed' })
    await Promise.allSettled(waiters)
    await scaffold.close()
  }
})

it('isolates task notifications when the same session identity is opened on different Hosts', async () => {
  const options = { extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) }
  const first = await launchWebScaffold(options)
  const producers: ReturnType<typeof Promise.withResolvers<JobOutcome>>[] = []
  const waiters: Promise<unknown>[] = []
  try {
    const second = await launchWebScaffold(options)
    try {
      const id = SessionId('qs-same-session-two-hosts')
      const fixture = await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8')
      await seedSession(first, fixture, id)
      await seedSession(second, fixture, id)
      const browser = await chromium.launch()
      try {
        const page = await newEnglishPage(browser)
        const tripwire = watchConsole(page)
        const open = async (scaffold: typeof first) => {
          await page.goto(scaffold.authenticatedUrl)
          await page.locator('#qs-login-user').fill('admin')
          await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
          await page.locator(`[data-qs-session="${id}"]`).click()
          await page.locator('[data-qs-jobs] > button').click()
        }
        const start = async (scaffold: typeof first) => {
          const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
          if ('error' in resolved) throw new Error(resolved.error.message)
          const producer = Promise.withResolvers<JobOutcome>()
          producers.push(producer)
          const jobId = scaffold.ctx.jobs.start({ kind: 'bash', label: 'Synthetic same-ID Host job', owner: resolved.agent,
            run: () => ({ done: producer.promise, cancel: () => {} }),
          })
          const waiter = scaffold.ctx.jobs.wait(jobId, 60_000, resolved.agent)
          waiters.push(waiter)
          await page.locator(`[data-qs-job="${jobId}"]`).getByText('Running', { exact: true }).waitFor()
          return { producer, waiter, jobId }
        }
        await open(first)
        const old = await start(first)
        await open(second)
        const current = await start(second)
        // A 的迟到失败不能污染同一浏览器在 B 上的同名会话。
        old.producer.resolve({ status: 'failed' }); await old.waiter
        expect(await page.locator('[data-qs-overlay] [data-visible="true"]').count()).toBe(0)
        await page.locator(`[data-qs-job="${current.jobId}"]`).getByText('Running', { exact: true }).waitFor()
        current.producer.resolve({ status: 'completed' }); await current.waiter
        const notice = page.locator('[data-qs-overlay] [data-visible="true"]')
        await notice.waitFor()
        expect(await notice.count()).toBe(1)
        expect(await notice.innerText()).toContain('completed.')
        expect(await notice.innerText()).not.toContain('failed.')
        await open(first)
        await page.locator(`[data-qs-job="${old.jobId}"]`).getByText('Failed', { exact: true }).waitFor()
        expect(await notice.count()).toBe(0)
        expect(tripwire.pageErrors).toEqual([])
      } finally { await browser.close() }
    } finally {
      for (const producer of producers) producer.resolve({ status: 'killed' })
      await Promise.allSettled(waiters)
      await second.close()
    }
  } finally { await first.close() }
})

it('replaces the connection plugin on the same page and restores live QS jobs', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  const release = Promise.withResolvers<undefined>()
  const arrived = Promise.withResolvers<undefined>()
  const producers: ReturnType<typeof Promise.withResolvers<JobOutcome>>[] = []
  const waiters: Promise<unknown>[] = []
  try {
    const id = SessionId('qs-connection-replacement')
    await seedSession(scaffold, await readFile(new URL('../../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url), 'utf8'), id)
    const connection = scaffold.ctx.clientModules.graph().entries.find(row => row.id === '@deepseek-ai/dsh-client-connection')
    if (connection === undefined) throw new Error('Real connection bundle is absent')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      const sockets: WebSocket[] = []
      const consoleErrors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
      page.on('websocket', socket => sockets.push(socket))
      let sent = false
      // 只控制一次构建通知；实际 bundle、Cordis 卸载重装和 HTTP/WebSocket 都走生产实现。
      await page.route('**/plugins/events', async (route) => {
        if (sent) { await route.continue(); return }
        sent = true
        arrived.resolve(undefined)
        await release.promise
        await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'rebuilt', id: connection.id, rev: connection.rev })}\n\n` })
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      await page.locator('[data-qs-jobs] > button').click()
      await page.getByText('No jobs in this session.', { exact: true }).waitFor()
      await arrived.promise
      const documentIdentity = await page.evaluate(() => {
        const marker = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
        document.documentElement.dataset.qsConnectionTest = marker
        return marker
      })
      const previous = [...sockets]
      expect(previous.length).toBeGreaterThan(0)
      release.resolve(undefined)
      await expect.poll(() => previous.every(socket => socket.isClosed())).toBe(true)
      await expect.poll(() => sockets.some(socket => !previous.includes(socket) && !socket.isClosed())).toBe(true)
      // 连接根重装可能级联重建本地登录插件；仍在同一文档完成静态登录，不以导航替代恢复。
      const sessionRow = page.locator(`[data-qs-session="${id}"]`)
      try {
        await sessionRow.or(page.locator('#qs-login-user')).first().waitFor()
      } catch (error) {
        console.error(JSON.stringify({ body: await page.locator('body').innerText(), consoleErrors, errors }, null, 2))
        throw error
      }
      if (await page.locator('#qs-login-user').isVisible()) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.locator(`[data-qs-session="${id}"]`).click()
      const jobs = page.locator('[data-qs-jobs]')
      await jobs.locator(':scope > button').click()
      await page.getByText('No jobs in this session.', { exact: true }).waitFor()
      expect(await page.evaluate(() => document.documentElement.dataset.qsConnectionTest)).toBe(documentIdentity)
      const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw new Error(resolved.error.message)
      const producer = Promise.withResolvers<JobOutcome>()
      producers.push(producer)
      const jobId = scaffold.ctx.jobs.start({ kind: 'bash', label: 'Job after connection replacement', owner: resolved.agent,
        run: () => ({ done: producer.promise, cancel: () => {} }),
      })
      const waiter = scaffold.ctx.jobs.wait(jobId, 60_000, resolved.agent)
      waiters.push(waiter)
      await jobs.locator(`[data-qs-job="${jobId}"]`).getByText('Running', { exact: true }).waitFor()
      producer.resolve({ status: 'completed' })
      await waiter
      await jobs.locator(`[data-qs-job="${jobId}"]`).getByText('Completed', { exact: true }).waitFor()
      const notice = page.locator('[data-qs-overlay] [data-visible="true"]')
      await notice.waitFor()
      expect(await notice.count()).toBe(1)
      expect(await notice.innerText()).toContain('completed.')
      expect(errors.pageErrors).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      release.resolve(undefined)
      await browser.close()
    }
  } finally {
    for (const producer of producers) producer.resolve({ status: 'killed' })
    await Promise.allSettled(waiters)
    await scaffold.close()
  }
})

it('opens durable delivered files in Qishu without issuing native desktop actions', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/present/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    // 官方录制日志提供真实交付坐标；文件内容写入本例独占工作区供 Host 预览读取。
    await writeFile(join(scaffold.workspaceCwd, 'report.txt'), 'DELIVERED_REPORT\n')
    await writeFile(join(scaffold.workspaceCwd, '说明.txt'), 'DELIVERED_NOTE\n')
    await seedSession(scaffold, await readFile(fixture, 'utf8'), 'qs-delivered-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), nativeRequests: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('/api/present.open')) nativeRequests.push(request.url())
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const cards = page.locator('[data-qs-deliverables]')
      await cards.getByRole('button', { name: 'Preview report.txt', exact: true }).waitFor()
      await cards.getByRole('button', { name: 'Preview report.txt', exact: true }).click()
      const preview = page.locator('[data-qs-document]')
      await expect.poll(() => preview.innerText()).toContain('DELIVERED_REPORT')
      await cards.getByRole('button', { name: 'Preview 说明.txt', exact: true }).click()
      await expect.poll(() => preview.innerText()).toContain('DELIVERED_NOTE')
      // 助手行内引用使用官方词表；预览仍属于同一会话，不触发本机动作。
      const mention = page.locator('article').getByRole('button', { name: 'Open report.txt in sidebar', exact: true })
      await mention.click()
      await expect.poll(() => preview.innerText()).toContain('DELIVERED_REPORT')
      expect(nativeRequests).toEqual([])
      expect(await cards.getByRole('button', { name: 'Preview report.txt', exact: true }).count()).toBe(1)
      expect(await cards.getByRole('button', { name: 'Open in default app' }).count()).toBe(2)
      expect(await cards.locator('li > button').allTextContents()).toMatchSnapshot('QS durable delivered files')
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

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
      // 已落地请求的 token-meter 投影必须穿过会话座席到达输入区，不能靠组件假数据通过。
      const pressure = page.locator('[data-qs-context-pressure]')
      const estimate = pressure.getByRole('button', { name: /^Estimated context:/ })
      await estimate.waitFor()
      await estimate.click()
      expect(await pressure.innerText()).toContain('Estimated use:')
      expect(await pressure.innerText()).toContain('Composition is heuristic')
      // 平台工具与提示词不同，组成估算必须对照本次 Host 投影，不能固定为录制机的 token 数。
      const session = scaffold.ctx.sessions.get(SessionId('qs-follow-history'))
      if (session === undefined) throw new Error('Settled session is not attached')
      const breakdown = scaffold.ctx.sessionProjections.stateOf(session, 'contextBreakdown')?.breakdown
      if (breakdown === undefined) throw new Error('Host context breakdown is missing')
      expect(await pressure.innerText()).toBe([
        'Estimated context: 6%',
        'Estimated use: 7941 / 128000 tokens',
        'Samples may come from different times; model switches may temporarily retain estimates from the previous request.',
        `Estimated system prompt: ${breakdown.systemTokens} tokens`,
        `Estimated tool definitions: ${breakdown.toolsTokens} tokens`,
        `Estimated messages: ${breakdown.messageTokens} tokens`,
        'Composition is heuristic and may not sum to context usage; it does not represent billing or actual usage for this turn.',
      ].join('\n\n'))

      expect(await transcript.locator('[data-qs-turn-tail]').last().innerText()).toMatchSnapshot('submitted turn footer')
      // 带参数命令通过官方输入机执行，结果需真实落入命令投影，不能当普通聊天发送。
      const editor = page.locator('#qs-composer-input')
      await editor.fill('/goa')
      const menu = page.locator('[data-qs-command-menu]')
      await menu.getByRole('option').filter({ hasText: /goal/i }).first().waitFor()
      await editor.press('ArrowDown')
      await editor.press('Enter')
      await expect.poll(() => editor.inputValue()).toMatch(/^\/goal/)
      expect(await editor.getAttribute('readonly')).toBeNull()
      await expect.poll(() => menu.count()).toBe(0)
      await page.locator('#qs-composer-input').fill('/permission read-only')
      await page.locator('#qs-composer-input').press('Enter')
      expect(await scroller.evaluate(element => element.clientHeight)).toBeGreaterThan(0)
      const command = transcript.locator('[data-qs-command]').last()
      await expect.poll(() => command.innerText()).toContain('Command completed')
      await command.getByRole('button', { name: 'View complete command result' }).click()
      expect(await command.innerText()).toContain('preset read-only')
      expect(await page.locator('#qs-composer-input').inputValue()).toBe('')

      // 裸命令走官方弹层装饰：风险取消不执行，最终选择才消费原命令草稿。
      await editor.fill('/permission')
      await editor.press('Escape')
      await editor.press('Enter')
      const popup = page.locator('[data-qs-command-popup]')
      await popup.getByRole('option', { name: /Full access/ }).waitFor()
      expect(await editor.getAttribute('readonly')).not.toBeNull()
      await popup.getByRole('option', { name: /Full access/ }).click()
      const risk = page.getByRole('dialog', { name: 'Enable Full access?' })
      await risk.waitFor()
      // 真正进入浏览器 top layer，且继承 QS 根主题；控制器测试无法证明这些呈现事实。
      expect(await risk.evaluate(element => element.matches(':modal'))).toBe(true)
      expect(await risk.evaluate(element => element.closest('[data-qs-root]') !== null)).toBe(true)
      expect(await risk.evaluate(element => element.contains(document.activeElement))).toBe(true)
      expect(await risk.evaluate(element => getComputedStyle(element).getPropertyValue('--qs-surface').trim())).not.toBe('')
      expect(await risk.innerText()).toMatchSnapshot('command risk confirmation')
      await page.keyboard.press('Escape')
      await popup.getByRole('textbox').waitFor()
      expect(await editor.inputValue()).toBe('/permission')
      await popup.getByRole('option', { name: /Full access/ }).click()
      await risk.waitFor()
      expect(await risk.getByRole('button', { name: 'Enable Full access', exact: true }).isDisabled()).toBe(true)
      await risk.getByRole('button', { name: 'Cancel', exact: true }).click()
      await popup.getByRole('textbox').waitFor()
      expect(await editor.inputValue()).toBe('/permission')
      await popup.getByRole('option', { name: /Read Only/ }).click()
      await expect.poll(() => popup.count()).toBe(0)
      await expect.poll(() => editor.inputValue()).toBe('')
      await expect.poll(() => editor.evaluate(element => document.activeElement === element)).toBe(true)
      expect(await editor.getAttribute('readonly')).toBeNull()

    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it('records message feedback durably, retains failed drafts, and separates bare session feedback', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    await seedSession(scaffold, await readFile(fixture, 'utf8'), 'qs-feedback-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const good = page.getByRole('button', { name: 'Good response' }).first()
      await good.click()
      const dialog = page.getByRole('dialog', { name: 'Submit feedback' })
      await dialog.waitFor()
      const agent = scaffold.ctx.agents.get(SessionId('qs-feedback-history'))
      if (agent === undefined) throw new Error('feedback fixture agent missing')
      const beforeCancel = agent.session.snapshotEvents().filter(event => event.type.startsWith('feedback/'))
      const inputDetail = dialog.getByRole('textbox', { name: 'Feedback details' })
      // 取消只丢弃未提交草稿；在真实会话日志核对零写入，不用弹窗消失代替。
      for (const cancel of ['escape', 'button']) {
        await inputDetail.fill('Never submit this draft')
        if (cancel === 'escape') await page.keyboard.press('Escape')
        else await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click()
        await expect.poll(() => dialog.count()).toBe(0)
        expect(agent.session.snapshotEvents().filter(event => event.type.startsWith('feedback/'))).toEqual(beforeCancel)
        await good.click()
        await dialog.waitFor()
        expect(await inputDetail.inputValue()).toBe('')
      }
      // 原生模态必须继承工作台主题，且打开后键盘焦点位于表单内部。
      expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true)
      expect(await dialog.evaluate(element => element.closest('[data-qs-root]') !== null)).toBe(true)
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
      expect(await dialog.innerText()).toContain('Feedback target: assistant message')
      expect(await dialog.innerText()).toMatchSnapshot('feedback form target and categories')
      await dialog.getByRole('button', { name: 'Task result', exact: true }).click()
      const detail = dialog.getByRole('textbox', { name: 'Feedback details' })
      await detail.fill('x'.repeat(8193))
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await dialog.getByRole('alert').waitFor()
      expect(await detail.inputValue()).toHaveLength(8193)
      await detail.fill('  QS feedback evidence  ')
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      await page.getByRole('button', { name: 'Remove positive rating' }).first().waitFor()
      const puts = agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-put')
      expect(puts).toHaveLength(1)
      expect(puts[0]!.data.item).toMatchObject({ rating: 'positive', note: 'QS feedback evidence', category: 'task-result' })

      // 冷页面只能从真实 Host 重新读取已保存评价，不能依赖组件内存。
      await page.reload()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      await page.getByRole('button', { name: 'Good response' }).first().hover()
      const rated = page.getByRole('button', { name: 'Remove positive rating' }).first()
      await rated.waitFor()
      await rated.click()
      await expect.poll(() => agent.session.snapshotEvents().at(-1)?.type).toBe('feedback/message-delete')

      await page.getByRole('button', { name: 'Bad response', exact: true }).first().click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Instruction understanding and following', exact: true }).click()
      await detail.fill('QS negative feedback evidence')
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      const negative = page.getByRole('button', { name: 'Remove negative rating', exact: true }).first()
      await negative.waitFor()
      const allPuts = agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-put')
      expect(allPuts).toHaveLength(2)
      expect(allPuts[1]!.data.item).toMatchObject({ messageId: puts[0]!.data.item.messageId,
        rating: 'negative', category: 'instruction-following', note: 'QS negative feedback evidence' })
      await negative.click()
      await expect.poll(() => agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-delete').length).toBe(2)
      const deletes = agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-delete')
      expect(deletes.map(event => event.data.messageId)).toEqual([puts[0]!.data.item.messageId, puts[0]!.data.item.messageId])
      const editor = page.locator('#qs-composer-input')
      await editor.fill('/feedback'); await editor.press('Escape'); await editor.press('Enter')
      await dialog.waitFor()
      expect(await dialog.innerText()).toContain('Feedback target: current session')
      expect(await dialog.innerText()).not.toContain('Feedback target: assistant message')
      await detail.fill('QS session evidence')
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect.poll(() => dialog.count()).toBe(0)
      await expect.poll(() => agent.session.snapshotEvents().filter(event => event.type === 'feedback/record').length).toBe(1)
      const record = agent.session.snapshotEvents().find(event => event.type === 'feedback/record')
      expect(record?.data).toMatchObject({ text: 'QS session evidence' })
      // 带参反馈继续走 Host 命令，不打开表单或启动模型轮次。
      await editor.fill('/feedback QS typed evidence')
      await editor.press('Enter')
      await expect.poll(() => agent.session.snapshotEvents().filter(event => event.type === 'feedback/record').length).toBe(2)
      expect(await dialog.count()).toBe(0)
      const records = agent.session.snapshotEvents().filter(event => event.type === 'feedback/record')
      expect(records.at(-1)?.data).toMatchObject({ text: 'QS typed evidence' })
      // 阻塞真实 Host 的响应而非业务写入，复现已保存但旧表单尚未收到确认的时序。
      const accepted = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      await page.route('**/api/messageFeedback/put', async (route) => {
        const response = await route.fetch()
        accepted.resolve(undefined)
        await release.promise
        await route.fulfill({ response })
      }, { times: 1 })
      try {
        await page.getByRole('button', { name: 'Good response', exact: true }).first().click()
        await dialog.waitFor()
        await detail.fill('Saved before dialog closes')
        await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
        await accepted.promise
        const committed = agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-put')
        expect(committed).toHaveLength(3)
        expect(committed.at(-1)?.data.item).toMatchObject({ messageId: puts[0]!.data.item.messageId,
          rating: 'positive', note: 'Saved before dialog closes' })
        expect(await dialog.getByRole('button', { name: 'Submitting…', exact: true }).isDisabled()).toBe(true)
        expect(await dialog.innerText()).toContain('Closing does not cancel feedback already sent.')
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click()
        await expect.poll(() => dialog.count()).toBe(0)
        await editor.fill('/feedback'); await editor.press('Escape'); await editor.press('Enter')
        await dialog.waitFor()
        await detail.fill('New session draft survives the old response')
        const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/messageFeedback/put')
        release.resolve(undefined)
        await response
        await page.getByRole('button', { name: 'Remove positive rating', exact: true }).first().waitFor()
        expect(await dialog.innerText()).toContain('Feedback target: current session')
        expect(await detail.inputValue()).toBe('New session draft survives the old response')
        expect(await dialog.getByRole('button', { name: 'Submit', exact: true }).isEnabled()).toBe(true)
        expect(agent.session.snapshotEvents().filter(event => event.type === 'feedback/record')).toHaveLength(2)
        expect(agent.session.snapshotEvents().filter(event => event.type === 'feedback/message-put')).toHaveLength(3)
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).first().click()
      } finally {
        release.resolve(undefined)
        await page.unrouteAll({ behavior: 'wait' })
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

it('preserves session tabs across official and Qishu presentations and renders docking gestures', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    // 文件树使用隔离工作区中的真实目录，切换呈现后仍需保留展开状态。
    await mkdir(join(scaffold.workspaceCwd, 'qs-tree-fixture'))
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'sample.txt'), 'QS file tree evidence\n')
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'guide.md'), '# QS guide\n\n**Shared preview**\n\n<script>window.qsPreviewUnsafe=true</script>\n')
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="parent.qsSvgUnsafe=true"><script>parent.qsSvgUnsafe=true</script><rect width="120" height="80" fill="green"/></svg>')
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'preview.html'), '<!doctype html><link rel="stylesheet" href="./preview.css"><h1 id="result">Loading</h1><p id="isolation"></p><script src="./preview.js"></script>')
    // 复用官方无网络 PDF，验证真实 worker 绘制而非只检查空画布。
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'sample.pdf'), pdfFixture())
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'preview.css'), '#result { color: rgb(12, 34, 56) }')
    await writeFile(join(scaffold.workspaceCwd, 'qs-tree-fixture', 'preview.js'), 'document.getElementById("result").textContent="QS relative script";try{parent.document.body;document.getElementById("isolation").textContent="unsafe"}catch{document.getElementById("isolation").textContent="parent blocked"}')
    await seedSession(scaffold, await readFile(fixture, 'utf8'), 'qs-panel-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1400, height: 850 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const panel = page.locator('[data-qs-panel-session]')
      await panel.waitFor()
      await panel.getByRole('button', { name: 'Fullscreen', exact: true }).click()
      // 全屏范围随外壳内容区变化，不遮挡各断点高度不同的顶栏。
      const panelMatchesWorkspace = () => panel.evaluate((element) => {
        const header = element.closest('[data-qs-root]')!.querySelector('header')!.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        return Math.abs(rect.top - header.bottom) < 1 && Math.abs(rect.left) < 1
          && Math.abs(rect.right - innerWidth) < 1 && Math.abs(rect.bottom - innerHeight) < 1
      })
      await expect.poll(panelMatchesWorkspace).toBe(true)
      for (const width of [1700, 390, 1400]) {
        await page.setViewportSize({ width, height: 850 })
        // 等待实际导航面板的可访问状态提交；视口状态不属于持久偏好。
        if (width !== 1700) await expect.poll(() => page.locator('[data-slot="qs.sidebar"] aside').getAttribute('inert'))
          .toBe(width <= 700 ? '' : null)
        if (width <= 700) await page.getByRole('button', { name: 'Expand the right panel', exact: true }).click()
        await expect.poll(() => panel.getAttribute('inert')).toBeNull()
        await expect.poll(panelMatchesWorkspace).toBe(true)
      }
      await panel.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
      await panel.getByRole('button', { name: 'New tab', exact: true }).click()
      const guide = panel.locator('[data-qs-panel-guide]')
      await guide.waitFor()
      expect(await guide.innerText()).toMatchSnapshot('registered panel guide')
      const tab = panel.getByRole('tab', { name: /Start/ })
      const box = await tab.boundingBox()
      if (box === null) throw new Error('Guide tab has no layout box')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(650, 300, { steps: 10 })
      await page.mouse.up()
      const floating = page.locator('[data-qs-panel-floats]')
      await floating.waitFor()
      expect(await floating.evaluate(element => element.closest('[data-qs-root]') !== null)).toBe(true)
      await floating.getByRole('button', { name: 'Send back to the sidebar' }).click()
      await expect.poll(() => floating.count()).toBe(0)
      await guide.getByRole('button', { name: 'Workspace files', exact: true }).click()
      const tree = panel.locator('[data-qs-files]')
      const folder = tree.getByRole('button', { name: 'qs-tree-fixture', exact: true })
      await folder.click()
      await tree.getByRole('button', { name: 'sample.txt', exact: true }).waitFor()
      await tree.getByRole('button', { name: 'Reload directories', exact: true }).click()
      await tree.getByRole('button', { name: 'sample.txt', exact: true }).waitFor()
      const ids = await panel.locator('[data-dockkit-tab]').evaluateAll(elements => elements.map(element => element.getAttribute('data-dockkit-tab')))
      await page.locator('[data-qs-switch-official]').click()
      const official = page.locator('[data-sidebar-right-panel]')
      await official.waitFor()
      expect(await official.locator('[data-dockkit-tab]').evaluateAll(elements => elements.map(element => element.getAttribute('data-dockkit-tab')))).toEqual(ids)
      await page.locator('[data-qs-official-return]').click()
      await panel.waitFor()
      expect(await panel.locator('[data-dockkit-tab]').evaluateAll(elements => elements.map(element => element.getAttribute('data-dockkit-tab')))).toEqual(ids)
      await tree.getByRole('button', { name: 'sample.txt', exact: true }).waitFor()
      expect(await folder.getAttribute('aria-expanded')).toBe('true')
      // 从真实文件树进入 QS 预览，内容必须来自隔离工作区文件读取。
      await tree.getByRole('button', { name: 'sample.txt', exact: true }).click()
      const preview = panel.locator('[data-qs-document]')
      await preview.locator('[data-qs-document-text]').waitFor()
      expect(await preview.innerText()).toContain('QS file tree evidence')
      expect(await preview.locator('[data-qs-document-text]').innerText()).toMatchSnapshot('plain file preview')
      await preview.getByRole('button', { name: 'Wrap lines', exact: true }).click()
      expect(await preview.getByRole('button', { name: 'Wrap lines', exact: true }).getAttribute('aria-pressed')).toBe('false')
      await page.locator('[data-qs-switch-official]').click()
      await page.locator('[data-textpreview-plain]').waitFor()
      await page.locator('[data-qs-official-return]').click()
      await preview.locator('[data-qs-document-text]').waitFor()
      expect(await preview.getByRole('button', { name: 'Wrap lines', exact: true }).getAttribute('aria-pressed')).toBe('false')
      await panel.getByRole('tab', { name: /Workspace files/ }).click()
      await tree.getByRole('button', { name: 'guide.md', exact: true }).click()
      await preview.getByRole('heading', { name: 'QS guide', exact: true }).waitFor()
      expect(await page.evaluate((): unknown => Reflect.get(window, 'qsPreviewUnsafe'))).toBeUndefined()
      expect(await preview.locator('[data-qs-document-markdown] script').count()).toBe(0)
      await preview.getByRole('combobox', { name: 'Open with', exact: true }).selectOption('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code')
      await preview.locator('[data-qs-document-code]').waitFor()
      expect(await preview.locator('pre').innerText()).toContain('# QS guide')
      expect(await preview.getByRole('heading', { name: 'QS guide', exact: true }).count()).toBe(0)
      await panel.getByRole('tab', { name: /Workspace files/ }).click()
      await tree.getByRole('button', { name: 'image.svg', exact: true }).click()
      const image = preview.locator('[data-qs-document-image] img')
      await image.waitFor({ state: 'visible' })
      expect(await image.evaluate((element) => {
        const img = element as HTMLImageElement
        return { width: img.naturalWidth, height: img.naturalHeight }
      })).toEqual({ width: 120, height: 80 })
      expect(await image.getAttribute('src')).toMatch(/^blob:/)
      expect(await preview.locator('svg,script,iframe,object').count()).toBe(0)
      expect(await page.evaluate((): unknown => Reflect.get(window, 'qsSvgUnsafe'))).toBeUndefined()
      await panel.getByRole('tab', { name: /Workspace files/ }).click()
      await tree.getByRole('button', { name: 'preview.html', exact: true }).click()
      const htmlFrame = preview.locator('[data-qs-document-html]')
      await htmlFrame.waitFor()
      expect(await htmlFrame.getAttribute('sandbox')).toBe('allow-scripts')
      const frameDocument = htmlFrame.contentFrame()
      await frameDocument.getByRole('heading', { name: 'QS relative script' }).waitFor()
      expect(await frameDocument.locator('#isolation').innerText()).toBe('parent blocked')
      expect(await frameDocument.locator('#result').evaluate(element => getComputedStyle(element).color)).toBe('rgb(12, 34, 56)')
      await panel.getByRole('tab', { name: /Workspace files/ }).click()
      await tree.getByRole('button', { name: 'sample.pdf', exact: true }).click()
      for (const [pageNumber, dominant] of [[1, 0], [2, 2]] as const) {
        const canvas = preview.locator(`[data-qs-pdf-page="${pageNumber}"] canvas`)
        await preview.locator(`[data-qs-pdf-page="${pageNumber}"]`).scrollIntoViewIfNeeded()
        await canvas.waitFor({ state: 'visible' })
        const pixel = await canvas.evaluate((element) => {
          const surface = element as HTMLCanvasElement
          return [...surface.getContext('2d')!.getImageData(Math.floor(surface.width / 2), Math.floor(surface.height / 2), 1, 1).data]
        })
        expect(pixel[dominant]).toBeGreaterThan(200)
        expect(pixel[1]).toBeLessThan(50)
        expect(pixel[3]).toBe(255)
      }
      await panel.getByRole('button', { name: 'Collapse the right panel' }).click()
      await expect.poll(() => panel.getAttribute('inert')).not.toBeNull()
      await page.getByRole('button', { name: 'Expand the right panel', exact: true }).click()
      await expect.poll(() => panel.getAttribute('inert')).toBeNull()
      await page.setViewportSize({ width: 390, height: 750 })
      await page.getByRole('button', { name: 'Expand the right panel', exact: true }).click()
      await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 奇术日程通过实际补丁装配，使用官方持久化样本及共享投影流。
it('replays and removes real Schedule records in the Qishu read-only catalog', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/schedule-catalog/session.v3.jsonl', import.meta.url))
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../../../qishu/config/schedule.patch.yml', import.meta.url)) })
  try {
    const sessionId = SessionId('qs-schedule-history')
    await seedSession(scaffold, await readFile(fixture, 'utf8'), sessionId, 'standard')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 980, height: 700 })
      await page.clock.setFixedTime(new Date('2099-08-25T12:00:00.000Z'))
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const trigger = page.getByRole('button', { name: '3 reminders', exact: true })
      await trigger.click()
      const catalog = page.getByRole('list', { name: 'Active reminders', exact: true })
      await expect.poll(() => catalog.getByRole('listitem').count()).toBe(3)
      await page.getByText('Read-only catalog; create or cancel through Schedule tools in the conversation. Times use your local time zone; overdue does not mean execution failed.', { exact: true }).waitFor()
      expect(await catalog.getByRole('button').count()).toBe(0)
      expect(await catalog.locator('li > span:first-child').allTextContents()).toEqual(['Overdue', 'Scheduled', 'Scheduled'])
      const geometry = await catalog.evaluate((element) => {
        const panel = element.parentElement!
        const box = panel.getBoundingClientRect()
        return {
          left: box.left, right: box.right, fits: panel.scrollWidth <= panel.clientWidth,
          background: getComputedStyle(panel).backgroundColor,
        }
      })
      expect(geometry.left).toBeGreaterThanOrEqual(16)
      expect(geometry.right).toBeLessThanOrEqual(964)
      expect(geometry.fits).toBe(true)
      expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)')
      await trigger.press('Escape')
      expect(await catalog.count()).toBe(0)
      expect(await trigger.evaluate(element => element === document.activeElement)).toBe(true)
      await trigger.click()
      const resolved = await scaffold.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw new Error(resolved.error.message)
      // 持久化变更沿官方投影推送；不模拟前端数组，也不发起模型请求。
      for (const [index, id] of ['catalog-after', 'catalog-at', 'catalog-every'].entries()) {
        // 一次性派发后不再有下一次时间；目录依官方投影移除，不伪造空日期行。
        const change = id === 'catalog-every'
          ? { version: 1 as const, operation: 'delete' as const, id: ScheduleId(id) }
          : { version: 1 as const, operation: 'dispatch' as const, id: ScheduleId(id) }
        resolved.agent.session.append('schedule/change', change)
        await expect.poll(() => catalog.getByRole('listitem').count()).toBe(2 - index)
      }
      await scaffold.ctx.sessions.flush(resolved.agent.session)
      await expect.poll(() => trigger.count()).toBe(0)
      expect(await catalog.count()).toBe(0)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})


it('keeps deferred integrations informational and returns focus without external requests', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const apps = page.getByRole('button', { name: 'Apps', exact: true })
      await apps.waitFor()
      const external: string[] = []
      const hostOrigin = new URL(page.url()).origin
      // 观察用户操作后的真实网络，不以请求拦截掩盖意外授权或外部访问。
      page.on('request', (request) => {
        const url = new URL(request.url())
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== hostOrigin) external.push(url.origin)
      })
      for (const width of [1440, 760]) {
        await page.setViewportSize({ width, height: 900 })
        if (!await apps.isVisible()) await page.getByRole('button', { name: 'Expand the left navigation', exact: true }).click()
        await apps.click()
        const dialog = page.getByRole('dialog', { name: 'Apps', exact: true })
        await dialog.waitFor()
        expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true)
        expect(await dialog.innerText()).toMatchSnapshot('QS deferred integration scope')
        expect(await dialog.locator('input, textarea, select, a, iframe').count()).toBe(0)
        expect(await dialog.getByRole('button').allTextContents()).toEqual(['Back to conversation'])
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        expect(await apps.evaluate(element => element === document.activeElement)).toBe(true)
        await apps.click()
        await dialog.getByRole('button', { name: 'Back to conversation', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        expect(await apps.evaluate(element => element === document.activeElement)).toBe(true)
      }
      expect(external).toEqual([])
      expect(errors.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})


it.each(['America/New_York', 'Asia/Shanghai'])('identifies Schedule instants across the DST overlap in %s', async (timezoneId) => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../../../qishu/config/schedule.patch.yml', import.meta.url)) })
  try {
    const sessionId = SessionId('qs-schedule-dst')
    await seedSession(scaffold, await readFile(new URL('../../../../snapshots/web/schedule-catalog/session.v3.jsonl', import.meta.url), 'utf8'), sessionId, 'standard')
    const resolved = await scaffold.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const times = ['2099-11-01T05:30:00.000Z', '2099-11-01T06:30:00.000Z']
    for (const [index, scheduledAt] of times.entries()) resolved.agent.session.append('schedule/change', {
      version: 1, operation: 'create', schedule: { id: ScheduleId(`dst-${index}`), kind: 'at', prompt: `DST ${index}`, scheduledAt },
    })
    await scaffold.ctx.sessions.flush(resolved.agent.session)
    const browser = await chromium.launch()
    try {
      // 浏览器原生时区转换；不 mock Intl，以同时验证 UTC 原值和回拨后的不同偏移。
      const page = await browser.newPage({ viewport: { width: 980, height: 700 }, locale: 'en-US', timezoneId })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      await page.getByRole('button', { name: '5 reminders', exact: true }).click()
      const catalog = page.getByRole('list', { name: 'Active reminders', exact: true })
      for (const [index, scheduledAt] of times.entries()) {
        const row = catalog.getByRole('listitem').filter({ has: page.getByText(`DST ${index}`, { exact: true }) })
        const text = await row.innerText()
        expect(text).toContain(`UTC: ${scheduledAt}`)
        expect(await row.locator('time').getAttribute('datetime')).toBe(scheduledAt)
        expect(text).toContain(timezoneId === 'America/New_York' ? index === 0 ? 'GMT-4' : 'GMT-5' : 'GMT+8')
        expect(text).toContain(timezoneId === 'America/New_York' ? '1:30 AM' : index === 0 ? '1:30 PM' : '2:30 PM')
        expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
