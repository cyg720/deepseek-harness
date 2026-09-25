/** Cold replay through the shipped workbench must keep metadata out of message prose. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-retry'
import { fixtureUserPrompts, watchConsole, launchWebScaffold, seedSession } from '../scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from '../support.ts'

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
      // 过程成员默认折叠；必须证明真实按钮能恢复上下文，不能只删掉原可见性断言。
      const processes = transcript.locator('[data-qs-process] button')
      expect(await processes.count()).toBeGreaterThan(0)
      // 可搜索折叠保留节点；验收真实可见性，避免把 DOM 保留误判为上下文泄出。
      const contextCount = await contexts.count()
      expect(contextCount).toBeGreaterThan(0)
      const visibleContextCount = () => contexts.evaluateAll(elements => elements.filter(element =>
        element.checkVisibility({ checkVisibilityCSS: true }),
      ).length)
      await expect.poll(visibleContextCount).toBe(0)
      for (const button of await processes.all()) {
        if (await button.isEnabled()) {
          await button.focus()
          await button.press('Enter')
        }
      }
      await expect.poll(visibleContextCount).toBe(contextCount)
      expect(await contexts.count()).toBe(contextCount)
      expect(await transcript.locator('[data-qs-process]').count()).toBeGreaterThan(0)
      expect(await prompts.first().getAttribute('open')).toBeNull()
      expect(await contexts.first().getAttribute('open')).toBeNull()
      expect(await transcript.innerText()).not.toContain('controlAnchorSeq')
      expect(await transcript.innerText()).not.toContain('finalNode')
      expect(await transcript.locator('[data-qs-turn-tail]').last().innerText()).toMatchSnapshot('closed turn footer')
      for (const width of [1771, 760]) {
        await page.setViewportSize({ width, height: 1000 })
        // 窄屏导航是覆盖层，先通过真实入口收起再操作正文，不强制穿透点击。
        if (width === 760) await page.getByRole('button', { name: 'Collapse the left navigation', exact: true }).click()
        await prompts.first().locator('summary').click()
        expect(await prompts.first().getAttribute('open')).not.toBeNull()
        const body = prompts.first().locator('div')
        expect(await body.innerText()).not.toBe('')
        expect(await body.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(241)
        expect(await transcript.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await prompts.first().locator('summary').click()
      }
      // 收起/再次展开后上下文仍可恢复，避免过程状态只在首次点击有效。
      for (const button of await processes.all()) {
        if (await button.isEnabled()) await button.click()
      }
      await expect.poll(visibleContextCount).toBe(0)
      expect(await contexts.count()).toBe(contextCount)
      for (const button of await processes.all()) {
        if (await button.isEnabled()) await button.click()
      }
      await expect.poll(visibleContextCount).toBe(contextCount)
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})

it.each(['recovered', 'exhausted', 'cancelled'] as const)('renders real QS retry lifecycle: %s', async (outcome) => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const original = await readFile(fixture, 'utf8')
  const derived = deriveReplayScript(parseSessionLog(original))
  expect(derived).toHaveLength(1)
  const temporary = await mkdtemp(join(tmpdir(), 'qs-retry-lifecycle-'))
  const override = join(temporary, 'replay.override.json')
  const failure: ReplayEntry = { kind: 'throw', chunks: [], message: 'upstream 503', code: 'SERVER' }
  const script = outcome === 'exhausted' ? [failure, failure, failure] : outcome === 'cancelled' ? [failure] : [failure, derived[0]]
  await writeFile(override, JSON.stringify(script))
  // 取消用长服务退避保持可观察等待态；不 sleep，也不修改浏览器时钟或官方重试实现。
  const delay = outcome === 'cancelled' ? 60_000 : 25
  const scaffold = await launchWebScaffold({
    replayFixture: fixture, replayOverride: override, compareReplaySession: false, paceMs: 1,
    replayRetryPolicy: { mode: 'normal', maxRetries: 2, retryableCodes: ['SERVER'],
      backoff: { initialDelayMs: delay, maxDelayMs: delay, jitterRatio: 0 } },
    extraOverlayPath: fileURLToPath(new URL('./interaction-roundtrip.overlay.yml', import.meta.url)),
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  try {
    const events: SessionEvent[] = []
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.locator('[data-qs-official-return]').click()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.getByRole('checkbox', { name: 'Keep me signed in' }).check()
      await page.locator('#qs-login-password').press('Enter')
      await page.locator('#qs-composer-input').fill(fixtureUserPrompts(original)[0]!)
      await page.locator('#qs-composer-input').press('Enter')
      const transcript = page.locator('[data-qs-transcript]')
      const retry = transcript.locator('[data-qs-model-retry]')
      if (outcome === 'cancelled') {
        await retry.locator('p').filter({ hasText: 'scheduled and waiting' }).waitFor()
        expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(1)
        expect(events.filter(event => event.type === 'llm/retry-started')).toHaveLength(0)
        await page.getByRole('button', { name: 'Stop generating', exact: true }).click()
      }
      const reason = outcome === 'recovered' ? 'completed' : outcome === 'exhausted' ? 'error' : 'aborted'
      await expect.poll(() => events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind, { timeout: 30_000 }).toBe(reason)
      const scheduled = events.filter(event => event.type === 'llm/retry')
      const started = events.filter(event => event.type === 'llm/retry-started')
      expect(scheduled).toHaveLength(outcome === 'exhausted' ? 2 : 1)
      expect(started.map(event => event.data.retryId)).toEqual(outcome === 'cancelled' ? [] : scheduled.map(event => event.data.retryId))
      // 结束后展开真实过程，成功后的重试链也必须可读，不因成功正文而被丢弃。
      const expand = transcript.locator('[data-qs-process] button[aria-expanded="false"]')
      for (const button of await expand.all()) if (await button.isEnabled()) await button.click()
      await retry.waitFor()
      await expect.poll(() => retry.getAttribute('data-state')).toBe(outcome === 'cancelled' ? 'cancelled' : 'started')
      if (outcome === 'exhausted') {
        await transcript.locator('[data-qs-turn-error]').waitFor()
        expect(await transcript.locator('[data-qs-turn-error]').innerText()).toContain('upstream 503')
      } else expect(await transcript.locator('[data-qs-turn-error]').count()).toBe(0)
      await retry.locator('summary').click()
      expect(await retry.locator('pre').innerText()).toBe('SERVER: upstream 503')
      expect(await retry.getByRole('button').count()).toBe(0)
      expect(await retry.ariaSnapshot()).toMatchSnapshot(`QS ${outcome} retry details`)
      if (outcome === 'recovered') expect(await transcript.innerText()).toContain('event sourcing')
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      const liveDiagnostic = await retry.ariaSnapshot()
      // 同一 Host 的持久历史重建必须恢复诊断，刷新不能再次请求模型。
      await page.reload()
      await page.locator('[data-qs-official-return]').click()
      await page.locator('[data-qs-session]').first().click()
      await transcript.locator('[data-qs-turn-tail]').waitFor()
      for (const button of await expand.all()) if (await button.isEnabled()) await button.click()
      await retry.waitFor()
      await retry.locator('summary').click()
      expect(await retry.ariaSnapshot()).toBe(liveDiagnostic)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(scheduled.length)
      expect(errors.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
})


it('preserves capped QS output without automatically continuing, including after reload', async () => {
  const fixture = fileURLToPath(new URL('../../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
  const original = await readFile(fixture, 'utf8')
  const temporary = await mkdtemp(join(tmpdir(), 'qs-output-limit-'))
  const override = join(temporary, 'replay.override.json')
  const partial = 'QS retained text before the output limit.'
  // 使用官方 StreamChunk 的截断结束原因；真实 agent-loop 决定轮次终态。
  const entry: ReplayEntry = { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: partial },
    { type: 'block-end', index: 0, block: { type: 'text', text: partial } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 9 } },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ] }
  await writeFile(override, JSON.stringify([entry]))
  const scaffold = await launchWebScaffold({
    replayFixture: fixture, replayOverride: override, compareReplaySession: false,
    extraOverlayPath: fileURLToPath(new URL('./interaction-roundtrip.overlay.yml', import.meta.url)),
  }).catch(async (error: unknown) => { await rm(temporary, { recursive: true, force: true }); throw error })
  try {
    const events: SessionEvent[] = []
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser), errors = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.locator('[data-qs-official-return]').click()
      await page.locator('#qs-login-user').fill('admin')
      await page.locator('#qs-login-password').fill('Demo@2026')
      await page.getByRole('checkbox', { name: 'Keep me signed in' }).check()
      await page.locator('#qs-login-password').press('Enter')
      const input = page.locator('#qs-composer-input')
      await input.fill(fixtureUserPrompts(original)[0]!)
      await input.press('Enter')
      await expect.poll(() => events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('max-tokens')
      const transcript = page.locator('[data-qs-transcript]')
      const limit = transcript.locator('[data-qs-turn-max-tokens]')
      await limit.waitFor()
      expect(await transcript.getByText(partial, { exact: true }).count()).toBe(1)
      expect(await limit.ariaSnapshot()).toMatchSnapshot('QS output limit diagnosis')
      expect(await limit.getByRole('button').count()).toBe(0)
      expect(await transcript.locator('[data-qs-turn-error], [data-qs-model-retry]').count()).toBe(0)
      expect(await input.isEnabled()).toBe(true)
      expect(await page.getByRole('button', { name: 'Stop generating', exact: true }).count()).toBe(0)
      const live = await limit.ariaSnapshot()
      await page.reload()
      await page.locator('[data-qs-official-return]').click()
      await page.locator('[data-qs-session]').first().click()
      await limit.waitFor()
      expect(await limit.ariaSnapshot()).toBe(live)
      expect(await transcript.getByText(partial, { exact: true }).count()).toBe(1)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(1)
      expect(events.filter(event => event.type === 'llm/retry')).toHaveLength(0)
      expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
      expect(errors.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally {
    try { await scaffold.close() } finally { await rm(temporary, { recursive: true, force: true }) }
  }
})
