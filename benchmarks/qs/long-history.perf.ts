/** 奇术长历史的真实浏览器测量；输出原始样本，不设未经校准的时间门槛。 */
import { cpus, totalmem, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page, type CDPSession } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from '../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../apps/web/tests/support.ts'
import { syntheticHistory } from '../long-session-browser/synthetic-history.ts'

const SAMPLES = Number(process.env.QS_HISTORY_SAMPLES ?? 30)
const MIN_LOADED_NODES = Number(process.env.QS_HISTORY_LOADED_NODES ?? 0)
const PROFILE_DIRECTORY = process.env.QS_HISTORY_PROFILE_DIRECTORY
if (!Number.isSafeInteger(SAMPLES) || SAMPLES < 6 || !Number.isSafeInteger(MIN_LOADED_NODES) || MIN_LOADED_NODES < 0) {
  throw new Error('History measurements require at least six samples and a nonnegative loaded-node target')
}
const SESSION_ID = 'qs-synthetic-long-history'

async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function measure(page: Page, action: () => Promise<void>): Promise<number> {
  const start = performance.now()
  await action()
  await painted(page)
  return performance.now() - start
}

async function retained(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.filter(metric => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners'].includes(metric.name)).map(metric => [metric.name, metric.value]))
}

for (const targetEvents of [1000, 10000, 50000]) {
  it(`measures Qishu history at ${targetEvents} durable events`, async () => {
    // 每轮六个基本事件，每六轮另有两条工具事件；只在完整轮次结束处取样。
    const turns = Math.ceil((targetEvents - 2) / (6 + 2 / 6))
    const fixture = syntheticHistory(turns)
    const events = fixture.trim().split('\n').length - 1
    expect(events).toBeGreaterThanOrEqual(targetEvents)
    const samples: Record<string, unknown>[] = []
    for (let sample = 0; sample < SAMPLES; sample++) {
      const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../apps/web/tests/qs/workbench.overlay.yml', import.meta.url)) })
      try {
        await seedSession(scaffold, fixture, SESSION_ID)
        const browser = await chromium.launch()
        try {
          const page = await newEnglishPage(browser)
          await page.setViewportSize({ width: 1280, height: 900 })
          const errors = watchConsole(page)
          const cdp = await page.context().newCDPSession(page)
          await cdp.send('Performance.enable')
          await page.goto(scaffold.authenticatedUrl)
          await page.locator('#qs-login-user').waitFor()
          const before = await retained(cdp)
          await page.locator('#qs-login-user').fill('admin')
          await page.locator('#qs-login-password').fill('Demo@2026')
          await page.locator('#qs-login-password').press('Enter')
          const openMs = await measure(page, async () => {
            await page.locator(`[data-qs-session="${SESSION_ID}"]`).click()
            await page.getByText(`Synthetic answer ${turns}.`, { exact: false }).waitFor()
          })
          const rows = page.locator('[data-qs-node]')
          const initialNodes = await rows.count()
          const pageMs = await measure(page, async () => {
            await page.getByRole('button', { name: 'Load earlier records', exact: true }).click()
            await expect.poll(() => rows.count()).toBeGreaterThan(initialNodes)
          })
          // 持久事件数量不等于已加载呈现规模；通过正式分页入口达到目标后才测切换。
          const fillMs = await measure(page, async () => {
            while (await rows.count() < MIN_LOADED_NODES) {
              const previous = await rows.count()
              await page.getByRole('button', { name: 'Load earlier records', exact: true }).click()
              await expect.poll(() => rows.count()).toBeGreaterThan(previous)
            }
          })
          // 按钮会将顶部哨兵带入视口；先离开自动分页触发区，再固定切换测量的已加载集合。
          const scroll = page.locator('[data-qs-scroll]')
          await scroll.hover()
          await page.mouse.wheel(0, 1_000_000)
          await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(4)
          await page.getByText('Loading earlier records…', { exact: true }).waitFor({ state: 'hidden' })
          await painted(page)
          const loadedNodes = await rows.count()
          expect(loadedNodes).toBeGreaterThanOrEqual(MIN_LOADED_NODES)
          const switches: number[] = []
          const switchDetails: Record<string, number>[] = []
          for (let cycle = 0; cycle < 20; cycle++) {
            // CDP 累计时间差区分脚本和布局；两段分别等绘制，因此不与旧的单段墙钟直接比优劣。
            const readMetrics = async (): Promise<Record<string, number>> => Object.fromEntries(
              (await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]),
            )
            const initial = await readMetrics()
            const tabs = page.locator('[role="tablist"]').filter({ has: page.getByRole('tab', { name: 'Request trajectory', exact: true }) })
            const trajectoryMs = await measure(page, async () => {
              await tabs.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
              await page.locator('[data-qs-trajectory-history]').waitFor()
            })
            const middle = await readMetrics()
            const profileChat = PROFILE_DIRECTORY !== undefined && sample === 0 && cycle === 0
            if (profileChat) {
              await cdp.send('Profiler.enable')
              await cdp.send('Profiler.start')
            }
            const chatMs = await measure(page, async () => {
              await tabs.getByRole('tab').first().click()
              await expect.poll(() => rows.count()).toBe(loadedNodes)
            })
            if (profileChat) {
              const { profile } = await cdp.send('Profiler.stop')
              await mkdir(PROFILE_DIRECTORY, { recursive: true })
              await writeFile(join(PROFILE_DIRECTORY, `chat-${targetEvents}-${loadedNodes}.cpuprofile`), JSON.stringify(profile))
              await cdp.send('Profiler.disable')
            }
            const final = await readMetrics()
            switches.push(trajectoryMs + chatMs)
            switchDetails.push({ trajectoryMs, chatMs,
              trajectoryScriptMs: (middle.ScriptDuration! - initial.ScriptDuration!) * 1000,
              trajectoryLayoutMs: (middle.LayoutDuration! - initial.LayoutDuration!) * 1000,
              chatScriptMs: (final.ScriptDuration! - middle.ScriptDuration!) * 1000,
              chatLayoutMs: (final.LayoutDuration! - middle.LayoutDuration!) * 1000,
            })
          }
          const after = await retained(cdp)
          await page.getByRole('button', { name: 'Sign out', exact: true }).click()
          await page.locator('#qs-login-user').waitFor()
          expect(await rows.count()).toBe(0)
          const afterExit = await retained(cdp)
          expect(errors.pageErrors).toEqual([])
          const result = { targetEvents, events, turns, bytes: Buffer.byteLength(fixture), sample, firstSample: sample === 0, profiled: PROFILE_DIRECTORY !== undefined && sample === 0, openMs, pageMs, fillMs, minimumLoadedNodes: MIN_LOADED_NODES, initialNodes, loadedNodes, switches, switchDetails, before, after, afterExit }
          samples.push(result)
          console.log(JSON.stringify({ benchmark: 'qs-long-history/sample', ...result }))
          if (sample === 0) console.log(JSON.stringify({ benchmark: 'qs-long-history/machine', node: process.version, browser: browser.version(), platform: platform(), release: release(), cpu: cpus()[0]?.model, memoryBytes: totalmem() }))
        } finally { await browser.close() }
      } finally { await scaffold.close() }
    }
    expect(samples).toHaveLength(SAMPLES)
  })
}
