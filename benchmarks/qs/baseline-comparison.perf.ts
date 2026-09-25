/** 同一归档字节、浏览器和视口对照两代工作台；首轮预热单列，不据小样本宣称 p95。 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Session as InspectorSession } from 'node:inspector/promises'
import { cpus, platform, release } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from '../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../apps/web/tests/support.ts'

for (const turns of [158, 1580, 7900]) {
  it(`compares the shared history workload at ${turns} turns`, async () => {
    const directory = process.env.QS_PERF_FIXTURES
    const executablePath = process.env.QS_PERF_CHROMIUM
    const label = process.env.QS_PERF_LABEL
    const profileDirectory = process.env.QS_PERF_PROFILES
    if (!directory || !executablePath || !label) throw new Error('Set QS_PERF_FIXTURES, QS_PERF_CHROMIUM and QS_PERF_LABEL for the isolated comparison')
    // 两次运行读取同一份文件，不能让旧生成器忽略 turns 后产生不同负载。
    const fixture = await readFile(join(directory, `${turns}.jsonl`), 'utf8')
    const sha256 = createHash('sha256').update(fixture).digest('hex')
    const sessionId = `qs-comparison-${turns}`
    // 采样诊断独立于六次计时；带 profiler 的单次结果不得混入中位数。
    for (let sample = 0; sample < (profileDirectory ? 1 : 6); sample++) {
      const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../apps/web/tests/qs/workbench.overlay.yml', import.meta.url)) })
      try {
        await seedSession(scaffold, fixture, sessionId)
        const browser = await chromium.launch({ executablePath })
        const hostProfiler = profileDirectory ? new InspectorSession() : undefined
        const projectionSpies = profileDirectory ? {
          restore: vi.spyOn(scaffold.ctx.sessionProjections, 'restore'),
          hydrate: vi.spyOn(scaffold.ctx.sessionProjections, 'hydrate'),
          stateOf: vi.spyOn(scaffold.ctx.sessionProjections, 'stateOf'),
        } : undefined
        try {
          const page = await newEnglishPage(browser)
          const requests = new Map<string, number>()
          if (profileDirectory) page.on('request', (request) => {
            const path = new URL(request.url()).pathname
            if (path.startsWith('/api/')) requests.set(path, (requests.get(path) ?? 0) + 1)
          })
          await page.setViewportSize({ width: 1280, height: 900 })
          const errors = watchConsole(page)
          await page.goto(scaffold.authenticatedUrl)
          await page.locator('#qs-login-user').fill('admin')
          await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
          const cdp = profileDirectory ? await page.context().newCDPSession(page) : undefined
          if (cdp) {
            await cdp.send('Profiler.enable')
            await cdp.send('Profiler.start')
          }
          if (hostProfiler) {
            hostProfiler.connect()
            await hostProfiler.post('Profiler.enable')
            await hostProfiler.post('Profiler.start')
          }
          const begin = performance.now()
          await page.locator(`[data-qs-session="${sessionId}"]`).click()
          await page.getByText(`Synthetic answer ${turns}.`, { exact: false }).waitFor()
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          const openMs = performance.now() - begin
          if (cdp && profileDirectory) {
            const { profile } = await cdp.send('Profiler.stop')
            await mkdir(profileDirectory, { recursive: true })
            await writeFile(join(profileDirectory, `${label}-${turns}.cpuprofile`), JSON.stringify(profile))
            await cdp.detach()
          }
          if (hostProfiler && profileDirectory) {
            const { profile } = await hostProfiler.post('Profiler.stop')
            await writeFile(join(profileDirectory, `${label}-host-${turns}.cpuprofile`), JSON.stringify(profile))
          }
          if (projectionSpies && profileDirectory) {
            // 只读计数保留真实执行；以对象身份区分同一 Session ID 的不同准备实例。
            const identities = new Map<object, number>()
            const identity = (session: object): number => {
              const known = identities.get(session)
              if (known !== undefined) return known
              const id = identities.size + 1
              identities.set(session, id)
              return id
            }
            const work = {
              requests: Object.fromEntries(requests),
              restore: projectionSpies.restore.mock.calls.map(([checkpoint, events, baseSeq]) => ({ checkpointKeys: Object.keys(checkpoint), events: events.length, baseSeq })),
              hydrate: projectionSpies.hydrate.mock.calls.map(([session, checkpoint, events]) => ({ identity: identity(session), checkpointKeys: Object.keys(checkpoint), events: events.length })),
              stateOf: projectionSpies.stateOf.mock.calls.map(([session, key]) => ({ identity: identity(session), seq: session.seq, key })),
            }
            await writeFile(join(profileDirectory, `${label}-work-${turns}.json`), JSON.stringify(work))
          }
          const rows = page.locator('[data-qs-node]')
          const initialNodes = await rows.count()
          const paging = performance.now()
          await page.getByRole('button', { name: 'Load earlier records', exact: true }).click()
          await expect.poll(() => rows.count()).toBeGreaterThan(initialNodes)
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          const pageMs = performance.now() - paging
          expect(errors.pageErrors).toEqual([])
          console.log(JSON.stringify({
            benchmark: 'qs-baseline-comparison', label, turns, sample, warmup: sample === 0, profiled: Boolean(profileDirectory),
            sha256, bytes: Buffer.byteLength(fixture), events: fixture.trim().split('\n').length - 1,
            browser: browser.version(), node: process.version, platform: platform(), release: release(),
            cpu: cpus()[0]?.model, viewport: [1280, 900], openMs, pageMs, initialNodes, loadedNodes: await rows.count(),
          }))
        } finally {
          for (const spy of Object.values(projectionSpies ?? {})) spy.mockRestore()
          hostProfiler?.disconnect(); await browser.close()
        }
      } finally { await scaffold.close() }
    }
  })
}
