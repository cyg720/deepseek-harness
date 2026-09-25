/** Real Host interaction continuations driven through the QS cards. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { chromium, type WebSocketRoute } from 'playwright'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, type SessionHeader, type SessionEvent } from '@deepseek-ai/dsh-session'
import { snapshotSubagentDescriptor, type SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-client-modules'
import { fixtureUserPrompts, launchWebScaffold, readPersistedEvents, seedSession } from '../scaffold.ts'
import { createChatScrollFixture } from '../chat-scroll-fixture.ts'
import { connectFreshWorkspace, newEnglishPage } from '../support.ts'

// 本地回答结算与 Host 结果交付分离，重载呈现不能重复提交已结算答案。
it.each([['question', 'delivered'], ['question', 'failed'], ['question', 'ack-lost'],
  ['approval', 'delivered'], ['approval', 'failed'], ['approval', 'ack-lost']] as const)(
  'settles held %s delivery after QS plugin reload: %s', async (kind, delivery) => {
    const fixture = fileURLToPath(new URL(`../../../../snapshots/web/${kind}-composer/session.v3.jsonl`, import.meta.url))
    const temporary = await mkdtemp(join(tmpdir(), 'qs-delivery-'))
    const original = await readFile(fixture, 'utf8')
    const replay = join(temporary, 'session.v3.jsonl')
    // Windows 使用真实 pwsh 工具；只转换录制模型输出中的工具名。
    const recording = original.trim().split('\n').map(line => JSON.parse(line, (key: string, value: unknown) =>
      kind === 'approval' && process.platform === 'win32' && key === 'name' && value === 'bash' ? 'pwsh' : value) as unknown)
    await writeFile(replay, recording.map(event => JSON.stringify(event)).join('\n') + '\n')
    const scaffold = await launchWebScaffold({ replayFixture: kind === 'question' ? fixture : replay, compareReplaySession: kind === 'question', paceMs: 15,
      extraOverlayPath: fileURLToPath(new URL('./interaction-roundtrip.overlay.yml', import.meta.url)) })
      .catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
    const releaseResult = Promise.withResolvers<undefined>(), resultArrived = Promise.withResolvers<undefined>()
    const releaseReload = Promise.withResolvers<undefined>(), reloadArrived = Promise.withResolvers<undefined>()
    try {
      const events: SessionEvent[] = []
      scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
      const browser = await chromium.launch()
      try {
        const page = await newEnglishPage(browser)
        const pluginId = kind === 'question' ? '@deepseek-ai/dsh-qs-questions' : '@deepseek-ai/dsh-qs-approval'
        const entry = scaffold.ctx.clientModules.graph().entries.find(row => row.id === pluginId)
        if (!entry) throw new Error('QS interaction plugin missing')
        let notified = false, answers = 0
        await page.route('**/plugins/events', async (route) => {
          if (notified) { await route.continue(); return }
          notified = true; reloadArrived.resolve(undefined)
          await releaseReload.promise
          await route.fulfill({ contentType: 'text/event-stream',
            body: `data: ${JSON.stringify({ type: 'rebuilt', id: entry.id, rev: entry.rev })}\n\n` })
        })
        // 回答在本地结算后才走此 Gateway 通道；暂缓发往 Host，不伪造成功载荷。
        await page.route('**/api/$events/result', async (route) => {
          answers++; resultArrived.resolve(undefined)
          await releaseResult.promise
          if (delivery === 'failed' && answers === 1) await route.abort('connectionfailed')
          else if (delivery === 'ack-lost' && answers === 1) {
            // Host 已受理而浏览器未收到回执；不能因此恢复可重复回答的卡片。
            await route.fetch()
            await route.abort('connectionfailed')
          }
          else await route.continue()
        })
        await page.goto(scaffold.authenticatedUrl)
        await connectFreshWorkspace(page, scaffold.workspaceCwd)
        if (kind === 'approval') {
          await page.locator('[aria-label^="Access mode"]').click()
          await page.getByRole('menuitem', { name: 'Read Only', exact: true }).click()
          await page.locator('[aria-label="Access mode, current: Read Only"]').waitFor()
        }
        await page.locator('[data-qs-official-return]').click()
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
        const editor = page.locator('#qs-composer-input')
        await editor.fill(fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!)
        await editor.press('Enter')
        const card = page.locator(kind === 'question' ? '[data-qs-question-card]' : '[data-qs-approval-card]')
        const fillAnswer = async (): Promise<void> => {
          await card.waitFor()
          if (kind === 'question') {
            await card.getByRole('checkbox', { name: /^Blue/ }).check()
            await card.getByRole('textbox').fill('Include accessibility notes')
          }
        }
        await fillAnswer()
        await reloadArrived.promise
        await page.evaluate((id) => {
          const style = document.querySelector(`style[data-plugin="${id}"]`)
          if (!style) throw new Error('Interaction style missing')
          style.setAttribute('data-qs-before-reload', 'true')
        }, pluginId)
        await card.getByRole('button', { name: kind === 'question' ? 'Submit answers' : 'Reject', exact: true }).click()
        await resultArrived.promise
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(0)
        await editor.fill('Draft during answer delivery')
        releaseReload.resolve(undefined)
        await page.locator('style[data-qs-before-reload]').waitFor({ state: 'detached' })
        await page.locator(`style[data-plugin="${pluginId}"]`).waitFor({ state: 'attached' })
        expect(await card.count()).toBe(0)
        expect(await editor.inputValue()).toBe('Draft during answer delivery')
        releaseResult.resolve(undefined)
        if (delivery === 'failed') {
          // Host 未收到第一次回答，连接恢复后重新提供权威请求；按同一内容明确重答。
          await card.waitFor()
          expect(events.filter(event => event.type === 'tool/result')).toHaveLength(0)
          await fillAnswer()
          await card.getByRole('button', { name: kind === 'question' ? 'Submit answers' : 'Reject', exact: true }).click()
        }
        await expect.poll(() => events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('completed')
        await expect.poll(() => page.locator('[data-qs-transcript]').innerText()).toContain('DONE')
        expect(answers).toBe(delivery === 'failed' ? 2 : 1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(kind === 'question' ? 1 : 2)
        if (kind === 'approval') {
          const decisions = events.filter(event => event.type === 'approval/decided')
          expect(decisions).toHaveLength(1)
          expect(decisions[0]?.data.outcome).toBe('rejected')
          await expect(readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
        }
        expect(await card.count()).toBe(0)
        expect(await editor.inputValue()).toBe('Draft during answer delivery')
      } finally { releaseResult.resolve(undefined); releaseReload.resolve(undefined); await browser.close() }
    } finally { try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) } }
  })

// 布局存储是浏览器边界；未知版本与拒绝写入都必须有可见恢复路径。
it('recovers versioned QS layout preferences and keeps denied storage usable', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.addInitScript(() => {
        if (sessionStorage.getItem('qs-layout-recovery-fixture') === null) {
          localStorage.setItem('dsh.qs.layout', JSON.stringify({ version: 99, leftWidth: 470, body: 'private-layout-fixture' }))
          sessionStorage.setItem('qs-layout-recovery-fixture', 'seeded')
        }
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const notice = page.locator('[data-qs-layout-notice]')
      await notice.waitFor()
      expect(await notice.innerText()).toMatchSnapshot('QS invalid layout recovery')
      expect(await notice.innerText()).not.toContain('private-layout-fixture')
      await notice.getByRole('button', { name: 'Reset layout', exact: true }).click()
      await notice.waitFor({ state: 'hidden' })
      const resize = page.getByRole('separator', { name: 'Resize left panel' })
      await resize.press('ArrowRight')
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh.qs.layout') ?? '{}') as Record<string, unknown>)
      expect(saved.version).toBe(1)
      expect(typeof saved.leftWidth).toBe('number')
      expect(saved).not.toHaveProperty('body')
      expect(saved).not.toHaveProperty('compact')
      expect(saved).not.toHaveProperty('rightRequestId')
      await page.reload()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await resize.waitFor()
      expect(await notice.count()).toBe(0)
      expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('dsh.qs.layout') ?? '{}') as Record<string, unknown>).leftWidth)).toBe(saved.leftWidth)
      await page.addInitScript(() => {
        // oxlint-disable-next-line typescript/unbound-method -- 原型方法在下面以 call 保留实际 Storage 接收者。
        const original = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          if (key === 'dsh.qs.layout') throw new DOMException('fixture denies layout storage', 'QuotaExceededError')
          original.call(this, key, value)
        }
      })
      await page.reload()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await resize.press('ArrowRight')
      await notice.waitFor()
      expect(await notice.innerText()).toMatchSnapshot('QS unavailable layout storage')
      expect(await page.locator('[data-qs-root]').isVisible()).toBe(true)
      expect(await page.getByRole('button', { name: 'New session', exact: false }).isEnabled()).toBe(true)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
}, 60_000)

// 目标操作走真实 Remote；另一客户端的编辑用于制造可观察的版本冲突。
it('operates the QS goal dock through the real Host and preserves a conflicting draft', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'qs-goal-controls-'))
  const firstReady = join(temporary, 'first-stream')
  const secondReady = join(temporary, 'second-stream')
  const override = join(temporary, 'replay.override.json')
  await writeFile(override, JSON.stringify([{ kind: 'hang', readyFile: firstReady }, { kind: 'hang', readyFile: secondReady }]))
  // 官方回放的可取消流固定两次真实模型调用；就绪文件属于本测试私有目录。
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
    replayFixture: fileURLToPath(new URL('../../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    replayOverride: override, compareReplaySession: false,
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS goal actions', turns: 1 })
    const sessionId = await seedSession(scaffold, history.log, 'qs-goal-actions', 'standard')
    const resolved = await scaffold.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session]').first().click()
      const dock = page.locator('[data-qs-goal]')
      await dock.getByRole('button', { name: 'Create goal', exact: true }).click()
      await dock.getByRole('textbox').fill('clear')
      await dock.getByRole('button', { name: 'Save goal', exact: true }).click()
      await expect.poll(() => scaffold.ctx.goals.get(resolved.agent)?.objective).toBe('clear')
      await expect.poll(() => readFile(firstReady, 'utf8').then(() => true, () => false)).toBe(true)
      // 官方可取消回放先产出 partial；轨迹从同一实时投影读取而非等待最终历史。
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      const live = page.locator('[data-qs-trajectory-live]')
      await expect.poll(() => live.innerText()).toContain('partial')
      expect(await live.innerText()).toMatchSnapshot('QS live assistant before cancellation')

      await dock.getByRole('button', { name: 'Pause automatic continuation', exact: true }).click()
      await expect.poll(() => scaffold.ctx.goals.get(resolved.agent)?.phase).toBe('paused')
      await expect.poll(() => live.count()).toBe(0)
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click()

      await dock.getByRole('button', { name: 'Edit goal', exact: true }).click()
      await dock.getByRole('textbox').fill('My preserved draft')
      const before = scaffold.ctx.goals.get(resolved.agent)
      if (before === undefined) throw new Error('created goal missing')
      scaffold.ctx.goals.edit(resolved.agent, before, { objective: 'Other client objective' })
      await expect.poll(() => dock.innerText()).toContain('Other client objective')
      await dock.getByRole('button', { name: 'Save goal', exact: true }).click()
      await dock.getByRole('button', { name: 'Read latest version', exact: true }).waitFor()
      expect(await dock.getByRole('textbox').inputValue()).toBe('My preserved draft')
      expect(scaffold.ctx.goals.get(resolved.agent)?.objective).toBe('Other client objective')
      await dock.getByRole('button', { name: 'Read latest version', exact: true }).click()
      await expect.poll(() => dock.getByRole('button', { name: 'Save goal', exact: true }).isEnabled()).toBe(true)
      await dock.getByRole('button', { name: 'Save goal', exact: true }).click()
      await expect.poll(() => scaffold.ctx.goals.get(resolved.agent)?.objective).toBe('My preserved draft')
      await dock.getByRole('button', { name: 'Resume automatic continuation', exact: true }).click()
      await expect.poll(() => scaffold.ctx.goals.get(resolved.agent)?.phase).toBe('active')
      await expect.poll(() => readFile(secondReady, 'utf8').then(() => true, () => false)).toBe(true)
      await dock.getByRole('button', { name: 'Pause automatic continuation', exact: true }).click()
      await expect.poll(() => resolved.agent.status).toBe('idle')
      const resumed = scaffold.ctx.goals.get(resolved.agent)
      if (resumed === undefined) throw new Error('resumed goal missing')
      scaffold.ctx.goals.complete(resolved.agent, resumed)
      await expect.poll(() => dock.innerText()).toContain('Goal complete')
      expect(await dock.innerText()).toContain('My preserved draft')
      expect(scaffold.ctx.goals.get(resolved.agent)?.roundsStarted).toBe(2)
      expect(await dock.innerText()).toMatchSnapshot('completed QS goal after two cancelled rounds')
      for (const width of [1440, 760]) {
        await page.setViewportSize({ width, height: 900 })
        if (width === 760) await page.getByRole('button', { name: 'Collapse the left navigation', exact: true }).click()
        expect(await dock.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
        const clear = dock.getByRole('button', { name: 'Clear goal', exact: true })
        await clear.click()
        const confirmation = page.getByRole('dialog', { name: 'Clear goal', exact: true })
        await confirmation.waitFor()
        expect(await confirmation.innerText()).toMatchSnapshot('QS clear goal confirmation')
        expect(await confirmation.evaluate(element =>
          element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= innerWidth)).toBe(true)
        expect(await confirmation.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
        // 原生 Escape 与取消均只关闭确认，Host 目标和版本保持不变。
        const unchanged = scaffold.ctx.goals.get(resolved.agent)
        await page.keyboard.press('Escape')
        await confirmation.waitFor({ state: 'hidden' })
        expect(scaffold.ctx.goals.get(resolved.agent)).toEqual(unchanged)
        expect(await clear.evaluate(element => element === document.activeElement)).toBe(true)
        await clear.click()
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
        expect(scaffold.ctx.goals.get(resolved.agent)).toEqual(unchanged)
      }
      await dock.getByRole('button', { name: 'Clear goal', exact: true }).click()
      await page.getByRole('dialog', { name: 'Clear goal', exact: true }).getByRole('button', { name: 'Confirm clear', exact: true }).click()
      await dock.getByRole('button', { name: 'Create goal', exact: true }).waitFor()
      expect(scaffold.ctx.goals.get(resolved.agent)).toBeUndefined()
      const input = page.locator('#qs-composer-input')
      await input.fill('/go')
      await page.getByRole('listbox', { name: 'Command suggestions' }).waitFor()
      await input.press('Tab')
      await expect.poll(() => input.inputValue()).toBe('/goal ')
      await input.press('Enter')
      const command = page.locator('[data-qs-goal-command]').last()
      await expect.poll(() => command.innerText()).toBe('/goal')
      expect(await command.innerText()).toMatchSnapshot('QS goal command input')
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.reload()
      // 演示登录未选记住状态，刷新后从公开登录入口重新进入。
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-goal]').getByRole('button', { name: 'Create goal', exact: true }).waitFor()
      await expect.poll(() => page.locator('[data-qs-goal-command]').last().innerText()).toBe('/goal')
    } finally { await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
})

// 真实 Host 的旧版本写入必须传回稳定错误码，且不得覆盖目标或追加目标变更事件。
it('preserves Goal CAS failure codes through the shipped Gateway without overwriting newer state', async () => {
  const scaffold = await launchWebScaffold()
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS goal conflict', turns: 1 })
    const sessionId = await seedSession(scaffold, history.log, 'qs-goal-conflict', 'standard')
    const resolved = await scaffold.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const first = scaffold.ctx.goals.create(resolved.agent, { objective: 'original objective' })
    const newer = scaffold.ctx.goals.edit(resolved.agent, first, { objective: 'newer objective' })
    const eventsBefore = resolved.agent.session.snapshotEvents().filter(event => event.type === 'goal/change')
    const staleRef = { id: first.id, revision: first.revision }
    for (const [method, extra] of [
      ['edit', { request: { objective: 'stale draft' } }],
      ['pause', {}], ['resume', {}], ['complete', {}], ['clear', {}],
    ] as const) {
      const endpoint = `goals/${method}`
      const response = await scaffold.hostFetch(`/api/${endpoint}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request', rpcId: `qs-stale-${method}`, method: endpoint,
          payload: { args: { agentId: sessionId, ref: staleRef, ...extra } },
        }),
      })
      expect(response.status, endpoint).toBe(200)
      expect(await response.json()).toEqual({
        type: 'server-response', rpcId: `qs-stale-${method}`,
        result: { ok: false, error: { code: 'GOAL_STALE_REVISION', message: expect.any(String) as string, details: {} } },
      })
      expect(scaffold.ctx.goals.get(resolved.agent)).toEqual(newer)
      expect(resolved.agent.session.snapshotEvents().filter(event => event.type === 'goal/change')).toEqual(eventsBefore)
    }
  } finally { await scaffold.close() }
})

it.each([
  ['approval-composer', 'allow'], ['approval-composer', 'reject'],
  ['question-composer', 'answer'], ['question-composer', 'stop'], ['question-composer', 'other-client'],
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
    const releaseReload = Promise.withResolvers<undefined>()
    const reloadArrived = Promise.withResolvers<undefined>()
    const reloadPending = action === 'answer' || action === 'reject'
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      if (reloadPending) {
        const entries = scaffold.ctx.clientModules.graph().entries.filter(entry => entry.id.startsWith('@deepseek-ai/dsh-qs-'))
        const shell = entries.find(entry => entry.id === '@deepseek-ai/dsh-qs-shell')
        if (!shell) throw new Error('QS shell missing from plugin graph')
        const ordered = [...entries.filter(entry => entry !== shell), shell]
        let sent = false
        // 只控制构建通知到达时机，加载真实插件产物；业务请求继续由 Host 持有。
        await page.route('**/plugins/events', async (route) => {
          if (sent) { await route.continue(); return }
          sent = true
          reloadArrived.resolve(undefined)
          await releaseReload.promise
          await route.fulfill({ contentType: 'text/event-stream', body: [...ordered, ...ordered]
            .map(entry => `data: ${JSON.stringify({ type: 'rebuilt', id: entry.id, rev: entry.rev })}\n\n`).join('') })
        })
      }
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
      // T42：真实请求在轨迹页仍只有一个可回答实例，阅读区卸载不影响待回答座位。
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      await page.locator('[data-qs-trajectory]').waitFor()
      expect(await page.locator('[data-qs-transcript]').count()).toBe(0)
      const liveTools = page.locator('[data-qs-trajectory-live]')
      await expect.poll(() => liveTools.innerText()).toContain('Tool running')
      expect(await card.count()).toBe(1)
      await page.locator('[data-qs-switch-official]').click()
      await page.locator('[data-qs-official-return]').click()
      await page.locator('[data-qs-trajectory]').waitFor()
      await card.waitFor()
      expect(await card.count()).toBe(1)
      if (reloadPending) {
        const sessionId = await page.locator('[data-qs-trajectory]').getAttribute('data-qs-trajectory')
        await page.locator('#qs-composer-input').fill('Unsent draft during pending HMR')
        await reloadArrived.promise
        await page.evaluate(() => {
          const style = document.querySelector('style[data-plugin="@deepseek-ai/dsh-qs-shell"]')
          if (!style) throw new Error('QS shell style missing')
          const cssId = style.getAttribute('data-plugin-css')
          document.documentElement.dataset.qsPendingReloads = '0'
          let count = 0
          const observer = new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) {
              if (node instanceof HTMLStyleElement && node.dataset.plugin === '@deepseek-ai/dsh-qs-shell'
                && node.getAttribute('data-plugin-css') === cssId) count++
            }
            document.documentElement.dataset.qsPendingReloads = String(count)
            if (count >= 2) observer.disconnect()
          })
          observer.observe(document.head, { childList: true })
        })
        releaseReload.resolve(undefined)
        await expect.poll(() => page.evaluate(() => Number(document.documentElement.dataset.qsPendingReloads)), { timeout: 30_000 }).toBe(2)
        // 外壳重装遵循配置回到官方默认界面；同一文档内切回仍读取相同的待答请求。
        await page.locator('[data-qs-official-return]').click()
        await page.locator(`[data-qs-session="${sessionId}"]`).click()
        await card.waitFor()
        expect(await card.count()).toBe(1)
        expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(0)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(0)
        expect(await page.locator('#qs-composer-input').inputValue()).toBe('Unsent draft during pending HMR')
        await page.locator('#qs-composer-input').fill('')
        if (scenario === 'question-composer') {
          // 回答草稿属于被替换的提问插件；清空不等于拒绝，重新填写后校验真实结果载荷。
          expect(await card.getByRole('textbox').inputValue()).toBe('')
          expect(await card.getByRole('checkbox', { name: /^Blue/ }).isChecked()).toBe(false)
          await card.getByRole('checkbox', { name: /^Blue/ }).check()
          await card.getByRole('textbox').fill('Include accessibility notes')
        }
        await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
        await page.locator('[data-qs-trajectory]').waitFor()
      }
      if (action === 'answer') {
        await page.setViewportSize({ width: 760, height: 820 })
        await page.getByRole('button', { name: 'Collapse the left navigation', exact: true }).click()
      }
      // 长待答卡不能占满主区，阅读标签和输入框必须仍有独立可见区域。
      const readingBox = await page.locator('[data-qs-scroll]').boundingBox()
      const inputBox = await page.locator('#qs-composer-input').boundingBox()
      if (readingBox === null || inputBox === null) throw new Error('pending layout lost reading or input region')
      expect(readingBox.height).toBeGreaterThanOrEqual(96)
      expect(inputBox.y).toBeGreaterThanOrEqual(readingBox.y + readingBox.height)
      if (scenario === 'question-composer') expect(await card.getByRole('textbox').inputValue()).toBe('Include accessibility notes')
      // 工具身份单独严格断言；共享快照仅替换已校验的这一行，避免另一平台的快照被误报废弃。
      let cardSnapshot = await card.ariaSnapshot()
      if (scenario === 'approval-composer') {
        const toolName = windowsApproval ? 'pwsh' : 'bash'
        expect(cardSnapshot.split('\n')[3]).toBe(`  - paragraph: ${toolName}`)
        cardSnapshot = cardSnapshot.replace(`  - paragraph: ${toolName}\n`, '  - paragraph: <platform shell>\n')
      }
      expect(cardSnapshot).toMatchSnapshot(`${scenario} pending QS card`)
      // 待答卡检查成功后、回答前才订阅结束事件，避免前置断言失败遗留无人等待的计时器。
      const settled = scaffold.whenTurnSettled(60_000)
      if (action === 'stop') {
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
        await settled
        await expect.poll(() => card.count()).toBe(0)
        expect(events.filter(event => event.type === 'assistant/message').length).toBe(1)
        expect(events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).not.toBe('completed')
        await expect.poll(() => page.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
        return
      }
      if (action === 'other-client') {
        // 第二个独立浏览器上下文经同一 Host 收到真实请求；先回答者撤销其他客户端的旧表单。
        const sessionId = await page.locator('[data-qs-trajectory]').getAttribute('data-qs-trajectory')
        const other = await newEnglishPage(browser)
        await other.goto(scaffold.authenticatedUrl)
        await other.locator('[data-qs-official-return]').click()
        await other.locator('#qs-login-user').fill('admin')
        await other.locator('#qs-login-password').fill('Demo@2026')
        await other.locator('#qs-login-password').press('Enter')
        await other.locator(`[data-qs-session="${sessionId}"]`).click()
        const otherCard = other.locator('[data-qs-question-card]')
        await otherCard.getByRole('checkbox', { name: /^Green/ }).check()
        await otherCard.getByRole('textbox').fill('Answered by second client')
        await otherCard.getByRole('button', { name: 'Submit answers', exact: true }).click()
        await expect.poll(() => card.count()).toBe(0)
        expect(await page.locator('[data-qs-interaction-updated]').innerText()).toMatchSnapshot('QS remotely settled question status')
        expect(await otherCard.count()).toBe(0)
        await other.close()
      } else {
        await card.getByRole('button', { name: scenario === 'approval-composer'
          ? action === 'reject' ? 'Reject' : 'Allow once' : 'Submit answers', exact: true }).click()
      }
      await settled
      // 提交按钮随权威请求消失后，焦点回当前输入，不留在不可见的旧表单。
      if (action !== 'other-client') await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('qs-composer-input')
      // 回答在轨迹页提交并完成，再切回对话检查助手结果。
      expect(await page.locator('[data-qs-trajectory]').count()).toBe(1)
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
      await expect.poll(() => page.locator('[data-qs-transcript]').innerText()).toContain('DONE')
      expect(await card.count()).toBe(0)
      if (scenario === 'approval-composer') {
        expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(1)
        expect(JSON.stringify(events.filter(event => event.type === 'approval/decided'))).toContain(action === 'reject' ? 'rejected' : 'allowed-once')
        if (action === 'reject') {
          await expect(readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
          return
        }
        // 审批同意不等于工具执行成功；先检查真实结果，防止录制的 DONE 掩盖宿主执行错误。
        const toolResults = events.filter(event => event.type === 'tool/result')
        expect(toolResults.map(event => event.data.message.content[0].toolCallId)).toEqual(['approval-write', 'approval-read'])
        for (const result of toolResults) {
          expect(result.data.error, JSON.stringify(result.data)).toBeUndefined()
          expect(result.data.message.content[0].isError, JSON.stringify(result.data)).not.toBe(true)
        }
        const expected = await readFile(fileURLToPath(new URL('../../../../snapshots/web/approval-composer/workspace.expected/notes.txt', import.meta.url)), 'utf8')
        const written = await readFile(join(scaffold.workspaceCwd, 'workspace', 'notes.txt'), 'utf8')
        expect(written.replaceAll('\r\n', '\n')).toBe(expected.replaceAll('\r\n', '\n'))
      } else {
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        const text = results.flatMap(event => event.data.message.content.flatMap(block => block.type === 'tool-result'
          ? block.content.filter(item => item.type === 'text').map(item => item.text) : [])).at(-1)
        expect(JSON.parse(text ?? '')).toEqual({ answers: [{ id: 'color',
          selected: [action === 'other-client' ? 'Green' : 'Blue'],
          custom: action === 'other-client' ? 'Answered by second client' : 'Include accessibility notes',
        }] })
        if (action === 'other-client') return
        await page.setViewportSize({ width: 1440, height: 700 })
        // 静态三标签已由会话 docking 标签替代；此处验证外壳几何偏好，标签身份往返另有专项场景。
        // 回到宽屏会按断点展开右栏，等待该状态再折叠，避免与 resize 的默认开合竞争。
        await page.locator('[data-slot="qs.chrome"]').getByRole('button', { name: 'Collapse the right panel', exact: true }).click()
        const handle = page.locator('[data-qs-resize="left"]')
        // 侧栏宽度有过渡动画，等待拖拽把手稳定后再读取起点，避免采样到中间帧。
        await handle.hover()
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
        await page.getByRole('button', { name: 'Expand the right panel', exact: true }).waitFor()
        await expect.poll(() => page.locator('[data-qs-root] aside').first().evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(width, 0)
      }
    } catch (error) { console.error('QS roundtrip primary failure', error); throw error }
    finally { releaseReload.resolve(undefined); await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
})

it.each(['success', 'failure', 'empty'] as const)('prepends older history and preserves the visible row after first page: %s', async (firstPage) => {
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
      let pageRequests = 0
      if (firstPage !== 'success') await page.route('**/api/session/page', async (route) => {
        pageRequests++
        if (pageRequests !== 1) { await route.continue(); return }
        if (firstPage === 'failure') { await route.abort('connectionfailed'); return }
        // 合法空页作为受控网络输入；后续重试仍返回真实 Host 历史。
        const response = await route.fetch()
        const body = await response.json() as { result: { ok: true; value: { records: unknown[]; hasMore: boolean } } }
        expect(body.result.ok).toBe(true)
        await route.fulfill({ response, json: { ...body, result: { ...body.result,
          value: { ...body.result.value, records: [], hasMore: true } } } })
      })
      // 同一浏览器任务内记录滚动后的锚点，避免自动观察回调先于分散的读取请求完成。
      const { key, top, count } = await page.locator('[data-qs-scroll]').evaluate((element) => {
        element.scrollTop = 0
        element.dispatchEvent(new Event('scroll'))
        const rows = element.querySelectorAll('[data-qs-node]')
        const row = rows[0]
        if (row === undefined) throw new Error('historical row missing')
        return { key: row.getAttribute('data-qs-node'), top: row.getBoundingClientRect().top, count: rows.length }
      })
      let expectedTop = top
      if (firstPage !== 'success') {
        if (firstPage === 'failure') await page.getByRole('alert').filter({ hasText: 'Loading earlier records failed.' }).waitFor()
        else {
          const notice = page.getByRole('status').filter({ hasText: 'No earlier records were loaded this time. Please retry manually.' })
          await notice.waitFor()
          expect(await notice.innerText()).toMatchSnapshot('QS empty history page notice')
          await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
          await page.locator('[data-qs-trajectory]').waitFor()
          await notice.waitFor()
          await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
          await page.locator('[data-qs-transcript]').waitFor()
        }
        expect(await page.locator('[data-qs-node]').count()).toBe(count)
        // 失败停止自动分页；重试前跨渲染帧确认没有请求风暴，已有行继续可读。
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
        expect(pageRequests).toBe(1)
        const retry = page.getByRole('button', { name: firstPage === 'failure' ? 'Reconnect and retry' : 'Load earlier records', exact: true })
        expect(await retry.isEnabled()).toBe(true)
        expectedTop = await retry.evaluate((element, nodeKey) => {
          const row = document.querySelector(`[data-qs-node="${nodeKey}"]`)
          if (row === null) throw new Error('retained row missing after page failure')
          const position = row.getBoundingClientRect().top
          ;(element as HTMLButtonElement).click()
          return position
        }, key)
      }
      await expect.poll(() => page.locator('[data-qs-node]').count()).toBeGreaterThan(count)
      const held = page.locator(`[data-qs-node="${key}"]`)
      await expect.poll(() => held.evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(expectedTop, 0)
      if (firstPage !== 'success') {
        expect(pageRequests).toBe(2)
        expect(await page.getByRole('alert').count()).toBe(0)
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 历史响应属于发起会话；切换呈现不能把旧分页内容或滚动锚点带入新会话。
it('isolates a delayed history page from the newly selected QS session', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const first = createChatScrollFixture({ markerPrefix: 'PAGE-A', title: 'QS delayed history', turns: 40 })
    const second = createChatScrollFixture({ markerPrefix: 'PAGE-B', title: 'QS foreground history', turns: 1 })
    await seedSession(scaffold, first.log, 'qs-page-a')
    await seedSession(scaffold, second.log, 'qs-page-b')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session="qs-page-a"]').click()
      await page.getByRole('button', { name: 'Load earlier records', exact: true }).waitFor()
      const before = await page.locator('[data-qs-node]').count()
      let received = false
      const release = Promise.withResolvers<undefined>()
      await page.route('**/api/session/page', async (route) => {
        const response = await route.fetch()
        received = true
        await release.promise
        await route.fulfill({ response })
      }, { times: 1 })
      try {
        await page.locator('[data-qs-scroll]').evaluate((element) => {
          element.scrollTop = 0
          element.dispatchEvent(new Event('scroll'))
        })
        await expect.poll(() => received).toBe(true)
        await page.locator('[data-qs-session="qs-page-b"]').click()
        const transcript = page.locator('[data-qs-transcript]')
        await expect.poll(() => transcript.innerText()).toContain(second.markers.user(1))
        const editor = page.locator('#qs-composer-input')
        await editor.fill('Keep this draft in B')
        const keys = await page.locator('[data-qs-node]').evaluateAll(rows => rows.map(row => row.getAttribute('data-qs-node')))
        const text = await transcript.innerText()
        const position = await page.locator('[data-qs-scroll]').evaluate(element => element.scrollTop)
        const settled = page.waitForResponse(response => new URL(response.url()).pathname === '/api/session/page')
        release.resolve(undefined)
        await settled
        // 让真实客户端处理响应及下一轮绘制后再核对会话隔离。
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
        expect(await transcript.innerText()).toBe(text)
        expect(await page.locator('[data-qs-node]').evaluateAll(rows => rows.map(row => row.getAttribute('data-qs-node')))).toEqual(keys)
        expect(await page.locator('[data-qs-scroll]').evaluate(element => element.scrollTop)).toBe(position)
        expect(await editor.inputValue()).toBe('Keep this draft in B')
        expect(await page.getByRole('alert').count()).toBe(0)
        await page.locator('[data-qs-session="qs-page-a"]').click()
        await expect.poll(() => page.locator('[data-qs-node]').count()).toBeGreaterThan(before)
        expect(await transcript.innerText()).not.toContain(second.markers.user(1))
        await page.locator('[data-qs-session="qs-page-b"]').click()
        await expect.poll(() => editor.inputValue()).toBe('Keep this draft in B')
      } finally {
        release.resolve(undefined)
        await page.unrouteAll({ behavior: 'wait' })
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 真实连接断开后重建历史窗口，旧分页的 finally 不得释放新分页的等待状态。
it('keeps a new history request busy when an old response settles after reconnect', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'EPOCH', title: 'QS history reconnect', turns: 40 })
    await seedSession(scaffold, fixture.log, 'qs-history-epoch')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const sockets: WebSocketRoute[] = []
      await page.routeWebSocket('**/api/remote.mux', (route) => { sockets.push(route); route.connectToServer() })
      const releases = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const received: number[] = [], finished: number[] = []
      await page.route('**/api/session/page', async (route) => {
        const index = received.length
        const response = await route.fetch()
        received.push(index)
        const release = releases[index]
        if (release !== undefined) await release.promise
        await route.fulfill({ response })
        finished.push(index)
      })
      try {
        await page.goto(scaffold.authenticatedUrl)
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
        await page.locator('[data-qs-session="qs-history-epoch"]').click()
        await page.getByRole('button', { name: 'Load earlier records', exact: true }).waitFor()
        const scroller = page.locator('[data-qs-scroll]')
        await scroller.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
        await expect.poll(() => received.length).toBe(1)
        await page.context().setOffline(true)
        await page.locator('[data-qs-status="disconnected"]').waitFor()
        for (const socket of sockets) await socket.close({ code: 1001, reason: 'history epoch test' })
        await page.context().setOffline(false)
        await page.locator('[data-qs-status="connected"]').waitFor({ timeout: 30_000 })
        const older = page.getByRole('button', { name: 'Load earlier records', exact: true })
        await older.waitFor()
        await older.click()
        await expect.poll(() => received.length).toBe(2)
        const before = await page.locator('[data-qs-node]').count()
        releases[0]!.resolve(undefined)
        await expect.poll(() => finished.includes(0)).toBe(true)
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() }))))
        expect(await page.getByRole('button', { name: 'Loading earlier records…', exact: true }).isDisabled()).toBe(true)
        expect(await page.locator('[data-qs-node]').count()).toBe(before)
        expect(await page.getByRole('alert').count()).toBe(0)
        releases[1]!.resolve(undefined)
        await expect.poll(() => page.locator('[data-qs-node]').count()).toBeGreaterThan(before)
        expect(await page.getByRole('button', { name: 'Loading earlier records…', exact: true }).count()).toBe(0)
      } finally {
        for (const release of releases) release.resolve(undefined)
        await page.context().setOffline(false)
        await page.unrouteAll({ behavior: 'wait' })
      }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 使用真实持久子记录和目录 API 验证地址导航；只读规则不以伪造浏览器快照代替。
it('navigates QS persisted children and renders one-shot and unavailable-parent read-only input', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS subagent parent', turns: 1 })
    const parent = await seedSession(scaffold, history.log, 'qs-subagent-parent', 'standard')
    const resolved = await scaffold.ctx.sessionController.resolveAgent(parent)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const child = SessionId('qs-one-shot-child'), nested = SessionId('qs-continuable-grandchild')
    for (const [id, parentId, mode, label, depth] of [
      [child, parent, 'one-shot', 'QS reviewer', 1],
      [SessionId('qs-sibling-child'), parent, 'one-shot', 'QS sibling reviewer', 1],
      [nested, child, 'continuable', 'QS nested worker', 2],
    ] as const) {
      const time = Date.now()
      const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: time, isSeeded: false,
        cwd: scaffold.workspaceCwd, parentSession: parentId, origin: 'subagent', delegationDepth: depth }
      const events = [
        { type: 'turn/start', seq: 0, time, data: { turn: 1 } },
        { type: 'user/message', seq: 1, time: time + 1, surfaceOp: 'append', data: {
          id: '00000000-0000-4000-9000-000000000111', role: 'user', source: { kind: 'user' },
          content: [{ type: 'text', text: label + ' persisted request' }],
        } },
        { type: 'subagent/descriptor', seq: 2, time: time + 2,
          data: mode === 'one-shot'
            ? snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'spawn', label })
            : snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label }) },
        { type: 'turn/end', seq: 3, time: time + 3, data: { turn: 1, reason: { kind: 'completed' } } },
      ] as SessionEvent[]
      const handle = await scaffold.ctx.sessionPersistence.create(header)
      try { await handle.append(events) } finally { await handle.close() }
      scaffold.ctx.sessionProjectionCache.coldSnapshot(header, SessionLogOffset(0), events)
      await expect.poll(() => scaffold.ctx.sessionProjectionCache.cachedSnapshot(header, SessionLogOffset(0)) !== undefined).toBe(true)
    }
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${parent}"]`).click()
      const catalog = page.locator('[data-qs-subagent]')
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      const reviewer = catalog.getByRole('button', { name: 'QS reviewer', exact: true })
      await reviewer.focus()
      await reviewer.press('ArrowRight')
      // 后代目录为异步读取；等待可导航记录到达后再移动焦点。
      await catalog.getByRole('button', { name: 'QS nested worker', exact: true }).waitFor()
      await reviewer.press('ArrowRight')
      await expect.poll(() => catalog.locator('[data-qs-child]:focus').innerText()).toBe('QS nested worker')
      await catalog.locator('[data-qs-child]:focus').press('ArrowLeft')
      expect(await catalog.locator('[data-qs-child]:focus').innerText()).toBe('QS reviewer')
      await reviewer.press('ArrowLeft')
      await reviewer.press('End')
      await catalog.locator('[data-qs-child]:focus').press('Home')
      await page.setViewportSize({ width: 760, height: 900 })
      const bounds = await catalog.getByRole('region', { name: 'Subagents' }).boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(760)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await reviewer.click()
      await page.locator('[data-qs-transcript]').getByText('QS reviewer persisted request').waitFor()
      await page.locator('[data-qs-subagent-readonly]').waitFor()
      expect(await page.locator('[data-qs-subagent-readonly]').innerText()).toMatchSnapshot('QS one-shot read-only composer')
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('combobox', { name: 'Browse child catalog' }).selectOption(parent)
      // 切换目录所有者不更换当前会话，也不丢失只读状态。
      expect(await page.locator('[data-qs-subagent-readonly]').innerText()).toContain('One-shot child sessions')
      await catalog.getByRole('button', { name: 'QS sibling reviewer', exact: true }).click()
      await page.locator('[data-qs-transcript]').getByText('QS sibling reviewer persisted request').waitFor()
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('combobox', { name: 'Browse child catalog' }).selectOption(parent)
      await catalog.getByRole('button', { name: 'QS reviewer', exact: true }).click()
      await page.locator('[data-qs-transcript]').getByText('QS reviewer persisted request').waitFor()
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('button', { name: 'QS nested worker', exact: true }).click()
      await page.locator('[data-qs-transcript]').getByText('QS nested worker persisted request').waitFor()
      await expect.poll(() => page.locator('[data-qs-subagent-readonly]').innerText()).toContain('The parent session is unavailable')
      expect(await page.locator('#qs-composer-input').count()).toBe(0)
      expect(await page.locator('[data-qs-subagent-readonly]').innerText()).toMatchSnapshot('QS unavailable-parent composer')
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('navigation', { name: 'Session lineage' }).getByRole('button', { name: 'QS subagent parent' }).click()
      await page.locator('#qs-composer-input').waitFor()
      expect(await page.locator('[data-qs-subagent-readonly]').count()).toBe(0)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
}, 90_000)

// 沿用官方的离线目录故障注入，只替换 parentAvailable；取消及续聊仍走真实 Host。
it('keeps QS stop available for an offline-parent child and resumes queued work through real child input', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'qs-subagent-controls-'))
  const readyFile = join(temporary, 'running')
  const override = join(temporary, 'replay.override.json')
  const completion = (text: string) => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] })
  await writeFile(override, JSON.stringify([{ kind: 'hang', readyFile }, completion('QS queued answer'), completion('QS waking answer')]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
    replayFixture: fileURLToPath(new URL('../../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    replayOverride: override, compareReplaySession: false,
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  const failures: unknown[] = []
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS live parent', turns: 1 })
    const parentId = await seedSession(scaffold, history.log, 'qs-live-parent', 'standard')
    const resolved = await scaffold.ctx.sessionController.resolveAgent(parentId)
    if ('error' in resolved) throw new Error(resolved.error.message)
    const started = await scaffold.ctx.subagents.startContinuable({ provider: 'spawn', label: 'QS live child',
      signal: new AbortController().signal,
      request: { prompt: [{ type: 'text', text: 'Work until interrupted.' }], parent: resolved.agent },
    })
    const childId = started.childId
    await expect.poll(() => readFile(readyFile, 'utf8').then(() => true, () => false)).toBe(true)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), calls: string[] = []
      page.on('request', request => calls.push(new URL(request.url()).pathname))
      const offline = '**/api/subagents/list'
      await page.route(offline, async (route) => {
        const response = await route.fetch()
        const body = await response.json() as { result: { ok: true; value: { parentAvailable: boolean } } | { ok: false } }
        if (body.result.ok) body.result.value.parentAvailable = false
        await route.fulfill({ response, json: body })
      })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${parentId}"]`).click()
      const catalog = page.locator('[data-qs-subagent]')
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('button', { name: 'QS live child', exact: true }).click()
      const input = page.locator('#qs-composer-input')
      await expect.poll(() => input.isDisabled()).toBe(true)
      expect(await page.locator('[data-qs-subagent-readonly]').count()).toBe(0)
      const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
      expect(await stop.isEnabled()).toBe(true)
      expect(await page.getByText('The parent session is not confirmed available.', { exact: false }).innerText())
        .toMatchSnapshot('QS running child input restriction')
      // 官方队列动作保留待续工作，停止后必须停留在暂停队列而非自动消耗。
      await scaffold.ctx.subagents.prompt({ requestId: 'qs-parked-child' as SubagentPromptRequestId,
        parentSessionId: parentId, childSessionId: childId, mode: 'continuable', delivery: 'queue',
        content: [{ type: 'text', text: 'QS parked request' }],
      }, new AbortController().signal)
      const interrupted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/subagents/interruptByParent')
      await stop.click()
      expect((await (await interrupted).json() as { result: { ok: boolean; value: { accepted: boolean } } }).result)
        .toMatchObject({ ok: true, value: { accepted: true } })
      expect(calls).not.toContain('/api/session/cancel')
      await expect.poll(() => scaffold.ctx.agents.get(childId)?.status).toBe('idle')
      const stoppedEvents = await readPersistedEvents(scaffold, childId)
      expect(stoppedEvents.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toContain('aborted')
      await page.locator('[data-qs-subagent-readonly]').waitFor()
      await page.unroute(offline)
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('navigation', { name: 'Session lineage' }).getByRole('button', { name: 'QS live parent' }).click()
      await catalog.getByRole('button', { name: 'Subagents', exact: true }).click()
      await catalog.getByRole('button', { name: 'Refresh catalog', exact: true }).click()
      await catalog.getByRole('button', { name: 'QS live child', exact: true }).click()
      await expect.poll(() => input.isEnabled()).toBe(true)
      await input.fill('QS waking request')
      await input.press('Enter')
      await page.locator('[data-qs-transcript]').getByText('QS waking answer', { exact: true }).waitFor()
      const transcript = await page.locator('[data-qs-transcript]').innerText()
      expect(transcript).toContain('QS queued answer')
      expect(transcript.indexOf('QS queued answer')).toBeLessThan(transcript.indexOf('QS waking answer'))
      expect(calls).toContain('/api/subagents/prompt')
    } catch (error: unknown) { failures.push(error) } finally {
      await browser.close().catch((error: unknown) => { failures.push(error) })
    }
  } catch (error: unknown) { failures.push(error) } finally {
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
    await rm(temporary, { recursive: true, force: true }).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, 'QS child controls or teardown failed')
}, 90_000)

// 工作区由真实 Host 登记，选择器复用官方空白会话与导航逻辑。
it('switches registered QS workspaces and reuses their blank sessions', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const firstPath = join(scaffold.workspaceCwd, 'first-workspace'), secondPath = join(scaffold.workspaceCwd, 'second-workspace')
    await mkdir(firstPath); await mkdir(secondPath)
    const first = await scaffold.ctx.workspaceRegistry.create(firstPath)
    const second = await scaffold.ctx.workspaceRegistry.create(secondPath)
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const sidebar = page.locator('[data-qs-workspace-entry="sidebar"]')
      const hero = page.locator('[data-qs-workspace-entry="hero"]')
      const selector = sidebar.getByRole('combobox', { name: 'Workspace', exact: true })
      await hero.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(first.id)
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(firstPath)
      await expect.poll(() => hero.locator('[data-qs-workspace-path]').innerText()).toBe(firstPath)
      await selector.selectOption(second.id)
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(secondPath)
      const secondSessions = (await scaffold.ctx.sessionPersistence.list()).filter(value => value.header.cwd === secondPath)
      expect(secondSessions).toHaveLength(1)
      await selector.selectOption(first.id)
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(firstPath)
      await selector.selectOption(second.id)
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(secondPath)
      expect((await scaffold.ctx.sessionPersistence.list()).filter(value => value.header.cwd === secondPath)
        .map(value => value.header.id)).toEqual(secondSessions.map(value => value.header.id))
      expect(await selector.locator('option').allTextContents()).toMatchSnapshot('QS registered workspace choices')
      const firstSession = (await scaffold.ctx.sessionPersistence.list()).find(value => value.header.cwd === firstPath)
      if (firstSession === undefined) throw new Error('first workspace session missing')
      const thirdPath = join(scaffold.workspaceCwd, 'delayed-workspace')
      await mkdir(thirdPath)
      const third = await scaffold.ctx.workspaceRegistry.create(thirdPath)
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      await page.route('**/api/session/create', async (route) => {
        entered.resolve(undefined); await release.promise; await route.continue()
      })
      try {
        await selector.selectOption(third.id)
        await entered.promise
        await page.locator(`[data-qs-session="${firstSession.header.id}"]`).click()
        release.resolve(undefined)
        await page.unrouteAll({ behavior: 'wait' })
        await expect.poll(async () => (await scaffold.ctx.sessionPersistence.list())
          .some(value => value.header.cwd === thirdPath)).toBe(true)
        // 等待旧导航的 finally 解锁，确保此时验证的是请求完成后的选择。
        await expect.poll(() => selector.isEnabled()).toBe(true)
        expect(await selector.inputValue()).toBe(first.id)
        expect(await sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(firstPath)
      } finally { release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
      // 新建必须把当前工作区传入真实 Host，而不是采用启动服务时的默认目录。
      const beforeCreate = new Set((await scaffold.ctx.sessionPersistence.list()).map(value => value.header.id))
      await page.getByRole('button', { name: 'New session', exact: false }).click()
      await expect.poll(async () => (await scaffold.ctx.sessionPersistence.list())
        .filter(value => !beforeCreate.has(value.header.id)).map(value => value.header.cwd)).toEqual([firstPath])
      await expect.poll(() => sidebar.locator('[data-qs-workspace-path]').innerText()).toBe(firstPath)


    } finally { await browser.close() }
  } finally { await scaffold.close() }
}, 60_000)

// 布局从浏览器记录进入真实 Host 文件提供者，禁止通过测试直接修改运行中的 store。
it('restores QS tabs, splits and file resources across refresh and bounds narrow-window floats', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS layout restore', turns: 1 })
    const sessionId = await seedSession(scaffold, history.log, 'qs-layout-restore', 'standard')
    await writeFile(join(scaffold.workspaceCwd, 'layout-proof.txt'), 'QS real Host restored file content', 'utf8')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.addInitScript((id: string) => {
        if (sessionStorage.getItem('qs-panel-layout-seeded') !== null) return
        const guide = { kind: 'guide', address: 'sidebar://guide' }
        localStorage.setItem(`dsh.qs.panel-layout.${encodeURIComponent(id)}`, JSON.stringify({
          version: 1, docked: 2, active: 1, sizes: [0.3, 0.7], expanded: true, mode: 'push', panes: [
            { tabs: [guide], active: 0, rect: null },
            { tabs: [{ kind: 'text', address: `dsh-resource://file/session/${encodeURIComponent(id)}/layout-proof.txt` }, guide], active: 0, rect: null },
            { tabs: [guide], active: 0, rect: { x: 5000, y: 5000, width: 350, height: 300 } },
          ],
        }))
        sessionStorage.setItem('qs-panel-layout-seeded', 'yes')
      }, sessionId)
      const enter = async (): Promise<void> => {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
        await page.locator(`[data-qs-session="${sessionId}"]`).click()
      }
      await page.goto(scaffold.authenticatedUrl)
      await enter()
      // 延期入口只展示说明，不提供模拟授权；关闭后返回原会话。
      await page.getByRole('button', { name: 'Apps', exact: true }).click()
      const deferred = page.locator('[data-qs-integrations-deferred]')
      expect(await deferred.innerText()).toMatchSnapshot('QS deferred integrations explanation')
      expect(await deferred.locator('input, button, a').count()).toBe(0)
      await page.getByRole('dialog', { name: 'Apps', exact: true }).getByRole('button', { name: 'Back to conversation', exact: true }).click()
      const panel = page.locator('[data-qs-panel-session]'), floats = page.locator('[data-dockkit-float]')
      await page.locator('[data-qs-document-text]').getByText('QS real Host restored file content', { exact: false }).waitFor()
      expect(await panel.locator('[data-dockkit-pane]').count()).toBe(2)
      expect(await floats.count()).toBe(1)
      expect(await panel.locator('[data-qs-panel-storage-notice]').innerText()).toMatchSnapshot('QS recovered panel layout notice')
      // 复用官方手动激活语义：方向键只移动焦点，Enter 才切换正文。
      const fileTab = panel.getByRole('tab', { name: /layout-proof/ })
      const filePane = panel.locator('[data-dockkit-pane]').filter({ has: page.getByRole('tab', { name: /layout-proof/ }) })
      const guideTab = filePane.getByRole('tab').nth(1)
      await fileTab.focus()
      await fileTab.press('ArrowRight')
      expect(await guideTab.evaluate(node => node === document.activeElement)).toBe(true)
      expect(await fileTab.getAttribute('aria-selected')).toBe('true')
      await guideTab.press('Enter')
      await expect.poll(() => guideTab.getAttribute('aria-selected')).toBe('true')
      // 原型按钮以原生 Enter 激活；检查实际标签顺序及活动内容，不能只检查回调。
      const moveEarlier = panel.getByRole('button', { name: 'Move earlier', exact: true })
      await moveEarlier.focus()
      await moveEarlier.press('Enter')
      await expect.poll(() => filePane.getByRole('tab').first().getAttribute('aria-selected')).toBe('true')
      expect(await moveEarlier.isDisabled()).toBe(true)
      await filePane.getByRole('tab').first().focus()
      await filePane.getByRole('tab').first().press('End')
      expect(await fileTab.evaluate(node => node === document.activeElement)).toBe(true)
      await fileTab.press('Enter')
      // 移回文件标签，后续刷新继续验证真实文件正文。
      await moveEarlier.press('Enter')
      await fileTab.focus()
      await fileTab.press('Home')
      expect(await fileTab.evaluate(node => node === document.activeElement)).toBe(true)
      await fileTab.press('Enter')
      await expect.poll(() => fileTab.getAttribute('aria-selected')).toBe('true')
      const readSaved = () => page.evaluate((id: string) => localStorage.getItem(`dsh.qs.panel-layout.${encodeURIComponent(id)}`), sessionId)
      const saved = await readSaved()
      expect(saved).not.toBeNull()
      expect(saved).not.toContain('QS real Host restored file content')
      expect(saved).not.toContain('title')
      await page.reload()
      await enter()
      await page.locator('[data-qs-document-text]').getByText('QS real Host restored file content', { exact: false }).waitFor()
      expect(await panel.locator('[data-dockkit-pane]').count()).toBe(2)
      expect(await floats.count()).toBe(1)
      expect(await readSaved()).toBe(saved)
      // QS 座位卸载期间，官方界面的提交仍通过共享所有者保存。
      await page.locator('[data-qs-switch-official]').click()
      await panel.waitFor({ state: 'hidden' })
      await page.locator('[data-sidebar-right-mode="fullscreen"]').click()
      await expect.poll(readSaved).toContain('"mode":"fullscreen"')
      await page.locator('[data-sidebar-right-mode="push"]').click()
      await expect.poll(readSaved).toContain('"mode":"push"')
      await page.locator('[data-qs-official-return]').click()
      await panel.waitFor()
      await page.setViewportSize({ width: 760, height: 820 })
      // 无需刷新，真实 resize 事件也必须把浮窗留在当前视口。
      await expect.poll(async () => {
        const current = await floats.boundingBox()
        return current !== null && current.x >= 0 && current.y >= 0 && current.x + current.width <= 761 && current.y + current.height <= 821
      }).toBe(true)
      await page.reload()
      await enter()
      await floats.waitFor()
      const bounds = await floats.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(761)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(821)
      // 浮窗归位按钮保持原生键盘激活，不依赖鼠标点击或拖拽。
      await floats.locator('[data-dockkit-float-dock]').focus()
      await floats.locator('[data-dockkit-float-dock]').press('Enter')
      await floats.waitFor({ state: 'hidden' })
      await page.setViewportSize({ width: 1440, height: 1000 })
      // 先等待归位提交落盘，再注入损坏记录，避免正常保存覆盖测试输入。
      await expect.poll(async () => {
        const record = await readSaved()
        if (record === null) return false
        const layout = JSON.parse(record) as { panes: unknown[]; docked: number }
        return layout.panes.length === layout.docked
      }).toBe(true)
      // 启动前注入，避免活跃页面的保存 effect 覆盖损坏记录；跨会话地址不能获准打开。
      await page.addInitScript((id: string) => {
        localStorage.setItem(`dsh.qs.panel-layout.${encodeURIComponent(id)}`, JSON.stringify({
          version: 1, docked: 1, active: 0, sizes: [1], expanded: true, mode: 'push', panes: [
            { tabs: [{ kind: 'text', address: 'dsh-resource://file/session/another-session/private.txt' },
              { kind: 'removed-plugin', address: 'sidebar://removed-plugin' }], active: 0, rect: null },
          ],
        }))
      }, sessionId)
      await page.reload()
      await enter()
      await panel.locator('[data-qs-panel-storage-notice="recovered"]').waitFor()
      expect(await page.locator('[data-qs-document]').count()).toBe(0)
      expect(await panel.innerText()).not.toContain('private.txt')
      await panel.getByRole('button', { name: 'Clear saved layout', exact: true }).click()
      expect(await readSaved()).toBeNull()
      // 真实退出清理所有会话的标签布局；卸载后到达的保存 effect 不得重新落盘。
      await page.evaluate(() => {
        localStorage.setItem('dsh.qs.panel-layout.another', 'old layout')
        localStorage.setItem('qs-layout-unrelated-fixture', 'keep')
      })
      await panel.getByRole('button', { name: 'Fullscreen', exact: true }).click()
      await expect.poll(readSaved).not.toBeNull()
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await page.locator('#qs-login-user').waitFor()
      await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('dsh.qs.panel-layout.')))).toEqual([])
      expect(await page.evaluate(() => localStorage.getItem('qs-layout-unrelated-fixture'))).toBe('keep')
    } finally { await browser.close() }
  } finally { await scaffold.close() }
}, 90_000)

// 官方 target 提供真实记录；只替换 QS 呈现，切换不得丢失未发送草稿。
it('opens the independent QS trajectory and preserves the composer draft across reading views', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'TRACE', title: 'QS trajectory', turns: 8 })
    const sessionId = await seedSession(scaffold, fixture.log, 'qs-trajectory', 'standard')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${sessionId}"]`).click()
      const input = page.locator('#qs-composer-input')
      await input.fill('Preserve draft while inspecting requests')
      // 原型标签手动激活：移动焦点不会卸载聊天或改写草稿。
      const chatTab = page.getByRole('tab', { name: 'Conversation', exact: true })
      const trajectoryTab = page.getByRole('tab', { name: 'Request trajectory', exact: true })
      await chatTab.focus()
      await chatTab.press('End')
      expect(await trajectoryTab.evaluate(element => element === document.activeElement)).toBe(true)
      expect(await page.locator('[data-qs-transcript]').count()).toBe(1)
      await trajectoryTab.press('Home')
      await chatTab.press('ArrowRight')
      await trajectoryTab.press('Enter')
      const trace = page.locator('[data-qs-trajectory]')
      await trace.waitFor()
      await expect.poll(() => trace.locator('[data-qs-trajectory-request]').count()).toBeGreaterThan(0)
      expect(await page.locator('[data-qs-transcript]').count()).toBe(0)
      expect(await trace.locator('pre').count()).toBe(0)
      const metrics = await trace.locator('article').first().locator('dl').evaluate(element =>
        Object.fromEntries([...element.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent])))
      expect(metrics['Input tokens']).toBe('2007')
      expect(metrics['Output tokens']).toBe('200')
      expect(metrics['Cache read tokens']).toBe('Not recorded')
      expect({ input: metrics['Input tokens'], output: metrics['Output tokens'], cache: metrics['Cache read tokens'] })
        .toMatchSnapshot('QS recorded request token metrics')
      await trace.locator('summary').first().click()
      await trace.locator('pre').first().waitFor()
      expect(await trace.innerText()).toContain('System instructions')
      expect(await trace.locator('script').count()).toBe(0)
      expect(await trace.locator('p').first().innerText()).toMatchSnapshot('QS initial trajectory support notice')
      const history = page.locator('[data-qs-trajectory-history]')
      expect(await history.innerText()).not.toContain(fixture.markers.user(1))
      const userRecord = history.locator('details').first()
      await userRecord.locator('summary').click()
      await expect.poll(() => userRecord.innerText()).toContain(fixture.markers.user(1))
      const toolRecord = history.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Tool result/ }) }).first()
      await toolRecord.locator('summary').click()
      await expect.poll(() => toolRecord.innerText()).toContain(fixture.markers.tool(8, 1))
      expect(await history.locator('p').first().innerText()).toMatchSnapshot('QS history is not a request input reconstruction')
      // 请求定位使用已记录结果序号，目标展开且焦点进入其摘要。
      await trace.locator('article').first().getByRole('button', { name: 'Locate request result', exact: true }).click()
      const located = history.locator('details').filter({ has: page.locator('summary:focus') })
      await expect.poll(() => located.innerText()).toContain(fixture.markers.assistant(1))
      expect(await located.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true)
      expect(await located.locator('summary').innerText()).toMatchSnapshot('QS request result navigation target')
      const turns = trace.getByRole('combobox', { name: 'Go to turn', exact: true })
      await turns.selectOption({ label: 'Turn 8' })
      const selectedRequest = trace.locator('article:focus')
      expect(await selectedRequest.locator('dt').filter({ hasText: /^Turn$/ }).evaluate(term => term.nextElementSibling?.textContent)).toBe('8')
      expect(await turns.inputValue()).toBe('')
      expect(await turns.locator('option').allTextContents()).toMatchSnapshot('QS loaded turn navigation')
      // 常驻标签不滚走；视图切换保留轨迹展开高度与独立阅读位置。
      const scroll = page.locator('[data-qs-scroll]')
      const readingTop = await scroll.evaluate(element => element.scrollTop)
      expect(readingTop).toBeGreaterThan(100)
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
      await page.locator('[data-qs-transcript]').waitFor()
      await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
      await trace.waitFor()
      await expect.poll(async () => Math.abs(await scroll.evaluate(element => element.scrollTop) - readingTop)).toBeLessThan(2)
      expect(await history.locator('details[open]').count()).toBeGreaterThan(0)



      // 跨断点会恢复对应视口的默认开合，再通过可见开关收起覆盖层。
      await page.setViewportSize({ width: 760, height: 820 })
      await page.getByRole('button', { name: 'Collapse the left navigation', exact: true }).click()
      expect(await trace.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
      await page.locator('[data-qs-transcript]').waitFor()
      expect(await input.inputValue()).toBe('Preserve draft while inspecting requests')
      // 工具入口经共享阅读状态定位真实结果，切回聊天仍保留原草稿。
      const process = page.locator('[data-qs-process][data-turn="8"] > button')
      if (await process.getAttribute('aria-expanded') === 'false') await process.click()
      const tool = page.locator('[data-qs-tool]').first()
      await tool.locator('[data-disclosure-row]').first().click()
      const inspect = tool.getByRole('button', { name: 'Inspect in trajectory', exact: true }).first()
      const callId = await inspect.getAttribute('data-qs-inspect-tool')
      expect(callId).not.toBeNull()
      await inspect.click()
      await trace.waitFor()
      const focused = trace.locator('details').filter({ has: page.locator('summary:focus') })
      await expect.poll(() => focused.getAttribute('data-qs-tool-call')).toBe(callId)
      expect(await focused.evaluate(element => (element as HTMLDetailsElement).open)).toBe(true)
      expect(await focused.innerText()).toContain(fixture.markers.tool(8, 1))
      expect(await focused.locator('summary').innerText()).toMatchSnapshot('QS tool card trajectory target')
      await chatTab.click()
      expect(await input.inputValue()).toBe('Preserve draft while inspecting requests')
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 配置保存必须到达能力 owner；恢复继承只移除用户覆盖，不写入空字符串或零。
it('applies numeric settings to their owners and restores inheritance through unset operations', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const initialShell = scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' })
    const initialParallel = scaffold.ctx.agentLoop.config.maxParallelToolCalls
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      await dialog.getByRole('button', { name: 'Plugin settings', exact: true }).click()
      const shell = dialog.getByRole('region', { name: 'Shell execution settings', exact: true })
      const loop = dialog.getByRole('region', { name: 'AgentLoop settings', exact: true })
      const values = [
        ['shell', shell, [['Command timeout (ms)', 'timeoutMs', 90000], ['Output limit per stream (bytes)', 'maxOutputBytes', 32768]]],
        ['agent-loop', loop, [['Parallel tool call limit', 'maxParallelToolCalls', 3]]],
      ] as const
      for (const [namespace, card, fields] of values) {
        for (const [label, , value] of fields) await card.getByLabel(label, { exact: true }).fill(String(value))
        const revision = scaffold.ctx.settings.describe().find(row => row.ns === namespace)?.revision
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings/mutate')
        await card.getByRole('button', { name: 'Save', exact: true }).click()
        const response = await pending
        expect(response.request().postDataJSON()).toMatchObject({ payload: { args: {
          ns: namespace, expectedRevision: revision, ops: fields.map(([, name, value]) => ({ op: 'set', path: [name], value })),
        } } })
        expect(await response.json()).toMatchObject({ result: { ok: true } })
        await card.getByRole('status').waitFor()
      }
      // resolve 只生成参数，不执行命令；与未来工具组读取同一个官方配置来源。
      expect(scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' })).toMatchObject({ timeoutMs: 90000, stdoutMaxBytes: 32768 })
      expect(scaffold.ctx.agentLoop.config.maxParallelToolCalls).toBe(3)
      // Shell 的运行约束由 Host 校验；拒绝后保留草稿和已提交值。
      await shell.getByLabel('Command timeout (ms)', { exact: true }).fill('0')
      const rejectedWrite = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings/mutate')
      await shell.getByRole('button', { name: 'Save', exact: true }).click()
      expect(await (await rejectedWrite).json()).toMatchObject({ result: { ok: false } })
      await shell.getByRole('alert').waitFor()
      expect(await shell.getByLabel('Command timeout (ms)', { exact: true }).inputValue()).toBe('0')
      expect(scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' }).timeoutMs).toBe(90000)
      await shell.getByRole('button', { name: 'Discard changes', exact: true }).click()
      // 编辑后由另一个写入者更新版本，UI 必须经显式采用版本才能覆盖。
      await shell.getByLabel('Command timeout (ms)', { exact: true }).fill('92000')
      const editRevision = scaffold.ctx.settings.describe().find(row => row.ns === 'shell')?.revision
      await scaffold.ctx.settings.update('shell', { timeoutMs: 91000 })
      const conflictWrite = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings/mutate')
      await shell.getByRole('button', { name: 'Save', exact: true }).click()
      const conflictResponse = await conflictWrite
      expect(conflictResponse.request().postDataJSON()).toMatchObject({ payload: { args: { expectedRevision: editRevision } } })
      expect(await conflictResponse.json()).toMatchObject({ result: { ok: false, error: { code: 'settings/conflict' } } })
      await shell.getByRole('button', { name: 'Keep draft and adopt current revision', exact: true }).waitFor()
      expect(await shell.getByLabel('Command timeout (ms)', { exact: true }).inputValue()).toBe('92000')
      expect(scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' }).timeoutMs).toBe(91000)
      await shell.getByText('Current value: 91000', { exact: false }).waitFor()
      await shell.getByRole('button', { name: 'Keep draft and adopt current revision', exact: true }).click()
      const adoptedWrite = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings/mutate')
      await shell.getByRole('button', { name: 'Save', exact: true }).click()
      expect(await (await adoptedWrite).json()).toMatchObject({ result: { ok: true } })
      await shell.getByRole('status').waitFor()
      expect(scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' }).timeoutMs).toBe(92000)
      for (const [namespace, card, fields] of values) {
        const reset = card.getByRole('button', { name: 'Restore inherited value', exact: true })
        for (let index = 0; index < fields.length; index++) await reset.nth(index).click()
        const revision = scaffold.ctx.settings.describe().find(row => row.ns === namespace)?.revision
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings/mutate')
        await card.getByRole('button', { name: 'Save', exact: true }).click()
        const response = await pending
        expect(response.request().postDataJSON()).toMatchObject({ payload: { args: {
          ns: namespace, expectedRevision: revision, ops: fields.map(([, name]) => ({ op: 'unset', path: [name] })),
        } } })
        expect(await response.json()).toMatchObject({ result: { ok: true } })
        await card.getByRole('status').waitFor()
        const user = scaffold.ctx.settings.describe().find(row => row.ns === namespace)?.user
        for (const [, name] of fields) expect(user).not.toHaveProperty(name)
      }
      expect(scaffold.ctx.shell.resolve({ command: 'QS_SETTINGS_RESOLVE_ONLY' })).toMatchObject({
        timeoutMs: initialShell.timeoutMs, stdoutMaxBytes: initialShell.stdoutMaxBytes,
      })
      expect(scaffold.ctx.agentLoop.config.maxParallelToolCalls).toBe(initialParallel)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

it('opens QS settings from the sidebar and restores focus after Escape without losing the composer draft', async () => {
  const credentialRef = `QS_SEARCH_UI_${randomUUID().replaceAll('-', '_')}`
  const scaffold=await launchWebScaffold({ extraOverlayPath:fileURLToPath(new URL('./workbench.overlay.yml',import.meta.url)),
    deepSeekSearch: { baseURL: 'http://127.0.0.1:1', apiKeyEnv: credentialRef },
  })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'FONT', title: 'QS font settings', turns: 11 })
    const sessionId = await seedSession(scaffold, fixture.log, 'qs-font-settings', 'standard')
    const browser=await chromium.launch()
    try {
      const page=await newEnglishPage(browser)
      await page.setViewportSize({ width:1280,height:900 })
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin');await page.locator('#qs-login-password').fill('Demo@2026');await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${sessionId}"]`).click()
      const composer=page.locator('#qs-composer-input');await composer.fill('settings draft remains')
      // 实际计算样式覆盖桌面与 700px 断点，避免移动端规则泄漏到桌面。
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
      await page.setViewportSize({ width: 700, height: 820 })
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
      await page.setViewportSize({ width: 701, height: 820 })
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('13px')
      await page.setViewportSize({ width: 1280, height: 900 })
      // CSS 回归直接改变官方呈现变量；持久化偏好另由设置操作场景验证。
      const fontBefore = await page.evaluate(() => document.body.style.getPropertyValue('--dsh-content-font-size'))
      await page.evaluate(() => { document.body.style.setProperty('--dsh-content-font-size', '17px') })
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
      await page.evaluate(() => { document.body.style.setProperty('--dsh-content-font-size', '12px') })
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('11px')
      await page.setViewportSize({ width: 700, height: 820 })
      expect(await composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
      await page.evaluate((value) => {
        if (value) document.body.style.setProperty('--dsh-content-font-size', value)
        else document.body.style.removeProperty('--dsh-content-font-size')
      }, fontBefore)
      await page.setViewportSize({ width: 1280, height: 900 })
      // 从实际历史消息取计算字号，代码保持固定字号，不随正文放大。
      const userText = page.getByText(fixture.markers.user(11), { exact: false }).first()
      const assistantText = page.locator('[data-qs-transcript] p').filter({ hasText: fixture.markers.assistant(11) }).first()
      await userText.waitFor(); await assistantText.waitFor()
      const userFontBefore = await userText.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))
      const assistantFontBefore = await assistantText.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))
      const code = page.locator('[data-qs-transcript] pre code').first()
      const codeFontBefore = await code.evaluate(element => getComputedStyle(element).fontSize)
      const trigger=page.getByRole('button',{ name:'Settings',exact:true })
      await trigger.click()
      const dialog=page.getByRole('dialog',{ name:'Settings',exact:true });await dialog.waitFor()
      expect(await dialog.getByRole('button',{ name:'General',exact:true }).getAttribute('aria-current')).toBe('page')
      expect(await dialog.getByRole('heading',{ name:'General',exact:true }).innerText()).toMatchSnapshot('QS settings general section')
      expect(await dialog.locator('script').count()).toBe(0)
      // 主题与字号写入须等待真实 Host 回执，再核对工作台实际呈现。
      const themeChoice = dialog.getByRole('combobox', { name: 'Appearance', exact: true })
      const fontChoice = dialog.getByRole('combobox', { name: 'Content font size (px)', exact: true })
      for (const [field, value] of [['preference', 'light'], ['preference', 'system'], ['preference', 'dark'], ['fontSize', '17']] as const) {
        const [saved] = await Promise.all([
          page.waitForResponse((candidate) => {
            if (candidate.request().method() !== 'POST' || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
            const body = candidate.request().postDataJSON() as { payload: { args: { ns: string } } }
            return body.payload.args.ns === 'ui-theme'
          }),
          (field === 'preference' ? themeChoice : fontChoice).selectOption(value),
        ])
        expect(await saved.json()).toMatchObject({ result: { ok: true, value: { ns: 'ui-theme', value: { [field]: field === 'fontSize' ? Number(value) : value } } } })
      }
      expect(await page.locator('[data-qs-root]').evaluate(element => element.classList.contains('qs-dark'))).toBe(true)
      await expect.poll(() => composer.evaluate(element => getComputedStyle(element).fontSize)).toBe('16px')
      expect(await userText.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(userFontBefore + 3)
      expect(await assistantText.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBe(assistantFontBefore + 3)
      expect(await code.evaluate(element => getComputedStyle(element).fontSize)).toBe(codeFontBefore)

      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Escape');await dialog.waitFor({ state:'hidden' })
      expect(await trigger.evaluate(element=>document.activeElement===element)).toBe(true)
      expect(await composer.inputValue()).toBe('settings draft remains')
      await trigger.click();await page.setViewportSize({ width:760,height:820 })
      expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true)
      await dialog.getByRole('button',{ name:'Close settings',exact:true }).click()
      expect(await composer.inputValue()).toBe('settings draft remains')
      // 显式等待官方写入回执，不能把即时语言切换当作持久化成功。
      await trigger.click()
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => {
          if (candidate.request().method() !== 'POST' || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
          const body = candidate.request().postDataJSON() as { payload: { args: { ns: string } } }
          return body.payload.args.ns === 'locale'
        }),
        dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh'),
      ])
      expect(await response.json()).toMatchObject({ result: { ok: true, value: { ns: 'locale', value: { preference: 'zh' } } } })
      const translated = page.getByRole('dialog', { name: '设置', exact: true })
      expect(await translated.getByRole('combobox', { name: '语言', exact: true }).inputValue()).toBe('zh')
      await translated.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.reload()
      await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
      if (await page.locator('#qs-login-user').isVisible()) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.getByRole('button', { name: '设置', exact: true }).click()
      expect(await translated.getByRole('combobox', { name: '语言', exact: true }).inputValue()).toBe('zh')

      expect(await translated.getByRole('combobox', { name: '外观', exact: true }).inputValue()).toBe('dark')
      expect(await translated.getByRole('combobox', { name: '正文字号（像素）', exact: true }).inputValue()).toBe('17')
      // 独立清单经真实只读 RPC 获取已装配模块，搜索不产生写请求。
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      // 配置卡必须收到真实 Host 回执，刷新后仍保持数值，不能只验证本地草稿。
      const shellCard = translated.getByRole('region', { name: 'Shell 执行配置', exact: true })
      const loopCard = translated.getByRole('region', { name: 'AgentLoop 配置', exact: true })
      await shellCard.getByLabel('命令超时（毫秒）', { exact: true }).fill('120000')
      await shellCard.getByLabel('单流输出上限（字节）', { exact: true }).fill('65536')
      await loopCard.getByLabel('并行工具调用上限', { exact: true }).fill('4')
      for (const [ns, card, value] of [
        ['shell', shellCard, { timeoutMs: 120000, maxOutputBytes: 65536 }],
        ['agent-loop', loopCard, { maxParallelToolCalls: 4 }],
      ] as const) {
        const [saved] = await Promise.all([
          page.waitForResponse((candidate) => {
            if (candidate.request().method() !== 'POST' || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
            const body = candidate.request().postDataJSON() as { payload: { args: { ns: string } } }
            return body.payload.args.ns === ns
          }),
          card.getByRole('button', { name: '保存', exact: true }).click(),
        ])
        expect(await saved.json()).toMatchObject({ result: { ok: true, value: { ns, value } } })
        await card.getByRole('status').waitFor()
      }
      await page.reload()
      await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
      if (await page.locator('#qs-login-user').isVisible()) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      await shellCard.getByLabel('命令超时（毫秒）', { exact: true }).waitFor()
      expect(await shellCard.getByLabel('命令超时（毫秒）', { exact: true }).inputValue()).toBe('120000')
      expect(await shellCard.getByLabel('单流输出上限（字节）', { exact: true }).inputValue()).toBe('65536')
      expect(await loopCard.getByLabel('并行工具调用上限', { exact: true }).inputValue()).toBe('4')
      expect([await shellCard.getByRole('heading').innerText(), await loopCard.getByRole('heading').innerText()]).toMatchSnapshot('QS numeric configuration cards')
      // 子代理卡保持独立授权入口，放弃草稿不改变 Host 配置。
      const subagentCard = translated.getByRole('region', { name: '子代理模型', exact: true })
      const subagentToggle = subagentCard.getByRole('checkbox', { name: '允许子代理选择模型', exact: true })
      const initiallyEnabled = await subagentToggle.isChecked()
      await subagentToggle.click()
      expect(await subagentToggle.isChecked()).toBe(!initiallyEnabled)
      await subagentCard.getByRole('button', { name: '放弃修改', exact: true }).click()
      expect(await subagentToggle.isChecked()).toBe(initiallyEnabled)
      // 使用真实目录候选授权，断言原子载荷与服务端回执后再验证刷新持久化。
      await subagentToggle.check()
      const choices = subagentCard.getByRole('group', { name: '允许的模型路由', exact: true }).getByRole('checkbox')
      await choices.first().waitFor()
      await choices.first().check()
      const selectedRouteLabel = await choices.first().locator('..').innerText()
      const [subagentSaved] = await Promise.all([
        page.waitForResponse((candidate) => {
          if (candidate.request().method() !== 'POST' || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
          const body = candidate.request().postDataJSON() as { payload: { args: { ns: string } } }
          return body.payload.args.ns === 'subagent-model-selection'
        }),
        subagentCard.getByRole('button', { name: '保存', exact: true }).click(),
      ])
      const savedBody = await subagentSaved.json() as {
        result: { ok: boolean; value: { value: { enabled: boolean; allowedModels: { provider: string; model: string }[] } } }
      }
      expect(savedBody.result.ok).toBe(true)
      expect(savedBody.result.value.value.enabled).toBe(true)
      expect(savedBody.result.value.value.allowedModels).toHaveLength(1)
      const route = savedBody.result.value.value.allowedModels[0]!
      expect(selectedRouteLabel).toContain(`${route.provider}/${route.model}`)
      const payload = subagentSaved.request().postDataJSON() as { payload: { args: { ops: unknown; expectedRevision: number } } }
      expect(payload.payload.args.ops).toEqual([
        { op: 'set', path: ['enabled'], value: true },
        { op: 'set', path: ['allowedModels'], value: [{ provider: route.provider, model: route.model }] },
      ])
      expect(payload.payload.args.expectedRevision).toBeTypeOf('number')
      await page.reload()
      await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
      if (await page.locator('#qs-login-user').isVisible()) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      await subagentToggle.waitFor()
      expect(await subagentToggle.isChecked()).toBe(true)
      const persistedRoute = subagentCard.locator('label').filter({
        has: page.getByText(`${route.provider}/${route.model}`, { exact: true }),
      }).getByRole('checkbox')
      await persistedRoute.waitFor(); expect(await persistedRoute.isChecked()).toBe(true)
      // 搜索卡公开字段可暂存并放弃；这里只验证呈现，不写入任何凭据。
      const searchCard = translated.getByRole('region', { name: 'DeepSeek 搜索', exact: true })
      const searchLimit = searchCard.getByLabel('单次请求搜索上限', { exact: true })
      const searchBefore = await searchLimit.inputValue()
      await searchLimit.fill(searchBefore === '7' ? '8' : '7')
      await searchCard.getByRole('button', { name: '放弃修改', exact: true }).click()
      expect(await searchLimit.inputValue()).toBe(searchBefore)
      expect(await searchCard.getByLabel('更新搜索凭据', { exact: true }).getAttribute('type')).toBe('password')
      expect(await searchCard.getByLabel('更新搜索凭据', { exact: true }).inputValue()).toBe('')
      // 搜索 provider 仅指向本机不可用端点，不执行搜索；凭据引用与文件归隔离 scaffold。
      const secretInput = searchCard.getByLabel('更新搜索凭据', { exact: true })
      await expect.poll(() => secretInput.isEnabled()).toBe(true)
      await searchLimit.fill('7')
      await secretInput.fill('qs-fixture-not-a-real-secret')
      let searchMutations = 0
      page.on('request', (request) => {
        if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/settings/mutate') return
        const body = request.postDataJSON() as { payload: { args: { ns: string } } }
        if (body.payload.args.ns === 'web-search-deepseek') searchMutations += 1
      })
      // 只阻断凭据网络请求；配置必须真实写入，UI 必须保留部分成功事实。
      await page.route('**/api/credentials/set', request => request.abort('failed'))
      const [searchSaved] = await Promise.all([
        page.waitForResponse((candidate) => {
          if (candidate.request().method() !== 'POST' || new URL(candidate.url()).pathname !== '/api/settings/mutate') return false
          const body = candidate.request().postDataJSON() as { payload: { args: { ns: string } } }
          return body.payload.args.ns === 'web-search-deepseek'
        }),
        searchCard.getByRole('button', { name: '保存', exact: true }).click(),
      ])
      expect(await searchSaved.json()).toMatchObject({ result: { ok: true, value: { value: { maxUses: 7 } } } })
      await searchCard.getByText('凭据未确认写入，草稿已保留。', { exact: true }).waitFor()
      expect(await searchCard.getByText('搜索配置已保存。', { exact: true }).count()).toBe(1)
      expect(await secretInput.inputValue()).toBe('qs-fixture-not-a-real-secret')
      // 插件仍装配时关闭弹窗也必须清除明文；重新打开需用户再次输入。
      await translated.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      await secretInput.waitFor(); expect(await secretInput.inputValue()).toBe('')
      await secretInput.fill('qs-fixture-not-a-real-secret')
      await page.unroute('**/api/credentials/set')
      const [credentialSaved] = await Promise.all([
        page.waitForResponse(candidate => candidate.request().method() === 'POST' && new URL(candidate.url()).pathname === '/api/credentials/set'),
        searchCard.getByRole('button', { name: '保存', exact: true }).click(),
      ])
      expect(await credentialSaved.json()).toMatchObject({ result: { ok: true } })
      const credentialPayload = credentialSaved.request().postDataJSON() as { payload: { args: { ref: string; value: string } } }
      expect(credentialPayload.payload.args).toEqual({ ref: credentialRef, value: 'qs-fixture-not-a-real-secret' })
      await searchCard.getByText('凭据写入已确认。', { exact: true }).waitFor()
      expect(await secretInput.inputValue()).toBe(''); expect(searchMutations).toBe(1)
      await page.reload()
      await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
      if (await page.locator('#qs-login-user').isVisible()) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      await searchCard.getByText('凭据已配置。', { exact: true }).waitFor()
      expect(await searchLimit.inputValue()).toBe('7'); expect(await secretInput.inputValue()).toBe('')
      await translated.getByRole('tab', { name: '插件列表', exact: true }).click()
      const search = translated.getByRole('searchbox', { name: '搜索插件', exact: true })
      await search.waitFor()
      await search.fill('qs-ui-settings-plugin-inventory')
      const inventoryRows = translated.locator('[data-plugin-entry]')
      await expect.poll(() => inventoryRows.count()).toBeGreaterThan(0)
      expect(await inventoryRows.first().innerText()).toContain('@deepseek-ai/dsh-qs-ui-settings-plugin-inventory')
      expect(await inventoryRows.first().locator('summary').innerText()).toMatchSnapshot('QS read-only inventory plugin card')
      expect(await translated.locator('script').count()).toBe(0)
      await search.fill('definitely-no-plugin-match')
      await translated.getByText('没有匹配的插件。', { exact: true }).waitFor()
      await translated.getByRole('button', { name: '关闭设置', exact: true }).click()
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await translated.getByRole('button', { name: '插件设置', exact: true }).click()
      await translated.getByRole('tab', { name: '插件列表', exact: true }).click()
      await search.waitFor(); expect(await search.inputValue()).toBe('')

    } finally {await browser.close()}
  } finally {await scaffold.close()}
})

// 权限设置使用真实隔离 Host；两套呈现轮流生效，不重复创建命令服务。
it('persists QS default permissions and restores official permission presentation across switches', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'PERMISSION', title: 'QS permission ownership', turns: 2 })
    const sessionId = await seedSession(scaffold, fixture.log, 'qs-permission-settings', 'standard')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const failures: string[] = []
      page.on('pageerror', (error) => { failures.push(error.message) })
      await page.goto(scaffold.authenticatedUrl)
      const enter = async () => {
        await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
        if (await page.locator('#qs-login-user').isVisible()) {
          await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
        }
        await page.locator(`[data-qs-session="${sessionId}"]`).click()
      }
      await enter()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      const choice = dialog.getByRole('combobox', { name: 'Default permission', exact: true })
      await choice.waitFor()
      let writes = 0
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/settings/mutate'
          && (request.postDataJSON() as { payload: { args: { ns: string } } }).payload.args.ns === 'permission') writes++
      })
      await choice.selectOption('danger-full-access')
      const risk = dialog.getByRole('group', { name: 'Enable Full access?' })
      expect(await risk.getByRole('button', { name: 'Enable Full access', exact: true }).isDisabled()).toBe(true)
      await risk.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(writes).toBe(0)
      await choice.selectOption('danger-full-access')
      await risk.getByRole('checkbox').check()
      const saved = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/settings/mutate' && (response.request().postDataJSON() as { payload: { args: { ns: string } } }).payload.args.ns === 'permission')
      await risk.getByRole('button', { name: 'Enable Full access', exact: true }).click()
      const response = await saved
      expect(await response.json()).toMatchObject({ result: { ok: true, value: { ns: 'permission', value: { defaultPreset: 'danger-full-access' } } } })
      const payload = response.request().postDataJSON() as { payload: { args: { ns: string; ops: unknown[]; expectedRevision: number } } }
      expect(payload.payload.args).toMatchObject({ ns: 'permission', ops: [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }] })
      expect(typeof payload.payload.args.expectedRevision).toBe('number')
      await expect.poll(() => choice.inputValue()).toBe('danger-full-access')
      await page.reload(); await enter()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect.poll(() => choice.inputValue()).toBe('danger-full-access')
      // 两套中文标签不同，可证明切换后恢复对应装饰器，而不只是同一个弹层仍可打开。
      await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh')
      await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '关闭设置', exact: true }).click()
      for (let cycle = 0; cycle < 2; cycle++) {
        const input = page.locator('#qs-composer-input')
        await input.fill('/permission'); await input.press('Escape'); await input.press('Enter')
        const popup = page.locator('[data-qs-command-popup]')
        await popup.getByRole('option', { name: /只读/ }).waitFor()
        await popup.getByRole('textbox').press('Escape')
        await popup.waitFor({ state: 'hidden' })
        await page.locator('[data-qs-switch-official]').click()
        const officialInput = page.locator('[data-composer-input][contenteditable="true"]').first()
        await officialInput.fill('/permission'); await officialInput.press('Escape'); await officialInput.press('Enter')
        await page.getByRole('option', { name: /仅可查看/ }).waitFor()
        expect(await page.locator('[data-qs-command-popup]').count()).toBe(0)
        await page.keyboard.press('Escape')
        await page.getByRole('option', { name: /仅可查看/ }).waitFor({ state: 'hidden' })
        await page.locator('[data-qs-official-return]').click()
        await page.locator('#qs-composer-input').waitFor()
      }
      expect(writes).toBe(1)
      expect(failures).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 预设策略经真实 Host 持久化，浏览器刷新和双界面切换后仍可读取。
it('persists QS preset policy through Host and restores it after reload and UI switches', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'PRESET', title: 'QS preset policy', turns: 2 })
    const sessionId = await seedSession(scaffold, fixture.log, 'qs-preset-settings', 'standard')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors: string[] = []
      page.on('pageerror', (error) => { errors.push(error.message) })
      await page.goto(scaffold.authenticatedUrl)
      const enter = async () => {
        await page.locator('[data-qs-official-return]').waitFor({ state: 'hidden' })
        await page.locator('#qs-login-user, #qs-composer-input').first().waitFor()
        if (await page.locator('#qs-login-user').isVisible()) {
          await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
        }
        await page.locator(`[data-qs-session="${sessionId}"]`).click()
      }
      const open = async () => {
        await page.getByRole('button', { name: 'Settings', exact: true }).click()
        await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Agent presets', exact: true }).click()
      }
      await enter(); await page.locator('#qs-composer-input').waitFor(); await open()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      const picker = dialog.getByRole('checkbox', { name: 'Allow preset selection for new sessions', exact: true })
      const choice = dialog.getByRole('combobox', { name: 'Saved default preset', exact: true })
      await picker.waitFor()
      const changePicker = async (enabled: boolean) => {
        const [response] = await Promise.all([
          page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/settings/mutate'),
          picker.click(),
        ])
        expect(await response.json()).toMatchObject({ result: { ok: true, value: { ns: 'agent-presets', value: { modeSelectionEnabled: enabled } } } })
        const payload = response.request().postDataJSON() as { payload: { args: { ns: string; ops: unknown[]; expectedRevision: number } } }
        const args = payload.payload.args
        expect(args).toMatchObject({ ns: 'agent-presets', ops: [{ op: 'set', path: ['modeSelectionEnabled'], value: enabled }] })
        expect(typeof args.expectedRevision).toBe('number')
        await expect.poll(() => picker.isChecked()).toBe(enabled)
      }
      if (!(await picker.isChecked())) await changePicker(true)
      await changePicker(false)
      await expect.poll(() => choice.isDisabled()).toBe(true)
      await page.reload(); await enter(); await page.locator('#qs-composer-input').waitFor(); await open()
      expect(await picker.isChecked()).toBe(false)
      await changePicker(true)
      const current = await choice.inputValue()
      const alternatives = await choice.locator('option:not([disabled])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
      const next = alternatives.find(value => value !== current)
      if (next === undefined) throw new Error('Preset fixture must expose an alternative default')
      const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/settings/mutate')
      await choice.selectOption(next)
      const response = await saved
      expect(await response.json()).toMatchObject({ result: { ok: true, value: { ns: 'agent-presets', value: { default: next } } } })
      expect((response.request().postDataJSON() as { payload: { args: { ops: unknown[] } } }).payload.args.ops).toEqual([{ op: 'set', path: ['default'], value: next }])
      await expect.poll(() => choice.inputValue()).toBe(next)
      await page.reload(); await enter(); await page.locator('#qs-composer-input').waitFor(); await open()
      await expect.poll(() => choice.inputValue()).toBe(next)
      await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
      await page.locator('[data-qs-switch-official]').click()
      await page.locator('[data-qs-official-return]').click()
      await open(); await expect.poll(() => choice.inputValue()).toBe(next)
      await dialog.getByRole('region', { name: 'Agent presets', exact: true }).getByRole('listitem').first().waitFor()
      expect(await dialog.getByRole('region', { name: 'Agent presets', exact: true }).innerText()).toMatchSnapshot('QS persisted preset settings')
      await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
      // 历史会话保留 standard；新默认仅影响之后创建的空白会话。
      await expect.poll(() => page.locator('[data-qs-preset-label]').innerText()).toBe('标准模式')
      await page.getByRole('button', { name: 'New session', exact: false }).click()
      const sessionPreset = page.getByRole('combobox', { name: 'Session preset', exact: true })
      await expect.poll(() => sessionPreset.inputValue()).toBe(next)
      const [selected] = await Promise.all([
        page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/agentPresets/select'),
        sessionPreset.selectOption('standard'),
      ])
      expect(await selected.json()).toMatchObject({ result: { ok: true, value: 'standard' } })
      await expect.poll(() => sessionPreset.inputValue()).toBe('standard')
      expect(await page.locator('[data-qs-preset-seat]').ariaSnapshot()).toMatchSnapshot('QS blank-session preset selector')
      await open()
      const [resetDefault] = await Promise.all([
        page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/settings/mutate'),
        choice.selectOption('standard'),
      ])
      expect(await resetDefault.json()).toMatchObject({ result: { ok: true } })
      await expect.poll(() => choice.isEnabled()).toBe(true)
      // 保存前已打开的同一空白会话须同步生效默认，而不是等下一次新建。
      const [policySaved, blankSynced] = await Promise.all([
        page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/settings/mutate'),
        page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/agentPresets/select'),
        choice.selectOption(next),
      ])
      expect(await policySaved.json()).toMatchObject({ result: { ok: true } })
      expect(await blankSynced.json()).toMatchObject({ result: { ok: true, value: next } })
      await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
      await expect.poll(() => sessionPreset.inputValue()).toBe(next)
      await open()
      await page.route('**/api/agentPresets/select', route => route.abort())
      try {
        const [persisted] = await Promise.all([
          page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/settings/mutate'),
          choice.selectOption('standard'),
        ])
        expect(await persisted.json()).toMatchObject({ result: { ok: true, value: { value: { default: 'standard' } } } })
        await dialog.getByText('Settings were saved, but the blank session preset could not be confirmed. Check it before sending.', { exact: true }).waitFor()
        expect(await choice.inputValue()).toBe('standard')
      } finally { await page.unroute('**/api/agentPresets/select') }
      await dialog.getByRole('button', { name: 'Close settings', exact: true }).click()
      await expect.poll(() => sessionPreset.inputValue()).toBe(next)
      const arrived = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      let prompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/prompt')) prompts++ })
      await page.route('**/api/agentPresets/select', async (route) => {
        arrived.resolve(undefined); await release.promise; await route.continue()
      })
      try {
        await sessionPreset.selectOption('standard'); await arrived.promise
        const input = page.locator('#qs-composer-input')
        await input.fill('preserve while preset is preparing')
        expect(await page.getByRole('button', { name: 'Send the message', exact: true }).isDisabled()).toBe(true)
        await input.press('Enter')
        expect(prompts).toBe(0)
        const selected = page.waitForResponse(reply => reply.request().method() === 'POST' && new URL(reply.url()).pathname === '/api/agentPresets/select')
        release.resolve(undefined); expect(await (await selected).json()).toMatchObject({ result: { ok: true } })
        await expect.poll(() => page.getByRole('button', { name: 'Send the message', exact: true }).isEnabled()).toBe(true)
        expect(await input.inputValue()).toBe('preserve while preset is preparing')
        expect(prompts).toBe(0)
      } finally { release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
      expect(errors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 暂存选择必须先写入真实会话，再允许第一条消息进入 Host；外部模型使用官方录制回放。
it('applies the staged QS preset before the first prompt reaches the real Host', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  const scaffold = await launchWebScaffold({
    replayFixture: fixture, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)),
  })
  try {
    await scaffold.ctx.settings.update('agent-presets', { default: 'ptc', modeSelectionEnabled: true })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      const picker = page.getByRole('combobox', { name: 'Session preset', exact: true })
      await expect.poll(() => picker.inputValue()).toBe('ptc')
      const prompts: string[] = []
      let selections = 0
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path.endsWith('/prompt')) prompts.push(path)
        if (path === '/api/agentPresets/select') selections++
      })
      await picker.selectOption('standard')
      expect(selections).toBe(0)
      const arrived = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
      await page.route('**/api/agentPresets/select', async (route) => {
        arrived.resolve(undefined); await release.promise; await route.continue()
      })
      try {
        await page.locator('#qs-composer-input').fill(prompt)
        await page.locator('#qs-composer-input').press('Enter')
        await arrived.promise
        expect(prompts).toEqual([])
        expect(await page.getByRole('button', { name: 'Cancel this send', exact: true }).isVisible()).toBe(true)
        expect(await page.locator('#qs-composer-input').getAttribute('readonly')).not.toBeNull()
        const settled = scaffold.whenTurnSettled(60_000)
        const selected = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/agentPresets/select')
        release.resolve(undefined)
        expect(await (await selected).json()).toMatchObject({ result: { ok: true, value: 'standard' } })
        await settled
        expect(selections).toBe(1)
        expect(prompts).toHaveLength(1)
        const row = page.locator('[data-qs-session]').first()
        const id = await row.getAttribute('data-qs-session')
        if (id === null) throw new Error('Created session is missing from QS navigation')
        const events = await readPersistedEvents(scaffold, SessionId(id))
        const presetAt = events.findIndex(event => event.type === 'agent-preset/selected' && event.data.agentPreset === 'standard')
        const messageAt = events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'user')
        expect(presetAt).toBeGreaterThanOrEqual(0)
        expect(messageAt).toBeGreaterThan(presetAt)
        const userMessages = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
        expect(userMessages).toHaveLength(1)
        expect(userMessages[0]).toMatchObject({ data: { content: [{ type: 'text', text: prompt }] } })
      } finally { release.resolve(undefined); await page.unrouteAll({ behavior: 'wait' }) }
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 模型入口保持原型下拉布局，实际选择写入官方 Session 事件而非本地假状态。
it('selects a QS model through the shared real Host directory and retains it after reload', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./right-panel.overlay.yml', import.meta.url)) })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const pageErrors: string[] = []
      page.on('pageerror', (error) => { pageErrors.push(error.message) })
      const login = async () => {
        await page.locator('#qs-login-user').fill('admin'); await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
      }
      await page.goto(scaffold.authenticatedUrl); await login()
      // 官方空白输入要求工作区；先通过真实目录入口建立工作区，再验证同一会话的双界面模型选择。
      await page.locator('[data-qs-switch-official]').click()
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.locator('[data-qs-official-return]').click()
      const choice = page.getByRole('combobox', { name: 'Select model', exact: true })
      await expect.poll(() => choice.isEnabled()).toBe(true)
      const before = await choice.inputValue()
      const beforeLabel = await choice.locator('option:checked').innerText()
      const values = await choice.locator('option:not([disabled])').evaluateAll(options => options.map(row => (row as HTMLOptionElement).value))
      const next = values.find(value => value !== before)
      if (next === undefined) throw new Error('Model directory must expose an alternative for this regression')
      const [reply] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/selectModel') && response.request().method() === 'POST'),
        choice.selectOption(next),
      ])
      expect(await reply.json()).toMatchObject({ result: { ok: true } })
      await expect.poll(() => choice.inputValue()).toBe(next)
      expect(await page.locator('[data-qs-model-selection]').ariaSnapshot()).toMatchSnapshot('QS model and effort selectors')
      const id = await page.locator('[data-qs-session][aria-current="true"]').getAttribute('data-qs-session')
      if (id === null) throw new Error('Missing created session')
      const [provider, model] = JSON.parse(next) as [string, string]
      await expect.poll(async () => (await readPersistedEvents(scaffold, SessionId(id)))
        .filter(event => event.type === 'model/selection').at(-1)?.data).toMatchObject({ provider, model })
      await page.reload(); await login(); await page.locator(`[data-qs-session="${id}"]`).click()
      await expect.poll(() => choice.inputValue()).toBe(next)
      // 传输失败不能把选择器永久锁在 selecting，也不能伪造持久选择。
      await page.route('**/selectModel', route => route.abort('connectionfailed'), { times: 1 })
      await choice.selectOption(before)
      const modelSeat = page.locator('[data-qs-model-selection]')
      await modelSeat.getByRole('alert').waitFor()
      expect(await choice.inputValue()).toBe(next)
      expect(await choice.isEnabled()).toBe(true)
      await modelSeat.getByRole('button', { name: 'Reload models', exact: true }).click()
      await modelSeat.getByRole('alert').waitFor({ state: 'hidden' })
      const nextLabel = await choice.locator('option:checked').innerText()
      const [beforeProvider, ...beforeParts] = beforeLabel.split(' · ')
      if (beforeProvider === undefined) throw new Error('Missing model provider label')
      const beforeName = beforeParts.join(' · ')
      const nextName = nextLabel.split(' · ').slice(1).join(' · ')
      let prompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/prompt')) prompts++ })
      // 两轮装卸：同一会话在 QS 和官方命令入口选择，均同步至共享模型下拉框。
      for (let cycle = 0; cycle < 2; cycle++) {
        const input = page.locator('#qs-composer-input')
        await input.fill('/model'); await input.press('Escape'); await input.press('Enter')
        const popup = page.locator('[data-qs-command-popup]')
        const originalOption = popup.getByRole('option', { name: beforeName + ' ' + beforeProvider, exact: true })
        await originalOption.waitFor()
        expect(await originalOption.locator('small').innerText()).toBe(beforeProvider)
        const [selected] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/selectModel') && response.request().method() === 'POST'),
          originalOption.click(),
        ])
        expect(await selected.json()).toMatchObject({ result: { ok: true } })
        await popup.waitFor({ state: 'hidden' })
        await expect.poll(() => choice.inputValue()).toBe(before)
        await page.locator('[data-qs-switch-official]').click()
        const trigger = page.getByRole('button', { name: /^Select model, current/ })
        await expect.poll(() => trigger.getAttribute('aria-label')).toContain(beforeName)
        const officialInput = page.locator('[data-composer-input][contenteditable="true"]').first()
        await officialInput.fill('/model'); await officialInput.press('Escape'); await officialInput.press('Enter')
        const restored = page.getByRole('option').filter({ has: page.getByText(nextName, { exact: true }) })
        await restored.waitFor()
        expect(await page.locator('[data-qs-command-popup]').count()).toBe(0)
        const officialCurrent = page.getByRole('option').filter({ has: page.getByText(beforeName, { exact: true }) })
        expect(await officialCurrent.innerText()).toContain(beforeProvider)
        const [officialSelected] = await Promise.all([
          page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/selectModel') && response.request().method() === 'POST'),
          restored.click(),
        ])
        expect(await officialSelected.json()).toMatchObject({ result: { ok: true } })
        await restored.waitFor({ state: 'hidden' })
        await page.locator('[data-qs-official-return]').click()
        await expect.poll(() => choice.inputValue()).toBe(next)
      }
      expect(prompts).toBe(0)
      expect(pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})

// 可取消回放保持同一轮忙碌，通过真实 RPC 和持久 Inbox 记录验证投递方式。
it('routes QS busy Enter and accelerated sends into the matching durable inbox', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'qs-busy-delivery-'))
  const readyFile = join(temporary, 'stream-ready'), override = join(temporary, 'override.json')
  await writeFile(override, JSON.stringify([{ kind: 'hang', readyFile }]))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)),
    replayFixture: fileURLToPath(new URL('../../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url)),
    replayOverride: override, compareReplaySession: false,
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  try {
    const history = createChatScrollFixture({ markerPrefix: 'QS', title: 'QS busy delivery', turns: 1 })
    const id = await seedSession(scaffold, history.log, 'qs-busy-delivery', 'standard')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator(`[data-qs-session="${id}"]`).click()
      const input = page.locator('#qs-composer-input')
      await input.fill('Keep this turn running')
      await input.press('Enter')
      await expect.poll(() => readFile(readyFile, 'utf8').then(() => true, () => false)).toBe(true)
      await page.getByRole('button', { name: 'Add to queue', exact: true }).waitFor()
      const send = async (text: string, mode: 'queue' | 'steer', key?: string): Promise<void> => {
        await input.fill(text)
        const answer = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/session/prompt')
        if (key === undefined) await page.getByRole('button', { name: mode === 'steer' ? 'Steer current turn' : 'Add to queue', exact: true }).click()
        else await input.press(key)
        const response = await answer
        expect(await response.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
        const body = response.request().postDataJSON() as { payload: { args: { request: { mode: string; content: unknown[] } } } }
        expect(body.payload.args.request).toMatchObject({ mode, content: [{ type: 'text', text }] })
        await expect.poll(async () => (await readPersistedEvents(scaffold, id)).some(event =>
          event.type === 'agent/inbox/spliced' && event.data.target === (mode === 'queue' ? 'next-turn' : 'next-step')
          && event.data.inserted.some(message => message.content.some(part => part.type === 'text' && part.text === text)),
        )).toBe(true)
        await expect.poll(() => input.inputValue()).toBe('')
      }
      // 编辑与移除必须命中同一真实消息身份，不能仅以列表消失判定 Host 成功。
      await send('queue edit original', 'queue', 'Enter')
      const editedRow = page.locator('[data-qs-queue-item]')
      await expect.poll(() => editedRow.count()).toBe(1)
      expect(await editedRow.getByRole('textbox').inputValue()).toBe('queue edit original')
      const editedId = await editedRow.getAttribute('data-qs-queue-item')
      // 首次编辑在到达 Host 前断网，原任务及本地草稿必须保留，不能假报保存。
      await page.route('**/api/session/updateQueue', route => route.abort('connectionfailed'), { times: 1 })
      await editedRow.getByRole('textbox').fill('queue edit changed')
      await input.click()
      await page.getByText('The queue action failed; the item is kept.', { exact: true }).waitFor()
      expect(await editedRow.getAttribute('data-qs-queue-item')).toBe(editedId)
      expect(await editedRow.getByRole('textbox').inputValue()).toBe('queue edit changed')
      expect((await readPersistedEvents(scaffold, id)).some(event =>
        event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
          message.content.some(part => part.type === 'text' && part.text === 'queue edit changed'),
        ),
      )).toBe(false)
      const editResponse = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/session/updateQueue')
      const editArrived = Promise.withResolvers<undefined>(), releaseEdit = Promise.withResolvers<undefined>()
      await page.route('**/api/session/updateQueue', async (route) => {
        editArrived.resolve(undefined)
        await releaseEdit.promise
        await route.continue()
      }, { times: 1 })
      try {
        await editedRow.getByRole('textbox').fill('queue edit changed')
        await input.click()
        await editArrived.promise
        // 真实请求暂缓期间，三个控件均受锁保护；放行后继续校验真实 Host 回执。
        expect(await editedRow.getByRole('textbox').evaluate(element => (element as HTMLInputElement).readOnly)).toBe(true)
        expect(await editedRow.getByRole('button', { name: 'Remove this item', exact: true }).isDisabled()).toBe(true)
        expect(await editedRow.getByRole('button', { name: 'Steer the current turn', exact: true }).isDisabled()).toBe(true)
      } finally { releaseEdit.resolve(undefined) }
      const editReply = await editResponse
      expect(editReply.request().postDataJSON()).toMatchObject({ payload: { args: { request: {
        sessionId: id, itemId: editedId, action: { kind: 'edit', content: [{ type: 'text', text: 'queue edit changed' }] },
      } } } })
      expect(await editReply.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
      const changedRow = page.locator(`[data-qs-queue-item="${editedId}"]`)
      await expect.poll(() => changedRow.getByRole('textbox').inputValue()).toBe('queue edit changed')
      // Host 已提交但回执丢失时，以持久事件证明编辑成功，消息身份仍支持后续移除。
      await page.route('**/api/session/updateQueue', async (route) => {
        await route.fetch()
        await route.abort('connectionfailed')
      }, { times: 1 })
      await changedRow.getByRole('textbox').fill('queue committed without receipt')
      await input.click()
      await page.getByText('The queue action failed; the item is kept.', { exact: true }).waitFor()
      await expect.poll(async () => (await readPersistedEvents(scaffold, id)).some(event =>
        event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
          message.content.some(part => part.type === 'text' && part.text === 'queue committed without receipt'),
        ),
      )).toBe(true)
      expect(await page.locator('[data-qs-queue-item]').count()).toBe(1)
      expect(await changedRow.getByRole('textbox').inputValue()).toBe('queue committed without receipt')
      const removeResponse = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/session/updateQueue')
      await changedRow.getByRole('button', { name: 'Remove this item', exact: true }).click()
      const removeReply = await removeResponse
      expect(removeReply.request().postDataJSON()).toMatchObject({ payload: { args: { request: {
        sessionId: id, itemId: editedId, action: { kind: 'remove' },
      } } } })
      expect(await removeReply.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
      await changedRow.waitFor({ state: 'detached' })
      await send('ordinary queue', 'queue', 'Enter')
      await send('button queue', 'queue')
      await send('accelerated steering', 'steer', 'Control+Enter')
      await send('cmd steering', 'steer', 'Meta+Enter')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.locator('[data-qs-settings]')
      await settings.getByRole('button', { name: 'General', exact: true }).click()
      await settings.getByRole('combobox', { name: 'Enter while busy', exact: true }).selectOption('steer')
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
      await page.getByRole('button', { name: 'Steer current turn', exact: true }).waitFor()
      await send('button steering', 'steer')
      await send('ordinary steering', 'steer', 'Enter')
      await send('ctrl queue', 'queue', 'Control+Enter')
      await send('accelerated queue', 'queue', 'Meta+Enter')
      // 空草稿快捷键移动已有消息，不能创建空 prompt 或复制消息。
      let emptyPrompts = 0
      page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/session/prompt') emptyPrompts++ })
      await input.press('Control+Enter')
      await expect.poll(async () => {
        const events = await readPersistedEvents(scaffold, id)
        return ['ordinary queue', 'button queue', 'ctrl queue', 'accelerated queue'].every(text => events.some(event =>
          event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
          && event.data.inserted.some(message => message.content.some(part => part.type === 'text' && part.text === text)),
        ))
      }).toBe(true)
      expect(emptyPrompts).toBe(0)
      await send('cmd empty queue target', 'queue', 'Meta+Enter')
      emptyPrompts = 0
      await input.press('Meta+Enter')
      await expect.poll(async () => (await readPersistedEvents(scaffold, id)).some(event =>
        event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
        && event.data.inserted.some(message => message.content.some(part => part.type === 'text' && part.text === 'cmd empty queue target')),
      )).toBe(true)
      expect(emptyPrompts).toBe(0)
      // 官方取消保留 Inbox：编辑请求晚于停止到达 Host，仍应修改原消息，不能重新启动轮次。
      await send('queued across stop', 'queue', 'Meta+Enter')
      const stopId = await page.locator('[data-qs-queue-item]').filter({ has: page.locator('input[value="queued across stop"]') }).getAttribute('data-qs-queue-item')
      const stopRow = page.locator(`[data-qs-queue-item="${stopId}"]`)
      const arrivedAfterStop = Promise.withResolvers<undefined>(), releaseAfterStop = Promise.withResolvers<undefined>()
      await page.route('**/api/session/updateQueue', async (route) => {
        arrivedAfterStop.resolve(undefined)
        await releaseAfterStop.promise
        await route.continue()
      }, { times: 1 })
      const afterStopResponse = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/session/updateQueue')
      try {
        await stopRow.getByRole('textbox').fill('edited after stop')
        await input.click()
        await arrivedAfterStop.promise
        const settled = scaffold.whenTurnSettled(60_000)
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
        await settled
        await expect.poll(() => page.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
      } finally { releaseAfterStop.resolve(undefined) }
      expect(await (await afterStopResponse).json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
      await expect.poll(() => stopRow.getByRole('textbox').inputValue()).toBe('edited after stop')
      expect(await stopRow.getByRole('button', { name: 'Steer the current turn', exact: true }).isDisabled()).toBe(true)
      expect(await stopRow.getByRole('button', { name: 'Remove this item', exact: true }).isEnabled()).toBe(true)
      expect(await page.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
      expect(errors).toEqual([])
    } finally { await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
}, 60_000)

// 持久 Session 经过真实投影验证最终答案推理，不以手造浏览器快照代替。
it('coordinates QS final reasoning with the process disclosure and transcript preference', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('./workbench.overlay.yml', import.meta.url)) })
  try {
    const fixture = createChatScrollFixture({ markerPrefix: 'THINK', title: 'QS final reasoning', turns: 1 })
    const reasoning = 'QS persisted final reasoning marker'
    const log = fixture.log.trimEnd().split('\n').map((line, index) => {
      // 首行为物理文件头，不是 SessionHeader 领域对象；原样保留。
      if (index === 0) return line
      // 其余输入来自本测试的 Session 生成器，保留消息身份和全部事件顺序。
      const event = JSON.parse(line) as SessionEvent
      return JSON.stringify(event.type === 'assistant/message'
        ? { ...event, data: { ...event.data, message: { ...event.data.message,
          content: [{ type: 'reasoning', text: reasoning }, ...event.data.message.content],
        } } }
        : event)
    }).join('\n') + '\n'
    await seedSession(scaffold, log, 'qs-final-reasoning')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('[data-qs-session="qs-final-reasoning"]').click()
      const details = page.locator('[data-qs-transcript] details').filter({ hasText: reasoning })
      await details.waitFor({ state: 'attached' })
      await expect.poll(() => details.isVisible()).toBe(false)
      const answer = page.getByText(fixture.markers.assistant(1), { exact: false })
      expect(await answer.count()).toBe(1)
      expect(await answer.isVisible()).toBe(true)
      const controller = page.locator('[data-qs-process] button')
      // 浏览器中验证 beforematch 事件到共享展开状态的闭环，不冒充原生查找栏操作。
      await page.locator('[data-qs-inline-reasoning]').dispatchEvent('beforematch')
      await expect.poll(() => controller.getAttribute('aria-expanded')).toBe('true')
      await expect.poll(() => details.isVisible()).toBe(true)
      await controller.click()
      await expect.poll(() => details.isVisible()).toBe(false)
      await controller.click()
      await expect.poll(() => details.isVisible()).toBe(true)
      if (!await details.evaluate(node => (node as HTMLDetailsElement).open)) await details.locator('summary').click()
      expect(await page.getByText(reasoning, { exact: true }).isVisible()).toBe(true)
      expect(await details.ariaSnapshot()).toMatchSnapshot('QS revealed final reasoning')
      await controller.click()
      await expect.poll(() => details.isVisible()).toBe(false)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.locator('[data-qs-settings]')
      await settings.getByRole('button', { name: 'General', exact: true }).click()
      await settings.getByRole('combobox', { name: 'Transcript view', exact: true }).selectOption('normal')
      await page.keyboard.press('Escape')
      await expect.poll(() => details.isVisible()).toBe(true)
      expect(await controller.count()).toBe(0)
      expect(await answer.count()).toBe(1)
      expect(errors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
