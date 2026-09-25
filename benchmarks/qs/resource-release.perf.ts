/** 同一浏览器反复装卸工作台，区分退出即时指标与延迟清理后的保留量。 */
import { fileURLToPath } from 'node:url'
import { chromium, type CDPSession } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole } from '../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../apps/web/tests/support.ts'
import { syntheticHistory } from '../long-session-browser/synthetic-history.ts'

async function retained(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.filter(metric => ['JSHeapUsedSize', 'Nodes', 'JSEventListeners'].includes(metric.name)).map(metric => [metric.name, metric.value]))
}

it('measures repeated Qishu sign-out cleanup in one browser world', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: fileURLToPath(new URL('../../apps/web/tests/qs/workbench.overlay.yml', import.meta.url)) })
  try {
    await seedSession(scaffold, syntheticHistory(158), 'qs-release-history')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const errors = watchConsole(page)
      await page.setViewportSize({ width: 1280, height: 900 })
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      await page.goto(scaffold.authenticatedUrl)
      await page.locator('#qs-login-user').waitFor()
      const baseline = await retained(cdp)
      console.log(JSON.stringify({ benchmark: 'qs-release/baseline', baseline }))
      for (let cycle = 0; cycle < 20; cycle++) {
        await page.locator('#qs-login-user').fill('admin')
        await page.locator('#qs-login-password').fill('Demo@2026')
        await page.locator('#qs-login-password').press('Enter')
        await page.locator('[data-qs-session="qs-release-history"]').click()
        await page.locator('[data-qs-reading] [role="tab"]').first().click()
        await page.getByText('Synthetic answer 158.', { exact: false }).waitFor()
        await page.getByRole('tab', { name: 'Request trajectory', exact: true }).click()
        await page.locator('[data-qs-trajectory-history]').waitFor()
        await page.getByRole('button', { name: 'Sign out', exact: true }).click()
        await page.locator('#qs-login-user').waitFor()
        expect(await page.locator('[data-qs-reading]').count()).toBe(0)
        const immediate = await retained(cdp)
        // 固定观测窗口用于区分延后清理，不参与动作延迟，也不重试直至获得好看的数值。
        await page.waitForTimeout(1000)
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        const delayed = await retained(cdp)
        console.log(JSON.stringify({ benchmark: 'qs-release/sample', cycle, immediate, delayed }))
      }
      expect(errors.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
